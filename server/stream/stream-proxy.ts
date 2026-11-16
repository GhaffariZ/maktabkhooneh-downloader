/**
 * Stream Proxy.
 * Safely streams remote lesson video with redirect-validated HTTPS fetching,
 * HTTP Range forwarding, client-disconnect abort, idle stream timeouts, and pipeline streaming.
 * If a lesson is already downloaded locally with matching quality, serves from disk with robust Range/HEAD/416 support.
 */

import http from 'http';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { MaktabkhoonehClient } from '../platform/client.js';
import { StorageManager } from '../storage/storage-manager.js';
import { ALLOWED_MEDIA_DOMAINS } from '../platform/constants.js';
import { resolveMediaQuality, safeFetch } from '../platform/media.js';

export interface StreamLessonOptions {
  courseId: string;
  lessonId: string;
  quality?: string;
  client: MaktabkhoonehClient;
  storage: StorageManager;
  allowLocalTest?: boolean;
  resolveMediaUrl?: (lessonId: string, quality?: string) => Promise<string | null>;
}

export interface ParsedHttpRange {
  start: number;
  end: number;
}

/**
 * Robust HTTP Range header parser.
 * Supports:
 *  - standard ranges: bytes=start-end (clamped to fileSize - 1)
 *  - open-ended ranges: bytes=start- (from start to end of file)
 *  - suffix ranges: bytes=-suffix (last suffix bytes of file)
 * Rejects multi-ranges, negative ranges, start > end, and out-of-bounds start with 416 status.
 */
export function parseHttpRange(
  rangeHeader: string | undefined,
  fileSize: number
): ParsedHttpRange | 'unsatisfiable' | 'invalid' | null {
  if (!rangeHeader || !rangeHeader.trim().startsWith('bytes=')) {
    return null;
  }

  const spec = rangeHeader.trim().slice(6).trim();

  // Multi-range requests (comma separated) are not supported -> treat as unsatisfiable
  if (spec.includes(',')) {
    return 'unsatisfiable';
  }

  // Suffix range: bytes=-N
  if (spec.startsWith('-')) {
    const suffixStr = spec.slice(1).trim();
    if (!/^\d+$/.test(suffixStr)) return 'invalid';
    const suffix = parseInt(suffixStr, 10);
    if (suffix <= 0 || fileSize === 0) return 'unsatisfiable';
    const start = Math.max(0, fileSize - suffix);
    const end = fileSize - 1;
    return { start, end };
  }

  const parts = spec.split('-');
  if (parts.length !== 2) return 'invalid';

  const [startStr, endStr] = parts.map((p) => p.trim());
  if (!/^\d+$/.test(startStr)) return 'invalid';

  const start = parseInt(startStr, 10);
  if (start < 0 || start >= fileSize) {
    return 'unsatisfiable';
  }

  // Open-ended range: bytes=N-
  if (endStr === '') {
    return { start, end: fileSize - 1 };
  }

  // Bounded range: bytes=N-M
  if (!/^\d+$/.test(endStr)) return 'invalid';
  const rawEnd = parseInt(endStr, 10);
  if (rawEnd < start) {
    return 'invalid';
  }

  // Clamp end to last byte of file
  const end = Math.min(rawEnd, fileSize - 1);
  return { start, end };
}

/**
 * Handle streaming requests for a lesson.
 */
export async function handleStreamLesson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: StreamLessonOptions
): Promise<void> {
  const { courseId, lessonId, quality, client, storage, allowLocalTest, resolveMediaUrl } = options;

  // 1. Check if lesson is already downloaded and completed on disk with matching requested quality
  const existingJob = storage
    .getDownloads()
    .find((d) => {
      if (d.courseId !== courseId || d.lessonId !== lessonId || d.status !== 'completed') {
        return false;
      }
      if (quality && quality !== 'default') {
        return d.quality === quality;
      }
      return true;
    });

  if (existingJob && existingJob.filePath) {
    try {
      if (fs.existsSync(existingJob.filePath)) {
        await serveLocalFile(req, res, existingJob.filePath);
        return;
      }
    } catch {}
  }

  // 2. Resolve media URL on demand
  let mediaUrl: string | null = null;
  if (resolveMediaUrl) {
    mediaUrl = await resolveMediaUrl(lessonId, quality);
  } else {
    try {
      const session = storage.getSession();
      const videoData = await client.fetchUnitVideoUrl(lessonId, undefined, session.cookie);
      const resolved = resolveMediaQuality(videoData, quality);
      mediaUrl = resolved.url;
    } catch (err: any) {
      if (err.message && err.message.includes('not available')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INVALID_QUALITY', message: err.message } }));
        return;
      }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: `Failed to resolve video URL: ${err.message}` } }));
      return;
    }
  }

  if (!mediaUrl) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'MEDIA_NOT_FOUND', message: 'No playable video source found for this lesson' } }));
    return;
  }

  // 3. Connect to remote media with client response disconnect observation
  const controller = new AbortController();

  const onResClose = () => {
    // Only abort if client disconnected before response finished writing
    if (!res.writableEnded) {
      controller.abort();
    }
  };

  res.on('close', onResClose);

  try {
    const upstreamHeaders: Record<string, string> = {
      'accept': 'video/mp4,application/octet-stream,*/*',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
    };
    if (req.headers.range) {
      upstreamHeaders['range'] = req.headers.range;
    }

    const session = storage.getSession();
    const platformOrigin = typeof client.getOrigin === 'function' ? client.getOrigin() : undefined;

    const upstreamRes = await safeFetch(mediaUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: upstreamHeaders,
      signal: controller.signal,
      allowLocalTest,
      allowedDomains: ALLOWED_MEDIA_DOMAINS,
      headersTimeoutMs: 30_000,
      cookie: session.cookie,
      exactPlatformOrigin: platformOrigin,
    });

    // 4. Handle 416 Range Not Satisfiable from upstream
    if (upstreamRes.status === 416) {
      if (upstreamRes.body) {
        await upstreamRes.body.cancel().catch(() => {});
      }
      const responseHeaders: Record<string, string> = {
        'Content-Type': upstreamRes.headers.get('content-type') || 'video/mp4',
        'Accept-Ranges': 'bytes',
      };
      const cr = upstreamRes.headers.get('content-range');
      if (cr) {
        responseHeaders['Content-Range'] = cr;
      }
      res.writeHead(416, responseHeaders);
      res.end();
      return;
    }

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      if (upstreamRes.body) {
        await upstreamRes.body.cancel().catch(() => {});
      }
      res.writeHead(upstreamRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'REMOTE_STREAM_ERROR', message: `Remote server responded with ${upstreamRes.status}` } }));
      return;
    }

    // 5. Forward headers
    const responseHeaders: Record<string, string> = {
      'Content-Type': upstreamRes.headers.get('content-type') || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const cl = upstreamRes.headers.get('content-length');
    if (cl) responseHeaders['Content-Length'] = cl;
    const cr = upstreamRes.headers.get('content-range');
    if (cr) responseHeaders['Content-Range'] = cr;

    res.writeHead(upstreamRes.status, responseHeaders);

    if (req.method === 'HEAD' || !upstreamRes.body) {
      if (upstreamRes.body) {
        await upstreamRes.body.cancel().catch(() => {});
      }
      res.end();
      return;
    }

    // 6. Stream with pipeline, finite body idle timeout, and disconnect observation
    const readable = Readable.fromWeb(upstreamRes.body as any);

    let idleTimer: NodeJS.Timeout | null = null;
    const resetIdleTimeout = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controller.abort(new Error('Network idle timeout during media streaming'));
      }, 30_000);
    };
    resetIdleTimeout();

    readable.on('data', () => resetIdleTimeout());

    try {
      await pipeline(readable, res);
    } catch (err: any) {
      if (!controller.signal.aborted && !res.writableEnded) {
        throw err;
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  } catch (err: any) {
    if (controller.signal.aborted || res.writableEnded) {
      return;
    }
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'STREAM_FAILED', message: err.message || 'Stream failed' } }));
    }
  } finally {
    res.off('close', onResClose);
  }
}

/**
 * Serve a local completed video file with full HTTP Range/HEAD and 416 support.
 */
export async function serveLocalFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
  contentType: string = 'video/mp4'
): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      throw new Error('Target is not a regular file');
    }
  } catch {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'FILE_NOT_FOUND', message: 'Local media file not found' } }));
    }
    return;
  }

  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const parsedRange = parseHttpRange(rangeHeader, fileSize);

    if (parsedRange === 'unsatisfiable' || parsedRange === 'invalid') {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
      });
      res.end();
      return;
    }

    if (parsedRange) {
      const { start, end } = parsedRange;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath, { start, end });
      const onDisconnect = () => {
        if (!res.writableEnded) {
          stream.destroy();
        }
      };
      res.on('close', onDisconnect);

      try {
        await pipeline(stream, res);
      } catch {
        // pipeline error / early disconnect handled cleanly
      } finally {
        res.off('close', onDisconnect);
      }
      return;
    }
  }

  // Full content (200 OK)
  res.writeHead(200, {
    'Content-Length': String(fileSize),
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  const onDisconnect = () => {
    if (!res.writableEnded) {
      stream.destroy();
    }
  };
  res.on('close', onDisconnect);

  try {
    await pipeline(stream, res);
  } catch {
    // client disconnect handled cleanly
  } finally {
    res.off('close', onDisconnect);
  }
}

/**
 * Download Engine.
 * Implements a robust single-worker FIFO download queue with resumable .part files,
 * strict HTTP Range and Content-Range verification, atomic completion rename,
 * authoritative pause/cancel transitions, collision-resistant naming, and crash recovery.
 */

import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { setTimeout as sleep } from 'timers/promises';
import { Download } from '../../shared/types.js';
import { StorageManager } from '../storage/storage-manager.js';
import { MaktabkhoonehClient } from '../platform/client.js';
import {
  sanitizeFileName,
  buildCourseFolderName,
  buildMediaFileName,
  assertSafePathContainment,
} from '../platform/url-parser.js';
import { ALLOWED_MEDIA_DOMAINS } from '../platform/constants.js';
import { resolveMediaQuality, safeFetch } from '../platform/media.js';

export interface ExtendedDownload extends Download {
  baseDir?: string;
  partPath?: string;
  etag?: string;
  lastModified?: string;
}

export interface DownloadEngineOptions {
  storage: StorageManager;
  client: MaktabkhoonehClient;
  allowLocalTest?: boolean;
  allowedDomains?: readonly string[];
  resolveMediaUrl?: (lessonId: string, quality?: string) => Promise<string | null>;
}

export class DownloadEngine {
  private storage: StorageManager;
  private client: MaktabkhoonehClient;
  private allowLocalTest: boolean;
  private allowedDomains: readonly string[];
  private resolveMediaUrl?: (lessonId: string, quality?: string) => Promise<string | null>;

  private isWorkerBusy: boolean = false;
  private isShuttingDown: boolean = false;
  private activeAbortController: AbortController | null = null;
  private activeJobId: string | null = null;
  private activeWorkerPromise: Promise<void> | null = null;
  private enqueueLock: Promise<void> = Promise.resolve();

  constructor(options: DownloadEngineOptions) {
    this.storage = options.storage;
    this.client = options.client;
    this.allowLocalTest = !!options.allowLocalTest;
    this.allowedDomains = options.allowedDomains || ALLOWED_MEDIA_DOMAINS;
    this.resolveMediaUrl = options.resolveMediaUrl;
  }

  /**
   * Enqueue a lesson for download.
   * Deduplicates strictly on (courseId, lessonId, quality).
   * Persists an immutable destination root (baseDir) per job so future settings changes do not break resume.
   * Recovers missing completed files on disk instead of returning dead jobs.
   */
  public async enqueue(
    courseId: string,
    lessonId: string,
    quality: string,
    courseTitle: string,
    lessonTitle: string
  ): Promise<Download> {
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const prevLock = this.enqueueLock;
    this.enqueueLock = lockPromise;

    await prevLock;

    try {
      const all = this.storage.getDownloads();
      // Deduplicate strictly on (courseId, lessonId, quality)
      const existing = all.find(
        (d) => d.courseId === courseId && d.lessonId === lessonId && d.quality === quality
      ) as ExtendedDownload | undefined;

      const settings = this.storage.getSettings();
      const baseDir = settings.downloadDirectory;
      const courseFolder = buildCourseFolderName(courseTitle, courseId);
      const fileName = buildMediaFileName(lessonTitle, lessonId, quality);
      const finalFilePath = assertSafePathContainment(
        baseDir,
        path.join(baseDir, courseFolder, fileName)
      );
      const tmpFilePath = `${finalFilePath}.part`;

      if (existing) {
        if (existing.status === 'completed') {
          // If completed file is missing or corrupt on disk, recover the job
          if (existing.filePath && fs.existsSync(existing.filePath)) {
            try {
              const st = fs.statSync(existing.filePath);
              if (!existing.totalBytes || st.size === existing.totalBytes) {
                return existing;
              }
            } catch {}
          }
          // File is missing or truncated on disk: recover job
          existing.status = 'queued';
          existing.downloadedBytes = 0;
          existing.error = undefined;
          const saved = await this.safeSaveDownload(existing);
          this.triggerWorker();
          return saved;
        }

        if (existing.status === 'downloading' || existing.status === 'queued') {
          return existing;
        }

        // Job was paused, failed, or canceled. Re-queue for execution.
        existing.status = 'queued';
        existing.error = undefined;

        // Synchronize actual on-disk partial size
        const partPath = existing.partPath || `${existing.filePath}.part`;
        try {
          if (fs.existsSync(partPath)) {
            existing.downloadedBytes = fs.statSync(partPath).size;
          } else {
            existing.downloadedBytes = 0;
          }
        } catch {
          existing.downloadedBytes = 0;
        }

        const saved = await this.safeSaveDownload(existing);
        this.triggerWorker();
        return saved;
      }

      // New job: persist immutable baseDir and file paths at enqueue
      const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newJob: ExtendedDownload = {
        id,
        courseId,
        lessonId,
        courseTitle,
        lessonTitle,
        quality,
        status: 'queued',
        downloadedBytes: 0,
        baseDir,
        filePath: finalFilePath,
        partPath: tmpFilePath,
      };

      const saved = await this.safeSaveDownload(newJob);
      this.triggerWorker();
      return saved;
    } finally {
      releaseLock!();
    }
  }

  /**
   * Pause a download job.
   * Disallows pausing completed downloads.
   * Makes transition authoritative by immediately recording paused in storage,
   * signaling abort, and awaiting stream flush.
   */
  public async pause(id: string): Promise<Download> {
    const job = this.storage.getDownload(id) as ExtendedDownload | null;
    if (!job) throw new Error(`Download job not found: ${id}`);

    // Disallow pause of completed jobs
    if (job.status === 'completed') {
      return job;
    }

    // Immediately record intended paused state
    job.status = 'paused';
    await this.safeSaveDownload(job);

    // If active worker is processing this job, abort network and await flush
    if (this.activeJobId === id) {
      if (this.activeAbortController) {
        this.activeAbortController.abort('paused');
      }
      if (this.activeWorkerPromise) {
        await this.activeWorkerPromise;
      }
    }

    // Refresh job state and sync actual flushed offset from disk
    const current = (this.storage.getDownload(id) as ExtendedDownload) || job;
    current.status = 'paused';

    const partPath = current.partPath || (current.filePath ? `${current.filePath}.part` : null);
    if (partPath) {
      try {
        if (fs.existsSync(partPath)) {
          const st = fs.statSync(partPath);
          current.downloadedBytes = st.size;
        }
      } catch {}
    }

    const saved = await this.safeSaveDownload(current);
    return saved;
  }

  /**
   * Resume a paused/failed/canceled job.
   * Awaits any pending abort/flush before re-queuing to avoid resurrecting stale state.
   */
  public async resume(id: string): Promise<Download> {
    const job = this.storage.getDownload(id) as ExtendedDownload | null;
    if (!job) throw new Error(`Download job not found: ${id}`);
    if (job.status === 'completed') return job;

    // Await any in-flight worker promise if this job was currently aborting/flushing
    if (this.activeJobId === id && this.activeWorkerPromise) {
      await this.activeWorkerPromise;
    }

    const current = (this.storage.getDownload(id) as ExtendedDownload) || job;
    if (current.status === 'completed' || current.status === 'canceled') {
      return current;
    }

    current.status = 'queued';
    current.error = undefined;

    // Sync actual resume offset from disk
    const partPath = current.partPath || (current.filePath ? `${current.filePath}.part` : null);
    if (partPath) {
      try {
        if (fs.existsSync(partPath)) {
          const st = fs.statSync(partPath);
          current.downloadedBytes = st.size;
        }
      } catch {}
    }

    const saved = await this.safeSaveDownload(current);
    this.triggerWorker();
    return saved;
  }

  /**
   * Cancel a download job.
   * Disallows canceling completed downloads.
   * Immediately marks canceled, halts network, flushes partial.
   */
  public async cancel(id: string): Promise<Download> {
    const job = this.storage.getDownload(id) as ExtendedDownload | null;
    if (!job) throw new Error(`Download job not found: ${id}`);

    // Disallow cancel of completed jobs
    if (job.status === 'completed') {
      return job;
    }

    // Immediately record canceled status authoritatively
    job.status = 'canceled';
    await this.safeSaveDownload(job);

    if (this.activeJobId === id) {
      if (this.activeAbortController) {
        this.activeAbortController.abort('canceled');
      }
      if (this.activeWorkerPromise) {
        await this.activeWorkerPromise;
      }
    }

    const current = (this.storage.getDownload(id) as ExtendedDownload) || job;
    current.status = 'canceled';
    const saved = await this.safeSaveDownload(current);
    return saved;
  }

  /**
   * Graceful shutdown: aborts active download, flushes partial, pauses active job, and awaits idle.
   */
  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.activeAbortController) {
      this.activeAbortController.abort('shutdown');
    }
    if (this.activeWorkerPromise) {
      await this.activeWorkerPromise;
    }

    // Persist any downloading jobs as paused
    const all = this.storage.getDownloads();
    for (const d of all) {
      if (d.status === 'downloading') {
        d.status = 'paused';
        await this.safeSaveDownload(d);
      }
    }
  }

  private async safeSaveDownload(job: Download): Promise<Download> {
    try {
      return await this.storage.saveDownload(job);
    } catch (err: any) {
      if (err?.code === 'ENOENT' || this.isShuttingDown) {
        return job;
      }
      throw err;
    }
  }

  /**
   * Single-worker FIFO queue dispatcher.
   * Dispatches the oldest queued job.
   */
  public triggerWorker(): void {
    if (this.isWorkerBusy || this.isShuttingDown) return;

    // Pick oldest queued job (strict FIFO by createdAt ascending)
    const all = this.storage.getDownloads();
    const queuedJobs = all
      .filter((d) => d.status === 'queued')
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
      });

    const nextJob = queuedJobs[0];
    if (!nextJob) return;

    this.isWorkerBusy = true;
    this.activeJobId = nextJob.id;
    // Create AbortController SYNCHRONOUSLY before first await
    this.activeAbortController = new AbortController();

    this.activeWorkerPromise = (async () => {
      try {
        await this.processJob(nextJob.id);
      } catch (err: any) {
        if (!this.isShuttingDown && err?.code !== 'ENOENT') {
          console.error(`Unexpected error processing job ${nextJob.id}:`, err);
        }
      } finally {
        this.isWorkerBusy = false;
        this.activeJobId = null;
        this.activeAbortController = null;
        this.activeWorkerPromise = null;
        if (!this.isShuttingDown) {
          this.triggerWorker();
        }
      }
    })();
  }

  private async processJob(jobId: string): Promise<void> {
    const controller = this.activeAbortController;
    const signal = controller ? controller.signal : new AbortController().signal;

    // Authoritative check before starting
    let job = this.storage.getDownload(jobId) as ExtendedDownload | null;
    if (!job || job.status !== 'queued' || signal.aborted) return;

    job.status = 'downloading';
    job = (await this.safeSaveDownload(job)) as ExtendedDownload;

    // Check again after save: might have been paused concurrently
    const checkAfterSave = this.storage.getDownload(jobId) as ExtendedDownload | null;
    if (!checkAfterSave || checkAfterSave.status !== 'downloading' || signal.aborted) {
      return;
    }

    // Target paths and safe containment
    const finalFilePath = job.filePath!;
    const tmpFilePath = job.partPath || `${finalFilePath}.part`;
    job.partPath = tmpFilePath;

    // Validate path containment against job's persisted baseDir (survives global settings changes)
    const targetBaseDir = job.baseDir || path.dirname(path.dirname(finalFilePath));
    try {
      assertSafePathContainment(targetBaseDir, finalFilePath);
    } catch (err: any) {
      job.status = 'failed';
      job.error = `Path security error: ${err.message}`;
      await this.safeSaveDownload(job);
      return;
    }

    // Ensure course folder exists
    try {
      await fs.promises.mkdir(path.dirname(finalFilePath), { recursive: true });
    } catch (err: any) {
      job.status = 'failed';
      job.error = `Failed to create destination directory: ${err.message}`;
      await this.safeSaveDownload(job);
      return;
    }

    // Completion check: never accept an arbitrary nonempty final file unless it was
    // verified by size against expected totalBytes.
    if (fs.existsSync(finalFilePath)) {
      try {
        const stat = fs.statSync(finalFilePath);
        if (job.totalBytes && stat.size === job.totalBytes && stat.size > 0) {
          job.status = 'completed';
          job.downloadedBytes = stat.size;
          await this.safeSaveDownload(job);
          return;
        }
      } catch {}
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal.aborted) return;

      const current = this.storage.getDownload(jobId) as ExtendedDownload | null;
      if (!current || current.status !== 'downloading') {
        return;
      }
      job = current;

      let writeStream: fs.WriteStream | null = null;
      let upstreamRes: Response | null = null;

      try {
        // 1. Resolve fresh media URL
        let mediaUrl: string | null = null;
        if (this.resolveMediaUrl) {
          mediaUrl = await this.resolveMediaUrl(job.lessonId, job.quality);
        } else {
          const session = this.storage.getSession();
          const videoData = await this.client.fetchUnitVideoUrl(job.lessonId, undefined, session.cookie);
          const resolved = resolveMediaQuality(videoData, job.quality);
          mediaUrl = resolved.url;
        }

        if (!mediaUrl) {
          throw new Error('Could not resolve video download URL');
        }

        // 2. Strict resume offset & validator checking
        let resumeOffset = 0;
        try {
          if (fs.existsSync(tmpFilePath)) {
            resumeOffset = fs.statSync(tmpFilePath).size;
          }
        } catch {}

        // If resuming but no validator exists (neither ETag nor Last-Modified),
        // restart safely from 0 rather than risk mixing entities
        if (resumeOffset > 0 && !job.etag && !job.lastModified) {
          try {
            await fs.promises.truncate(tmpFilePath, 0);
          } catch {}
          resumeOffset = 0;
        }

        // Fetch loop: at most one restart from zero per attempt
        let hasRetriedFromZero = false;

        while (true) {
          if (signal.aborted) return;

          const headers: Record<string, string> = {
            'accept': 'video/mp4,application/octet-stream,*/*',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          };

          if (resumeOffset > 0) {
            headers['range'] = `bytes=${resumeOffset}-`;
            if (job.etag) {
              headers['if-range'] = job.etag;
            } else if (job.lastModified) {
              headers['if-range'] = job.lastModified;
            }
          }

          const session = this.storage.getSession();
          const platformOrigin = typeof this.client.getOrigin === 'function' ? this.client.getOrigin() : undefined;

          upstreamRes = await safeFetch(mediaUrl, {
            method: 'GET',
            headers,
            signal,
            allowLocalTest: this.allowLocalTest,
            allowedDomains: this.allowedDomains,
            headersTimeoutMs: 30_000,
            cookie: session.cookie,
            exactPlatformOrigin: platformOrigin,
          });

          // Handle 416 Range Not Satisfiable
          if (upstreamRes.status === 416) {
            if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});

            // If we requested from byte 0, an incoming 416 is unsolicited and malformed: do not loop!
            if (resumeOffset === 0) {
              throw new Error('Upstream rejected zero-offset request with 416 Range Not Satisfiable');
            }

            // In 416 handling, do not mark complete solely because .part size equals upstream length.
            // Require matching validator to avoid publishing a same-size changed entity.
            // Prefer existing strong ETag exactly; only fall back to Last-Modified when there is no ETag.
            const resEtag = upstreamRes.headers.get('etag') || undefined;
            const resLastMod = upstreamRes.headers.get('last-modified') || undefined;

            let validatorMatches = false;
            if (job.etag || resEtag) {
              validatorMatches = !!(job.etag && resEtag && job.etag === resEtag);
            } else if (job.lastModified && resLastMod) {
              validatorMatches = job.lastModified === resLastMod;
            }

            const cr = upstreamRes.headers.get('content-range');
            const totalMatch = cr ? cr.match(/\/(\d+)$/) : null;
            const expectedTotal = totalMatch ? parseInt(totalMatch[1], 10) : undefined;

            if (validatorMatches && expectedTotal !== undefined && resumeOffset === expectedTotal) {
              const finalStat = await fs.promises.stat(tmpFilePath);
              if (finalStat.size === expectedTotal) {
                await fs.promises.rename(tmpFilePath, finalFilePath);
                job.status = 'completed';
                job.downloadedBytes = finalStat.size;
                job.totalBytes = finalStat.size;
                job.filePath = finalFilePath;
                job.error = undefined;
                await this.safeSaveDownload(job);
                return;
              }
            }

            // Cannot safely verify with matching validator: restart once from byte 0
            if (hasRetriedFromZero) {
              throw new Error('Upstream persistently responded with 416 Range Not Satisfiable');
            }
            hasRetriedFromZero = true;
            try {
              await fs.promises.truncate(tmpFilePath, 0);
            } catch {}
            resumeOffset = 0;
            job.downloadedBytes = 0;
            job.etag = resEtag;
            job.lastModified = resLastMod;
            continue;
          }

          if (!upstreamRes.ok && upstreamRes.status !== 206) {
            if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});
            throw new Error(`Upstream returned HTTP ${upstreamRes.status}`);
          }

          const resEtag = upstreamRes.headers.get('etag') || undefined;
          const resLastMod = upstreamRes.headers.get('last-modified') || undefined;

          // If upstream responded with 200 OK (ignored Range or entity changed)
          if (upstreamRes.status === 200) {
            if (resumeOffset > 0) {
              try {
                await fs.promises.truncate(tmpFilePath, 0);
              } catch {}
              resumeOffset = 0;
            }
            const cl = upstreamRes.headers.get('content-length');
            if (cl) {
              job.totalBytes = parseInt(cl, 10);
            } else {
              // Reset stale expectedTotal when 200 lacks Content-Length
              job.totalBytes = undefined;
            }
            job.etag = resEtag;
            job.lastModified = resLastMod;
            break;
          }

          // Upstream responded with 206 Partial Content:
          // Check for changed validator (prefer strong ETag; only check Last-Modified if neither has ETag)
          let validatorChanged = false;
          if (job.etag || resEtag) {
            validatorChanged = !job.etag || !resEtag || job.etag !== resEtag;
          } else if (job.lastModified || resLastMod) {
            validatorChanged = !job.lastModified || !resLastMod || job.lastModified !== resLastMod;
          } else {
            validatorChanged = true;
          }

          if (resumeOffset > 0 && validatorChanged) {
            // Cancel body and request AGAIN from byte zero! Never write tail as full file!
            if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});
            if (hasRetriedFromZero) {
              throw new Error('Upstream validator changed repeatedly during partial resume');
            }
            hasRetriedFromZero = true;
            try {
              await fs.promises.truncate(tmpFilePath, 0);
            } catch {}
            resumeOffset = 0;
            job.downloadedBytes = 0;
            job.etag = resEtag;
            job.lastModified = resLastMod;
            continue;
          }

          // Strict Content-Range validation
          const cr = upstreamRes.headers.get('content-range');
          if (!cr) {
            if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});
            throw new Error('Upstream responded with 206 but omitted Content-Range header');
          }

          const match = cr.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
          if (!match) {
            if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});
            throw new Error(`Malformed Content-Range header from upstream: ${cr}`);
          }

          const rangeStart = parseInt(match[1], 10);
          const rangeEnd = parseInt(match[2], 10);
          const totalStr = match[3];

          // Strict validation: Content-Range MUST start at actual .part offset
          if (rangeStart !== resumeOffset) {
            if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});
            if (resumeOffset === 0 || hasRetriedFromZero) {
              throw new Error(`Upstream returned invalid range start ${rangeStart} (expected ${resumeOffset})`);
            }
            hasRetriedFromZero = true;
            try {
              await fs.promises.truncate(tmpFilePath, 0);
            } catch {}
            resumeOffset = 0;
            job.downloadedBytes = 0;
            continue;
          }

          if (rangeEnd < rangeStart) {
            if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});
            throw new Error(`Invalid Content-Range span: ${rangeStart}-${rangeEnd}`);
          }

          if (totalStr !== '*') {
            const total = parseInt(totalStr, 10);
            // End must be strictly less than total (0-indexed span)
            if (rangeEnd >= total) {
              if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});
              throw new Error(`Invalid Content-Range: end (${rangeEnd}) must be less than total (${total})`);
            }
            job.totalBytes = total;
          }

          const cl = upstreamRes.headers.get('content-length');
          if (cl) {
            const expectedSpan = rangeEnd - rangeStart + 1;
            if (parseInt(cl, 10) !== expectedSpan) {
              if (upstreamRes.body) await upstreamRes.body.cancel().catch(() => {});
              throw new Error(`Content-Length (${cl}) does not match Content-Range span (${expectedSpan})`);
            }
          }

          job.etag = resEtag;
          job.lastModified = resLastMod;
          break;
        }

        // Proceed to stream body
        const writeFlags = (resumeOffset === 0) ? 'w' : 'a';
        job.downloadedBytes = resumeOffset;
        await this.safeSaveDownload(job);

        if (signal.aborted) {
          if (upstreamRes?.body) await upstreamRes.body.cancel().catch(() => {});
          return;
        }

        writeStream = fs.createWriteStream(tmpFilePath, { flags: writeFlags });
        const readable = Readable.fromWeb(upstreamRes!.body as any);

        let lastPersist = Date.now();
        let bytesWritten = resumeOffset;

        const counter = new Transform({
          transform(chunk, _enc, cb) {
            bytesWritten += chunk.length;
            job!.downloadedBytes = bytesWritten;
            const now = Date.now();
            if (now - lastPersist > 500) {
              lastPersist = now;
              persistProgress(job!);
            }
            cb(null, chunk);
          },
        });

        const persistProgress = (d: ExtendedDownload) => {
          const cur = this.storage.getDownload(jobId);
          if (cur && cur.status === 'downloading' && !signal.aborted && !this.isShuttingDown) {
            this.safeSaveDownload(d).catch(() => {});
          }
        };

        // Network idle timeout during body consumption
        let idleTimer: NodeJS.Timeout | null = null;
        const resetIdleTimeout = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            controller?.abort(new Error('Network idle timeout during media streaming'));
          }, 30_000);
        };
        resetIdleTimeout();

        readable.on('data', () => resetIdleTimeout());

        try {
          await pipeline(readable, counter, writeStream);
        } finally {
          if (idleTimer) clearTimeout(idleTimer);
        }

        // Authoritative check after stream completion
        const freshJob = this.storage.getDownload(jobId) as ExtendedDownload | null;
        if (!freshJob || freshJob.status !== 'downloading' || signal.aborted) {
          return;
        }

        // Validate exact byte count before rename (prevent premature EOF)
        const finalStat = await fs.promises.stat(tmpFilePath);
        if (job.totalBytes !== undefined && finalStat.size !== job.totalBytes) {
          throw new Error(`Premature EOF / Incomplete download: file size is ${finalStat.size} of expected ${job.totalBytes} bytes`);
        }

        // Atomic rename from .part to final target file
        await fs.promises.rename(tmpFilePath, finalFilePath);

        freshJob.status = 'completed';
        freshJob.downloadedBytes = finalStat.size;
        freshJob.totalBytes = finalStat.size;
        freshJob.filePath = finalFilePath;
        freshJob.error = undefined;
        await this.safeSaveDownload(freshJob);
        return;
      } catch (err: any) {
        if (upstreamRes?.body) {
          try {
            await upstreamRes.body.cancel();
          } catch {}
        }
        if (writeStream && !(writeStream as any).destroyed) {
          try {
            writeStream.end();
          } catch {}
        }

        if (signal.aborted) {
          const fresh = this.storage.getDownload(jobId) as ExtendedDownload | null;
          if (fresh) {
            try {
              if (fs.existsSync(tmpFilePath)) {
                fresh.downloadedBytes = fs.statSync(tmpFilePath).size;
                await this.safeSaveDownload(fresh);
              }
            } catch {}
          }
          return;
        }

        const fresh = this.storage.getDownload(jobId) as ExtendedDownload | null;
        if (!fresh || fresh.status !== 'downloading') {
          return;
        }

        if (attempt < maxRetries) {
          await sleep(1000 * attempt);
          continue;
        }

        // Retries exhausted
        if (fresh && fresh.status === 'downloading') {
          fresh.status = 'failed';
          fresh.error = err.message || 'Download failed after retries';
          try {
            if (fs.existsSync(tmpFilePath)) {
              fresh.downloadedBytes = fs.statSync(tmpFilePath).size;
            }
          } catch {}
          await this.safeSaveDownload(fresh);
        }
        return;
      }
    }
  }
}

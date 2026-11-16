/**
 * URL parsing, sanitization, path containment, and HTML entity utilities for Maktabkhooneh platform content.
 */

import path from 'path';
import crypto from 'crypto';
import { DEFAULT_ORIGIN, ALLOWED_MEDIA_DOMAINS } from './constants.js';

export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * Sanitize a string for safe filesystem usage across Windows, macOS, and Linux.
 * Handles illegal characters, control characters, Persian RTL marks, trailing spaces/dots,
 * directory traversal dots (..), and Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
 */
export function sanitizeFileName(name: string): string {
  if (!name) return 'unnamed';
  let sanitized = name
    .replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .replace(/[\s\u200b-\u200f\u202a-\u202e\ufeff]+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');

  if (WINDOWS_RESERVED_NAMES.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  sanitized = sanitized.slice(0, 150).trim();
  return sanitized.length > 0 ? sanitized : 'unnamed';
}

/**
 * Deterministic short hash (8 hex characters) from raw input.
 * Preserves case sensitivity and raw character differences across Windows case-insensitive filesystems.
 */
export function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input || '').digest('hex').slice(0, 8);
}

/**
 * Build a safe, collision-resistant course folder name combining title and stable course ID.
 * Incorporates a deterministic hash of the raw course ID so case differences and sanitized collisions
 * are strictly preserved, while keeping path length well within filesystem limits.
 */
export function buildCourseFolderName(courseTitle: string, courseId: string): string {
  const idHash = shortHash(courseId);
  const safeId = sanitizeFileName(courseId).slice(0, 30);
  const suffix = `-${safeId}-${idHash}`;
  const maxTitleLen = Math.max(20, 80 - suffix.length);
  const safeTitle = sanitizeFileName(courseTitle).slice(0, maxTitleLen).trim().replace(/[. ]+$/, '') || 'course';
  return `${safeTitle}${suffix}`;
}

/**
 * Build a safe, collision-resistant media file name combining lesson title, lesson ID, and quality.
 * Prevents collisions between lessons with long titles, identical sanitized IDs, case differences,
 * or different qualities.
 * Ensures the stable unique ID, quality, and raw hash are NEVER dropped or truncated.
 */
export function buildMediaFileName(lessonTitle: string, lessonId: string, quality: string): string {
  const qual = quality || 'default';
  const idHash = shortHash(`${lessonId}:${qual}`);
  const safeId = sanitizeFileName(lessonId).slice(0, 30);
  const safeQuality = sanitizeFileName(qual).slice(0, 15);
  const suffix = `-${safeId}-${safeQuality}-${idHash}.mp4`;
  const maxTitleLen = Math.max(20, 100 - suffix.length);
  const safeTitle = sanitizeFileName(lessonTitle).slice(0, maxTitleLen).trim().replace(/[. ]+$/, '') || 'lesson';
  return `${safeTitle}${suffix}`;
}

/**
 * Validate that a target path is strictly contained within the expected base directory.
 * Prevents directory traversal attacks via '..' or symlinks/absolute escapes.
 */
export function assertSafePathContainment(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path containment violation: ${targetPath} escapes base directory ${baseDir}`);
  }
  return resolvedTarget;
}

/**
 * Extract the course slug from a Maktabkhooneh course or unit URL.
 */
export function extractCourseSlug(courseUrl: string, expectedOrigin: string = DEFAULT_ORIGIN): string {
  try {
    const parsed = new URL(courseUrl);
    if (expectedOrigin && parsed.origin !== new URL(expectedOrigin).origin) {
      throw new Error(`Unexpected origin: ${parsed.origin} (expected ${new URL(expectedOrigin).origin})`);
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    const lmsIdx = parts.indexOf('lms');
    if (lmsIdx !== -1 && parts[lmsIdx + 1] === 'course' && parts[lmsIdx + 2]) {
      return parts[lmsIdx + 2];
    }
    const idx = parts.indexOf('course');
    if (idx !== -1 && parts[idx + 1]) {
      return parts[idx + 1];
    }
    throw new Error('Cannot parse course slug from URL path');
  } catch (e: any) {
    throw new Error(`Invalid course URL: ${e.message}`);
  }
}

/**
 * Extract numeric course ID from slug with suffix -mk<id> (e.g., python-mk10645 -> 10645).
 */
export function extractCourseIdFromSlug(slug: string): number | null {
  if (!slug) return null;
  const m = slug.match(/-mk(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Build lecture page URL for a specific chapter/unit.
 */
export function buildLectureUrl(
  origin: string,
  courseSlug: string,
  chapter: { id: string | number; slug?: string },
  unit: { id?: string | number; slug?: string; unit_id?: string | number },
  useNewFormat: boolean = false
): string {
  const base = origin.replace(/\/+$/, '');
  if (useNewFormat) {
    const unitId = unit.id || unit.unit_id;
    return `${base}/lms/course/${encodeURIComponent(courseSlug)}/unit/${unitId}/`;
  }
  const chapterSegment = `${encodeURIComponent(chapter.slug || 'chapter')}-ch${chapter.id}`;
  const unitSegment = encodeURIComponent(unit.slug || String(unit.id || 'unit'));
  return `${base}/course/${encodeURIComponent(courseSlug)}/${chapterSegment}/${unitSegment}/`;
}

/**
 * Extract video sources from lecture page HTML.
 */
export function extractVideoSources(html: string): string[] {
  const urls: string[] = [];
  const re = /<source\b[^>]*?src=["']([^"'>]+)["'][^>]*>/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    const url = decodeHtmlEntities(raw);
    if (url && url.includes('/videos/')) {
      urls.push(url);
    }
  }
  return Array.from(new Set(urls));
}

/**
 * Extract subtitle links from HTML track tags.
 */
export function extractSubtitleLinks(html: string): string[] {
  const results = new Set<string>();
  if (!html) return [];
  const re = /<track\b[^>]*?src=["']([^"'>]+)["'][^>]*>/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    const url = decodeHtmlEntities(raw);
    if (url) results.add(url);
  }
  return Array.from(results);
}

/**
 * Extract attachment links from lecture HTML.
 */
export function extractAttachmentLinks(html: string): string[] {
  const results = new Set<string>();
  if (!html) return [];
  const blockRe = /<div[^>]*class=["'][^"'>]*unit-content--download[^"'>]*["'][^>]*>[\s\S]*?<\/div>/gim;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[0];
    const aRe = /<a[^>]+href=["']([^"'>]+)["'][^>]*>/gim;
    let a: RegExpExecArray | null;
    while ((a = aRe.exec(block)) !== null) {
      const raw = a[1];
      const url = decodeHtmlEntities(raw);
      if (url && /attachments/i.test(url)) {
        results.add(url);
      }
    }
  }
  return Array.from(results);
}

/**
 * SSRF and remote host validation.
 * Ensures the target URL is HTTPS and belongs to a trusted platform domain.
 * Rejects embedded credentials (user:pass), unsafe non-standard ports, private IP ranges.
 * For test fixtures, loopback HTTP may be explicitly allowed via constructor-only test options.
 */
export function isAllowedRemoteHost(
  urlStr: string,
  allowedDomains: readonly string[] = ALLOWED_MEDIA_DOMAINS,
  allowLocalTest: boolean = false
): boolean {
  try {
    const parsed = new URL(urlStr);

    // Rejection of embedded credentials (user:pass@host)
    if (parsed.username || parsed.password) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Local test loopback exception (constructor-only allowLocalTest)
    if (allowLocalTest) {
      if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      }
    }

    // Production strictly requires HTTPS
    if (parsed.protocol !== 'https:') {
      return false;
    }

    // Only default HTTPS port 443 (or implicit) is allowed in production
    if (parsed.port && parsed.port !== '443') {
      return false;
    }

    // Disallow loopback / private IP patterns / cloud metadata
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return false;
    }

    return allowedDomains.some((d) => {
      if (d.startsWith('.')) {
        return hostname.endsWith(d) || hostname === d.slice(1);
      }
      return hostname === d;
    });
  } catch {
    return false;
  }
}

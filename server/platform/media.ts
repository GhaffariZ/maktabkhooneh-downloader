/**
 * Media quality resolver and redirect-safe fetch utilities.
 * Ensures strict quality selection (no silent fallbacks to HQ when LQ is requested),
 * SSRF prevention across redirect chains, credential/cookie/authorization leakage prevention,
 * sanitization of sensitive query tokens from errors, and finite timeouts.
 */

import { Quality } from '../../shared/types.js';
import { ALLOWED_MEDIA_DOMAINS, DEFAULT_ORIGIN } from './constants.js';
import { isAllowedRemoteHost } from './url-parser.js';

export interface ResolvedMediaQuality {
  url: string;
  quality: string;
  size?: number;
}

/**
 * Centralized media quality resolver.
 * Strictly honors requested quality (e.g. 'lq', 'hq', '720p', etc.).
 * Throws if the requested quality does not exist, rather than silently choosing another quality.
 */
export function resolveMediaQuality(
  videoData: any,
  requestedQuality?: string
): ResolvedMediaQuality {
  if (!videoData) {
    throw new Error('No video data available for resolution');
  }

  const req = requestedQuality ? requestedQuality.trim().toLowerCase() : undefined;

  // Case 1: Specific quality requested (and not 'default')
  if (req && req !== 'default') {
    // 1a. Check explicit qualities array
    if (Array.isArray(videoData.qualities) && videoData.qualities.length > 0) {
      const match = videoData.qualities.find((q: any) => {
        const id = String(q.id || '').trim().toLowerCase();
        const res = String(q.resolution || '').trim().toLowerCase();
        const label = String(q.label || '').trim().toLowerCase();
        return id === req || res === req || label === req || `${res}p` === req;
      });

      if (match && match.download_url) {
        return {
          url: match.download_url,
          quality: String(match.id || match.resolution || req),
          size: match.size ? parseInt(match.size, 10) : undefined,
        };
      }
    }

    // 1b. Check video_urls dictionary
    if (videoData.video_urls) {
      if (req === 'hq' && videoData.video_urls.hq) {
        return { url: videoData.video_urls.hq, quality: 'hq' };
      }
      if (req === 'lq' && videoData.video_urls.lq) {
        return { url: videoData.video_urls.lq, quality: 'lq' };
      }
    }

    // Strict rejection of nonexistent requested quality
    throw new Error(`Requested media quality '${requestedQuality}' is not available for this lesson`);
  }

  // Case 2: Default quality (or no quality specified) - select highest available
  if (Array.isArray(videoData.qualities) && videoData.qualities.length > 0) {
    const valid = videoData.qualities.filter((q: any) => !!q.download_url);
    if (valid.length > 0) {
      const sorted = [...valid].sort((a: any, b: any) => (Number(b.resolution) || 0) - (Number(a.resolution) || 0));
      const best = sorted[0];
      return {
        url: best.download_url,
        quality: String(best.id || best.resolution || 'default'),
        size: best.size ? parseInt(best.size, 10) : undefined,
      };
    }
  }

  if (videoData.video_urls) {
    if (videoData.video_urls.hq) {
      return { url: videoData.video_urls.hq, quality: 'hq' };
    }
    if (videoData.video_urls.lq) {
      return { url: videoData.video_urls.lq, quality: 'lq' };
    }
  }

  throw new Error('No downloadable video source found in video metadata');
}

/**
 * Extract available qualities from video metadata in standard Quality shape.
 */
export function extractAvailableQualities(videoData: any): Quality[] {
  const result: Quality[] = [];
  if (!videoData) return result;

  if (Array.isArray(videoData.qualities)) {
    for (const q of videoData.qualities) {
      if (q.download_url) {
        result.push({
          id: String(q.id || q.resolution || 'default'),
          label: `${q.resolution || q.label || 'ویدیو'} (${q.extension || 'mp4'})`,
          bytes: q.size ? parseInt(q.size, 10) : undefined,
        });
      }
    }
  }

  if (result.length === 0 && videoData.video_urls) {
    if (videoData.video_urls.hq) {
      result.push({ id: 'hq', label: 'کیفیت عالی (HQ)' });
    }
    if (videoData.video_urls.lq) {
      result.push({ id: 'lq', label: 'کیفیت عادی (LQ)' });
    }
  }

  return result;
}

export interface SafeFetchOptions extends RequestInit {
  allowedDomains?: readonly string[];
  allowLocalTest?: boolean;
  maxRedirects?: number;
  headersTimeoutMs?: number;
  exactPlatformOrigin?: string;
  cookie?: string;
}

/**
 * Safe fetch wrapper with:
 * - Redirect validation (validates HTTPS, domain allowlist, unsafe ports, and credentials on EVERY hop)
 * - Cookie and Authorization isolation (stripped on any non-exact-platform origin, even if options.cookie absent)
 * - Safe error reporting (reports only hostnames, never signed URLs or query tokens)
 * - Bounded redirects (stops after maxRedirects, cancels unused response bodies)
 * - Finite header timeout
 */
export async function safeFetch(
  initialUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const {
    allowedDomains = ALLOWED_MEDIA_DOMAINS,
    allowLocalTest = false,
    maxRedirects = 5,
    headersTimeoutMs = 30_000,
    exactPlatformOrigin = DEFAULT_ORIGIN,
    cookie,
    signal,
    headers: rawHeaders,
    ...restInit
  } = options;

  let currentUrl = initialUrl;
  let redirectsCount = 0;

  let trustedOrigin: string;
  try {
    trustedOrigin = new URL(exactPlatformOrigin).origin;
  } catch {
    trustedOrigin = new URL(DEFAULT_ORIGIN).origin;
  }

  while (true) {
    let currentHost = 'unknown';
    let currentOrigin = '';
    try {
      const u = new URL(currentUrl);
      currentHost = u.hostname;
      currentOrigin = u.origin;
    } catch {
      throw new Error('Malformed URL requested');
    }

    // 1. SSRF and destination host check (error messages report hostname only, never full query/token)
    if (!isAllowedRemoteHost(currentUrl, allowedDomains, allowLocalTest)) {
      throw new Error(`SSRF blocked: Disallowed or untrusted remote host: ${currentHost}`);
    }

    const requestHeaders = new Headers(rawHeaders || {});

    // 2. Cookie and Authorization isolation gate:
    // Only allow Cookie and Authorization on exact platform origin.
    // Strip both on any external / CDN / redirect target regardless of whether options.cookie was set.
    if (currentOrigin === trustedOrigin) {
      if (cookie) {
        requestHeaders.set('cookie', cookie);
      }
    } else {
      requestHeaders.delete('cookie');
      requestHeaders.delete('authorization');
    }

    // 3. Finite header timeout
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new Error(`Network header timeout of ${headersTimeoutMs}ms exceeded`));
    }, headersTimeoutMs);

    let combinedSignal: AbortSignal;
    if (signal) {
      combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else {
      combinedSignal = timeoutController.signal;
    }

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        ...restInit,
        headers: requestHeaders,
        redirect: 'manual',
        signal: combinedSignal,
      });
    } finally {
      clearTimeout(timer);
    }

    // Check for redirect status
    const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
    if (!isRedirect) {
      return res;
    }

    // Handle redirect
    redirectsCount++;
    if (redirectsCount > maxRedirects) {
      if (res.body) {
        await res.body.cancel().catch(() => {});
      }
      throw new Error(`Exceeded maximum allowed redirects (${maxRedirects})`);
    }

    const location = res.headers.get('location');
    if (!location) {
      if (res.body) {
        await res.body.cancel().catch(() => {});
      }
      throw new Error(`Redirect HTTP ${res.status} missing Location header`);
    }

    // Cancel unused redirect body before proceeding
    if (res.body) {
      await res.body.cancel().catch(() => {});
    }

    // Resolve next URL
    currentUrl = new URL(location, currentUrl).toString();

    // On 303, change method to GET if it was not HEAD
    if (res.status === 303 && restInit.method !== 'HEAD') {
      restInit.method = 'GET';
      delete restInit.body;
    }
  }
}

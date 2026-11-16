/**
 * Platform constants and network configuration for Maktabkhooneh API.
 */

export const DEFAULT_ORIGIN = 'https://maktabkhooneh.org';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

/**
 * Allowed host patterns for media streaming and downloads.
 * Platform origins and known evidenced storage hosts only.
 * No broad cloud provider wildcards (e.g. no arbitrary *.arvancloud.ir or *.arvanstorage.com).
 */
export const ALLOWED_MEDIA_DOMAINS: readonly string[] = [
  'maktabkhooneh.org',
  '.maktabkhooneh.org',
  'arvanstorage.ir',
  '.arvanstorage.ir',
];

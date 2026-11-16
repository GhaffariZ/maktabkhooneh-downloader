/**
 * Formats byte values into human-readable Persian/tabular units.
 * Returns 'نامشخص' if bytes are missing or unknown.
 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) {
    return 'نامشخص';
  }
  if (bytes === 0) return '۰ بایت';

  const k = 1024;
  const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1);

  return `${val} ${sizes[i]}`;
}

/**
 * Formats duration in seconds into mm:ss or hh:mm:ss
 */
export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds) || seconds <= 0) {
    return '';
  }

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Persian labels for download states
 */
export function getDownloadStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return 'در صف';
    case 'downloading':
      return 'در حال دانلود';
    case 'paused':
      return 'متوقف شده';
    case 'completed':
      return 'آماده پخش آفلاین';
    case 'failed':
      return 'خطا';
    case 'canceled':
      return 'لغو شده';
    default:
      return status;
  }
}

/**
 * Formats raw quality labels or IDs into human-readable quality labels (e.g. '480 (mp4)' -> '480p').
 * Preserves clean labels like '720p', '1080p', 'HQ', 'LQ', and avoids exposing opaque numeric IDs.
 */
export function formatQualityLabel(label?: string, fallbackId?: string): string {
  if (label && typeof label === 'string' && label.trim().length > 0) {
    const trimmed = label.trim();
    // If label is an opaque numeric ID (>4 digits, e.g. '54680821'), do not expose raw digits
    if (/^\d{5,}$/.test(trimmed)) {
      return 'کیفیت استاندارد';
    }
    // Check if label contains resolution digits like '480 (mp4)' or '720' or '1080'
    const resMatch = trimmed.match(/^(\d{3,4})\s*(?:\([^)]*\)|p)?$/i);
    if (resMatch) {
      return `${resMatch[1]}p`;
    }
    // Clean trailing (mp4) or formats
    const cleaned = trimmed.replace(/\s*\([^)]*\)$/i, '');
    if (/^\d{3,4}$/.test(cleaned)) {
      return `${cleaned}p`;
    }
    return cleaned;
  }

  if (fallbackId && typeof fallbackId === 'string') {
    const trimmedId = fallbackId.trim();
    if (/^\d{3,4}p?$/i.test(trimmedId)) {
      return trimmedId.toLowerCase().endsWith('p') ? trimmedId : `${trimmedId}p`;
    }
    if (/^(hq|lq|hd|sd)$/i.test(trimmedId)) {
      return trimmedId.toUpperCase();
    }
    // If it's an opaque multi-digit numeric ID (e.g. '54680821'), do not expose raw digits
    if (/^\d+$/.test(trimmedId)) {
      return 'کیفیت استاندارد';
    }
    return trimmedId;
  }

  return 'استاندارد';
}

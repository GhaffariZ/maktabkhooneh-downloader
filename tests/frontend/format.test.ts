import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatDuration, formatQualityLabel, getDownloadStatusLabel } from '../../client/utils/format.js';

describe('Frontend Formatting Utilities', () => {
  describe('formatBytes', () => {
    it('returns "نامشخص" for undefined, null, or NaN', () => {
      assert.equal(formatBytes(undefined), 'نامشخص');
      assert.equal(formatBytes(null as unknown as number), 'نامشخص');
      assert.equal(formatBytes(NaN), 'نامشخص');
    });

    it('returns "۰ بایت" for 0 bytes', () => {
      assert.equal(formatBytes(0), '۰ بایت');
    });

    it('formats bytes into KB, MB, and GB with unit labels', () => {
      assert.match(formatBytes(1024), /کیلوبایت/);
      assert.match(formatBytes(1024 * 1024 * 50), /مگابایت/);
      assert.match(formatBytes(1024 * 1024 * 1024 * 2.5), /گیگابایت/);
    });
  });

  describe('formatDuration', () => {
    it('returns empty string for undefined, 0, or negative duration', () => {
      assert.equal(formatDuration(undefined), '');
      assert.equal(formatDuration(0), '');
      assert.equal(formatDuration(-10), '');
    });

    it('formats seconds into mm:ss', () => {
      assert.equal(formatDuration(65), '01:05');
      assert.equal(formatDuration(599), '09:59');
    });

    it('formats seconds into hh:mm:ss when duration >= 1 hour', () => {
      assert.equal(formatDuration(3665), '1:01:05');
      assert.equal(formatDuration(7200), '2:00:00');
    });
  });

  describe('getDownloadStatusLabel', () => {
    it('maps known download status codes to descriptive Persian labels', () => {
      assert.equal(getDownloadStatusLabel('queued'), 'در صف');
      assert.equal(getDownloadStatusLabel('downloading'), 'در حال دانلود');
      assert.equal(getDownloadStatusLabel('paused'), 'متوقف شده');
      assert.equal(getDownloadStatusLabel('completed'), 'آماده پخش آفلاین');
      assert.equal(getDownloadStatusLabel('failed'), 'خطا');
      assert.equal(getDownloadStatusLabel('canceled'), 'لغو شده');
    });
  });

  describe('formatQualityLabel', () => {
    it('converts raw API labels like "480 (mp4)" to clean resolutions like "480p"', () => {
      assert.equal(formatQualityLabel('480 (mp4)', '54680821'), '480p');
      assert.equal(formatQualityLabel('720 (mp4)', '54680822'), '720p');
    });

    it('masks opaque multi-digit numeric IDs into standard quality label', () => {
      assert.equal(formatQualityLabel(undefined, '54680821'), 'کیفیت استاندارد');
      assert.equal(formatQualityLabel('54680821', '54680821'), 'کیفیت استاندارد');
    });

    it('preserves clean resolution strings and standard badges', () => {
      assert.equal(formatQualityLabel('720p'), '720p');
      assert.equal(formatQualityLabel('1080p'), '1080p');
      assert.equal(formatQualityLabel('HQ'), 'HQ');
    });
  });
});

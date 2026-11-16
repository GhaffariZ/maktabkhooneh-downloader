import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCourseSlug,
  extractCourseIdFromSlug,
  sanitizeFileName,
  decodeHtmlEntities,
  isAllowedRemoteHost,
  buildLectureUrl,
  extractVideoSources,
  extractSubtitleLinks,
} from '../../../server/platform/url-parser.js';

describe('URL Parser & Utilities', () => {
  test('extractCourseSlug supports legacy format', () => {
    const slug = extractCourseSlug('https://maktabkhooneh.org/course/python-programming-mk10645/');
    assert.equal(slug, 'python-programming-mk10645');
  });

  test('extractCourseSlug supports LMS format with unit', () => {
    const slug = extractCourseSlug('https://maktabkhooneh.org/lms/course/machine-learning-mk20500/unit/45678/');
    assert.equal(slug, 'machine-learning-mk20500');
  });

  test('extractCourseSlug throws on unexpected origin', () => {
    assert.throws(() => {
      extractCourseSlug('https://evil.com/course/test-course/');
    }, /Unexpected origin/);
  });

  test('extractCourseIdFromSlug extracts numeric ID', () => {
    assert.equal(extractCourseIdFromSlug('python-mk10645'), 10645);
    assert.equal(extractCourseIdFromSlug('deep-learning-mk999'), 999);
    assert.equal(extractCourseIdFromSlug('no-id-slug'), null);
    assert.equal(extractCourseIdFromSlug(''), null);
  });

  test('sanitizeFileName removes forbidden characters and trims Persian marks', () => {
    const dirty = 'درس اول: ساختار پایتون / ویدیو * اصلی? <HD> | بخش ۱\u200c';
    const clean = sanitizeFileName(dirty);
    assert.ok(!clean.includes(':'));
    assert.ok(!clean.includes('/'));
    assert.ok(!clean.includes('*'));
    assert.ok(!clean.includes('?'));
    assert.ok(!clean.includes('<'));
    assert.ok(!clean.includes('>'));
    assert.ok(!clean.includes('|'));
    assert.equal(sanitizeFileName(''), 'unnamed');
  });

  test('decodeHtmlEntities decodes common and numbered entities', () => {
    assert.equal(decodeHtmlEntities('&quot;hello&quot; &amp; &lt;world&gt; &#39;test&#39;'), '"hello" & <world> \'test\'');
    assert.equal(decodeHtmlEntities(''), '');
  });

  test('isAllowedRemoteHost validates HTTPS and trusted domains', () => {
    assert.equal(isAllowedRemoteHost('https://maktabkhooneh.org/media/1.mp4'), true);
    assert.equal(isAllowedRemoteHost('https://cdn.maktabkhooneh.org/video.mp4'), true);
    assert.equal(isAllowedRemoteHost('https://s1.arvanstorage.ir/bucket/video.mp4'), true);
    // Arbitrary cloud provider domains disallowed
    assert.equal(isAllowedRemoteHost('https://arbitrary.arvancloud.ir/test.mp4'), false);
    // Disallowed domain
    assert.equal(isAllowedRemoteHost('https://evil-attacker.com/malware.exe'), false);
    // Insecure HTTP disallowed
    assert.equal(isAllowedRemoteHost('http://maktabkhooneh.org/media/1.mp4'), false);
    // Private / Loopback IPs disallowed in production mode
    assert.equal(isAllowedRemoteHost('https://127.0.0.1/video.mp4'), false);
    assert.equal(isAllowedRemoteHost('https://192.168.1.1/video.mp4'), false);
    assert.equal(isAllowedRemoteHost('https://localhost/video.mp4'), false);
    // Allow local test override
    assert.equal(isAllowedRemoteHost('http://127.0.0.1:9090/test.mp4', [], true), true);
  });

  test('buildLectureUrl builds correct lecture URL', () => {
    const oldUrl = buildLectureUrl(
      'https://maktabkhooneh.org',
      'python-slug',
      { id: 1, slug: 'intro' },
      { id: 10, slug: 'lesson-1' },
      false
    );
    assert.equal(oldUrl, 'https://maktabkhooneh.org/course/python-slug/intro-ch1/lesson-1/');

    const lmsUrl = buildLectureUrl(
      'https://maktabkhooneh.org',
      'python-slug',
      { id: 1 },
      { id: 105 },
      true
    );
    assert.equal(lmsUrl, 'https://maktabkhooneh.org/lms/course/python-slug/unit/105/');
  });

  test('extractVideoSources and extractSubtitleLinks parse HTML snippets', () => {
    const html = `
      <video>
        <source src="https://cdn.maktabkhooneh.org/videos/hq720/lesson.mp4" type="video/mp4">
        <source src="https://cdn.maktabkhooneh.org/videos/lq480/lesson.mp4" type="video/mp4">
        <track src="https://cdn.maktabkhooneh.org/subtitles/fa.vtt" kind="subtitles">
      </video>
    `;
    const videos = extractVideoSources(html);
    assert.equal(videos.length, 2);
    assert.ok(videos[0].includes('hq720'));

    const subs = extractSubtitleLinks(html);
    assert.equal(subs.length, 1);
    assert.ok(subs[0].includes('fa.vtt'));
  });
});

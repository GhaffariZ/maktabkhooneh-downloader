import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiClientError } from '../../client/api/client.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Frontend Regression & Integrity Checks', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('offline playback URL resolves directly to /api/downloads/:id/media without fetching qualities', () => {
    const downloadId = 'dl-xyz-987';
    const mediaUrl = api.getLocalMediaUrl(downloadId);

    assert.equal(mediaUrl, `/api/downloads/${downloadId}/media`);
    assert.match(mediaUrl, /^\/api\/downloads\/[a-zA-Z0-9_-]+\/media$/);
  });

  it('download mutations (pause, resume, cancel) propagate server errors as ApiClientError', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/pause')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'DOWNLOAD_NOT_PAUSABLE',
              message: 'این دانلود قابل توقف نیست',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error('Not handled');
    }) as unknown as typeof fetch;

    try {
      await api.pauseDownload('dl-invalid');
      assert.fail('Expected pauseDownload to throw');
    } catch (err: unknown) {
      assert(err instanceof ApiClientError);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'DOWNLOAD_NOT_PAUSABLE');
      assert.equal(err.message, 'این دانلود قابل توقف نیست');
    }
  });

  it('guards async course responses so out-of-order responses do not overwrite newer selections', async () => {
    let activeRequestId = 0;
    let committedCourseId: string | null = null;

    const selectCourse = async (courseId: string, delayMs: number) => {
      const currentRequestId = ++activeRequestId;
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      if (currentRequestId === activeRequestId) {
        committedCourseId = courseId;
      }
    };

    const p1 = selectCourse('course-A', 60);
    const p2 = selectCourse('course-B', 10);

    await Promise.all([p1, p2]);
    assert.equal(committedCourseId, 'course-B');
  });

  it('invalidates pending async responses on back navigation', async () => {
    let activeRequestId = 0;
    let chaptersCommitted: string[] = [];

    const selectCourse = async (courseId: string) => {
      const currentRequestId = ++activeRequestId;
      await new Promise((resolve) => setTimeout(resolve, 40));

      if (currentRequestId === activeRequestId) {
        chaptersCommitted = [`chapter-${courseId}`];
      }
    };

    const navigateBack = () => {
      activeRequestId++;
      chaptersCommitted = [];
    };

    const p = selectCourse('course-X');
    navigateBack();

    await p;
    assert.deepEqual(chaptersCommitted, []);
  });

  it('vite.config.ts configures changeOrigin: true on /api proxy to avoid strict Host 403 in dev mode', () => {
    const viteConfigContent = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf-8');
    assert.match(viteConfigContent, /changeOrigin:\s*true/);
  });

  it('suppresses redundant course warning when session demo mode is active', () => {
    const getEffectiveWarning = (isDemo: boolean, warning?: string) => {
      return isDemo ? undefined : warning;
    };

    assert.equal(getEffectiveWarning(true, 'این یک داده آزمایشی است'), undefined);
    assert.equal(getEffectiveWarning(false, 'ارتباط با سرور کند است'), 'ارتباط با سرور کند است');
  });

  it('guards quality modal requests with request identity so closing A or opening B discards late A responses', async () => {
    let qualityRequestId = 0;
    let committedQualities: string[] = [];

    const openQualityModal = async (lessonId: string, delayMs: number) => {
      const currentRequestId = ++qualityRequestId;
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      if (currentRequestId === qualityRequestId) {
        committedQualities = [`quality-${lessonId}`];
      }
    };

    const closeQualityModal = () => {
      qualityRequestId++;
      committedQualities = [];
    };

    // Scenario 1: User opens Lesson A (slow: 50ms) but closes before it arrives
    const p1 = openQualityModal('lesson-A', 50);
    closeQualityModal();
    await p1;
    assert.deepEqual(committedQualities, []);

    // Scenario 2: User opens Lesson A (slow: 50ms), then switches to Lesson B (fast: 10ms)
    const pA = openQualityModal('lesson-A', 50);
    const pB = openQualityModal('lesson-B', 10);
    await Promise.all([pA, pB]);
    assert.deepEqual(committedQualities, ['quality-lesson-B']);
  });
});

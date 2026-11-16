import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiClientError } from '../../client/api/client.js';

describe('Frontend API Client', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('init() fetches CSRF bootstrap token and includes it in subsequent mutations', async () => {
    let capturedBootstrap = false;
    let mutationHeader: string | null = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === '/api/bootstrap') {
        capturedBootstrap = true;
        return new Response(JSON.stringify({ csrfToken: 'test-csrf-token-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr === '/api/session/login') {
        const headers = init?.headers as Record<string, string>;
        mutationHeader = headers['X-CSRF-Token'];
        return new Response(JSON.stringify({ authenticated: true, demo: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    }) as unknown as typeof fetch;

    await api.init();
    assert.equal(capturedBootstrap, true);

    await api.login({ email: 'user@example.com', password: 'secret' });
    assert.equal(mutationHeader, 'test-csrf-token-123');
  });

  it('sets application/json Content-Type and empty JSON body on bodyless mutations', async () => {
    let capturedContentType: string | null = null;
    let capturedBody: unknown = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === '/api/courses/refresh') {
        const headers = init?.headers as Record<string, string>;
        capturedContentType = headers['Content-Type'];
        capturedBody = init?.body;
        return new Response(JSON.stringify({ courses: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    }) as unknown as typeof fetch;

    await api.refreshCourses();
    assert.equal(capturedContentType, 'application/json');
    assert.equal(capturedBody, '{}');
  });

  it('correctly constructs stream and local media URLs', () => {
    const streamUrl = api.getStreamUrl('lesson-12', 'course-45', '720p');
    assert.equal(streamUrl, '/api/lessons/lesson-12/stream?courseId=course-45&quality=720p');

    const mediaUrl = api.getLocalMediaUrl('download-789');
    assert.equal(mediaUrl, '/api/downloads/download-789/media');
  });

  it('throws ApiClientError with error code and message on server error', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'EXPIRED_SESSION',
            message: 'نشست کاربری منقضی شده است',
          },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as unknown as typeof fetch;

    try {
      await api.getCourses();
      assert.fail('Should have thrown ApiClientError');
    } catch (err: unknown) {
      assert(err instanceof ApiClientError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'EXPIRED_SESSION');
      assert.equal(err.message, 'نشست کاربری منقضی شده است');
    }
  });
});

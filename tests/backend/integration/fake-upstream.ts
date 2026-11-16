/**
 * Fake Upstream Maktabkhooneh Server for integration tests.
 * Runs on loopback and emulates exact platform endpoints and failure modes
 * including the evidenced /api/v1/general/csrf/ and
 * /api/v1/accounts/profile-courses/my_courses/ endpoints.
 */

import http from 'http';
import { DEMO_SAMPLE_BUFFER } from '../../../server/demo/demo-fixtures.js';

export interface FakeUpstreamOptions {
  ignoreRange?: boolean;
  simulateExpiredSession?: boolean;
}

export class FakeUpstreamServer {
  private server: http.Server;
  private port: number = 0;
  private mediaPayload: Buffer;
  public options: FakeUpstreamOptions;

  constructor(options: FakeUpstreamOptions = {}) {
    this.options = options;
    // 256KB buffer for range and resume tests
    this.mediaPayload = Buffer.alloc(256 * 1024, 0x42);
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  public async start(): Promise<{ port: number; url: string }> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as any;
        this.port = addr.port;
        resolve({ port: this.port, url: `http://127.0.0.1:${this.port}` });
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  public getUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private async parseBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname;
    const cookieHeader = req.headers.cookie || '';

    // Evidenced platform CSRF endpoint: GET /api/v1/general/csrf/
    if (pathname === '/api/v1/general/csrf/') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'csrftoken=fake-upstream-csrf-token; Path=/; SameSite=Lax',
      });
      res.end(JSON.stringify({ csrf: 'fake-upstream-csrf-token' }));
      return;
    }

    // Fallback: GET /accounts/login/
    if (pathname === '/accounts/login/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': 'csrftoken=fake-upstream-csrf-token; Path=/; SameSite=Lax',
      });
      res.end('<html><form><input name="csrfmiddlewaretoken" value="fake-upstream-csrf-token"></form></html>');
      return;
    }

    // GET /api/v1/general/core-data/
    if (pathname === '/api/v1/general/core-data/') {
      const isAuth = cookieHeader.includes('sessionid=fake-session-valid');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'csrftoken=fake-upstream-csrf-token; Path=/',
      });
      res.end(
        JSON.stringify({
          auth: {
            details: {
              is_authenticated: isAuth,
              email: isAuth ? 'user@example.com' : undefined,
              user_id: isAuth ? 12345 : undefined,
            },
            conditions: {
              has_subscription: isAuth,
              has_course_purchase: isAuth,
            },
            csrf: 'fake-upstream-csrf-token',
          },
        })
      );
      return;
    }

    // POST /api/v1/auth/check-active-user
    if (pathname === '/api/v1/auth/check-active-user') {
      const body = await this.parseBody(req);
      const params = new URLSearchParams(body);
      const email = params.get('tessera') || '';

      if (email === 'notfound@example.com') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'User not found' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'csrftoken=fake-upstream-csrf-token; Path=/',
      });
      res.end(JSON.stringify({ status: 'success', message: 'get-pass' }));
      return;
    }

    // POST /api/v1/auth/login-authentication
    if (pathname === '/api/v1/auth/login-authentication') {
      const body = await this.parseBody(req);
      const params = new URLSearchParams(body);
      const password = params.get('password');

      if (password === 'WrongPassword') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'اطلاعات ورود نامعتبر است' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': [
          'csrftoken=fake-upstream-csrf-token; Path=/',
          'sessionid=fake-session-valid; Path=/; HttpOnly',
        ],
      });
      res.end(JSON.stringify({ status: 'success', message: 'ok' }));
      return;
    }

    // GET /api/v1/lms/courses/10645/outline/
    if (pathname.includes('/outline/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          chapters: [
            {
              id: 1,
              title: 'فصل اول: مقدمات',
              units: [
                {
                  id: 101,
                  type: 1, // Video
                  title: 'درس اول: خوش‌آمدگویی',
                  duration: 300,
                  locked: false,
                },
                {
                  id: 102,
                  type: 1,
                  title: 'درس دوم: نصب و راه‌اندازی',
                  duration: 600,
                  locked: false,
                },
                {
                  id: 103,
                  type: 1,
                  title: 'درس سوم: قفل شده و غیرقابل دسترسی',
                  duration: 400,
                  locked: true, // Locked / inaccessible
                },
              ],
            },
          ],
        })
      );
      return;
    }

    // GET /api/v1/lms/units/101/video_url/
    if (pathname.includes('/video_url/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          qualities: [
            {
              id: '720p',
              resolution: 720,
              size: this.mediaPayload.length,
              download_url: `http://127.0.0.1:${this.port}/media/video-720.mp4`,
            },
          ],
        })
      );
      return;
    }

    // Evidenced platform owned courses endpoint: GET /api/v1/accounts/profile-courses/my_courses/
    if (pathname === '/api/v1/accounts/profile-courses/my_courses/') {
      if (this.options.simulateExpiredSession) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Authentication credentials were not provided.' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: 9876,
              title: 'آموزش پایتون حرفه‌ای',
              slug: 'python-programming',
              slug_id: 10645,
              image_url: 'https://maktabkhooneh.org/media/courses/python.jpg',
              teachers: [{ full_name: 'دکتر علیرضا رضایی' }],
              lessons_count: 2,
              specifics: { course_progress: 50 },
            },
          ],
        })
      );
      return;
    }

    // Redirect loop endpoint for testing hop limits
    if (pathname === '/test-redirect-loop/') {
      res.writeHead(302, {
        'Location': `http://127.0.0.1:${this.port}/test-redirect-loop/`,
      });
      res.end('Redirecting');
      return;
    }

    // Media endpoint with Range support
    if (pathname.startsWith('/media/')) {
      const fileSize = this.mediaPayload.length;
      const range = req.headers.range;

      if (this.options.ignoreRange || !range) {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
        });
        if (req.method === 'HEAD') res.end();
        else res.end(this.mediaPayload);
        return;
      }

      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      const chunk = this.mediaPayload.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunk.length,
        'Accept-Ranges': 'bytes',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(chunk);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found in fake upstream');
  }
}

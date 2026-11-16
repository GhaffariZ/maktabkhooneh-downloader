/**
 * Local HTTP Server and Request Router.
 * Implements the exact API contract, strict loopback security gates,
 * nosniff headers, explicit demo isolation, and outline-on-demand caching.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StorageManager } from './storage/storage-manager.js';
import { MaktabkhoonehClient } from './platform/client.js';
import { DownloadEngine } from './downloader/download-engine.js';
import { handleStreamLesson, serveLocalFile } from './stream/stream-proxy.js';
import {
  extractCourseSlug,
  extractCourseIdFromSlug,
} from './platform/url-parser.js';
import { normalizeCourseChapters } from './platform/outline-normalizer.js';
import {
  DEMO_COURSES,
  DEMO_CHAPTERS,
  DEMO_QUALITIES,
  getDemoSamplePath,
} from './demo/demo-fixtures.js';
import { extractAvailableQualities } from './platform/media.js';
import {
  Course,
  Chapter,
  Download,
  Quality,
  SessionState,
} from '../shared/types.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  clientDistDir?: string;
  platformOrigin?: string;
  allowLocalTest?: boolean;
  isDemo?: boolean;
  isDev?: boolean;
}

export class AppServer {
  private server: http.Server;
  private port: number;
  private host: string;
  private storage: StorageManager;
  private client: MaktabkhoonehClient;
  private downloadEngine: DownloadEngine;
  private clientDistDir: string;
  private allowLocalTest: boolean;
  private isDemo: boolean;
  private isDev: boolean;
  private csrfToken: string;

  constructor(options: ServerOptions = {}) {
    // Port 0 is allowed for dynamic test allocation
    this.port = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3210);
    this.host = '127.0.0.1'; // Only loopback host is accepted
    this.allowLocalTest = !!options.allowLocalTest;
    this.isDev = !!options.isDev || process.env.NODE_ENV === 'development';

    // Demo must be explicit (--demo / MK_DEMO=1)
    this.isDemo = options.isDemo ?? (process.env.MK_DEMO === '1' || process.env.MK_DEMO === 'true');

    this.clientDistDir = options.clientDistDir
      ? path.resolve(options.clientDistDir)
      : path.resolve(process.cwd(), 'dist', 'client');

    this.csrfToken = crypto.randomBytes(24).toString('hex');

    const baseDataDir = options.dataDir
      ? path.resolve(options.dataDir)
      : path.resolve(process.cwd(), 'data');
    const effectiveDataDir = this.isDemo ? path.join(baseDataDir, 'demo') : baseDataDir;

    this.storage = new StorageManager(effectiveDataDir);
    this.client = new MaktabkhoonehClient({
      origin: options.platformOrigin,
    });
    this.downloadEngine = new DownloadEngine({
      storage: this.storage,
      client: this.client,
      allowLocalTest: this.allowLocalTest,
    });

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public getStorage(): StorageManager {
    return this.storage;
  }

  public getClient(): MaktabkhoonehClient {
    return this.client;
  }

  public getDownloadEngine(): DownloadEngine {
    return this.downloadEngine;
  }

  public getPort(): number {
    return this.port;
  }

  public async start(): Promise<{ port: number; host: string }> {
    await this.storage.init();

    if (this.isDemo) {
      const demoDlDir = path.join(this.storage.getDataDir(), 'downloads');
      await fs.promises.mkdir(demoDlDir, { recursive: true });
      await this.storage.updateSettings({ downloadDirectory: demoDlDir });
    }

    this.downloadEngine.triggerWorker();

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
        }
        resolve({ port: this.port, host: this.host });
      });
      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    await this.downloadEngine.shutdown();

    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Main HTTP request router with security gates.
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'same-origin');

      // 1. Security Gate: Host validation (strictly enforced, no bypasses)
      const rawHost = req.headers.host || '';
      const allowedHosts = [
        `127.0.0.1:${this.port}`,
        `localhost:${this.port}`,
        `[::1]:${this.port}`,
      ];
      if (this.port === 80) {
        allowedHosts.push('127.0.0.1', 'localhost', '[::1]');
      }

      const isHostValid = allowedHosts.some((h) => rawHost.toLowerCase() === h.toLowerCase());
      if (!isHostValid) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INVALID_HOST', message: 'Host must be the local loopback server authority' } }));
        return;
      }

      // 2. Security Gate: Reject cross-site fetch metadata
      const secFetchSite = req.headers['sec-fetch-site'];
      if (secFetchSite === 'cross-site') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'CROSS_SITE_FORBIDDEN', message: 'Cross-site requests are rejected' } }));
        return;
      }

      const method = (req.method || 'GET').toUpperCase();

      // Dev-only CORS preflight support for Vite dev server (port 5173)
      if (this.isDev) {
        const originHeader = req.headers.origin;
        if (originHeader === 'http://127.0.0.1:5173' || originHeader === 'http://localhost:5173') {
          res.setHeader('Access-Control-Allow-Origin', originHeader);
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
          if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }
        }
      }

      const isMutation = method === 'POST' || method === 'PUT' || method === 'DELETE';

      // 3. Security Gate: Mutation Origin and Content-Type enforcement
      if (isMutation) {
        // Enforce application/json for ALL mutations (including logout, refresh, actions)
        const contentType = req.headers['content-type'] || '';
        if (!contentType.toLowerCase().includes('application/json')) {
          res.writeHead(415, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json for all mutations' } }));
          return;
        }

        const originHeader = req.headers.origin;
        const refererHeader = req.headers.referer;

        const allowedOrigins = [
          `http://127.0.0.1:${this.port}`,
          `http://localhost:${this.port}`,
        ];
        if (this.isDev) {
          allowedOrigins.push('http://127.0.0.1:5173', 'http://localhost:5173');
        }

        const checkMatch = (val?: string) => {
          if (!val) return true;
          try {
            const u = new URL(val);
            return allowedOrigins.includes(u.origin);
          } catch {
            return false;
          }
        };

        if ((originHeader && !checkMatch(originHeader)) || (refererHeader && !checkMatch(refererHeader))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Mutation origin must match loopback origin' } }));
          return;
        }

        // Validate CSRF token if provided
        const providedCsrf = req.headers['x-csrf-token'];
        if (providedCsrf && providedCsrf !== this.csrfToken) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'INVALID_CSRF_TOKEN', message: 'CSRF token mismatch' } }));
          return;
        }
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = parsedUrl.pathname;

      if (pathname.startsWith('/api/')) {
        await this.handleApiRoute(req, res, pathname, method, parsedUrl);
        return;
      }

      this.serveStatic(req, res, pathname);
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message: err.message || 'Unknown server error' } }));
      }
    }
  }

  /**
   * Bounded and validated JSON body parser.
   * Enforces 1MB limit, valid object structure, and rejects arrays.
   */
  private async parseJsonBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<any> {
    const maxBytes = 1024 * 1024;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    return new Promise((resolve) => {
      let aborted = false;

      req.on('data', (chunk: Buffer) => {
        if (aborted) return;
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          aborted = true;
          req.destroy();
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeded 1 MB limit' } }));
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (aborted) return;
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) {
          resolve({});
          return;
        }
        try {
          const parsed = JSON.parse(text);
          // Reject arrays and primitive types: body must be a JSON object
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            resolve(parsed);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'INVALID_JSON', message: 'JSON body must be an object, not an array' } }));
            resolve(null);
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'INVALID_JSON', message: 'Malformed JSON payload' } }));
          resolve(null);
        }
      });

      req.on('error', () => {
        if (!aborted) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Failed to read request body' } }));
          resolve(null);
        }
      });
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
  }

  private sendError(res: http.ServerResponse, statusCode: number, code: string, message: string): void {
    this.sendJson(res, statusCode, { error: { code, message } });
  }

  /**
   * Route handlers for all /api endpoints.
   */
  private async handleApiRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    method: string,
    parsedUrl: URL
  ): Promise<void> {
    // GET /api/bootstrap -> { csrfToken }
    if (pathname === '/api/bootstrap' && method === 'GET') {
      this.sendJson(res, 200, { csrfToken: this.csrfToken });
      return;
    }

    // GET /api/session -> { authenticated: boolean, email?: string, demo: boolean }
    if (pathname === '/api/session' && method === 'GET') {
      const session = this.storage.getSession();
      const authenticated = !!session.cookie;
      const state: SessionState = {
        authenticated,
        email: session.email,
        demo: this.isDemo,
      };
      this.sendJson(res, 200, state);
      return;
    }

    // POST /api/session/login body { email, password }
    if (pathname === '/api/session/login' && method === 'POST') {
      const body = await this.parseJsonBody(req, res);
      if (!body) return;

      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!email || !password || email.length > 255 || password.length > 255) {
        this.sendError(res, 400, 'INVALID_INPUT', 'ایمیل و رمز عبور معتبر الزامی است.');
        return;
      }

      // Demo login must not contact real platform
      if (this.isDemo) {
        this.sendJson(res, 200, {
          authenticated: true,
          email,
          demo: true,
        });
        return;
      }

      try {
        const result = await this.client.loginWithCredentials(email, password);
        await this.storage.setSession(email, result.cookie);
        this.sendJson(res, 200, {
          authenticated: true,
          email,
          demo: false,
        });
      } catch (err: any) {
        this.sendError(res, 401, 'INVALID_CREDENTIALS', err.message || 'ورود به حساب ناموفق بود.');
      }
      return;
    }

    // POST /api/session/logout -> { ok: true }
    if (pathname === '/api/session/logout' && method === 'POST') {
      await this.storage.clearSession();
      this.sendJson(res, 200, { ok: true });
      return;
    }

    // GET /api/courses -> { courses: Course[], warning?: string }
    if (pathname === '/api/courses' && method === 'GET') {
      if (this.isDemo) {
        this.sendJson(res, 200, {
          courses: DEMO_COURSES,
          warning: 'حالت نمایشی فعال است؛ دوره‌های زیر به عنوان نمونه نمایش داده شده‌اند.',
        });
        return;
      }

      const session = this.storage.getSession();
      let courses = this.storage.getCourses();

      if (courses.length === 0 && session.cookie) {
        const discovery = await this.client.discoverOwnedCourses(session.cookie);
        if (discovery.expired) {
          await this.storage.clearSession();
          this.sendJson(res, 200, { courses: [], warning: discovery.warning });
          return;
        }

        if (discovery.courses.length > 0) {
          for (const c of discovery.courses) {
            await this.storage.saveCourse(c);
          }
          courses = this.storage.getCourses();
        }
        this.sendJson(res, 200, { courses, warning: discovery.warning });
        return;
      }

      this.sendJson(res, 200, { courses });
      return;
    }

    // POST /api/courses/refresh -> { courses: Course[], warning?: string }
    if (pathname === '/api/courses/refresh' && method === 'POST') {
      if (this.isDemo) {
        this.sendJson(res, 200, {
          courses: DEMO_COURSES,
          warning: 'در حالت نمایشی داده‌های آزمایشی فعال هستند.',
        });
        return;
      }

      const session = this.storage.getSession();
      if (!session.cookie) {
        const cached = this.storage.getCourses();
        this.sendJson(res, 200, {
          courses: cached,
          warning: 'برای به‌روزرسانی دوره‌های خریداری‌شده، لطفاً ابتدا وارد حساب کاربری شوید.',
        });
        return;
      }

      const discovery = await this.client.discoverOwnedCourses(session.cookie);
      if (discovery.expired) {
        await this.storage.clearSession();
        const cached = this.storage.getCourses();
        this.sendJson(res, 200, { courses: cached, warning: discovery.warning });
        return;
      }

      for (const c of discovery.courses) {
        await this.storage.saveCourse(c);
      }

      const courses = this.storage.getCourses();
      this.sendJson(res, 200, { courses, warning: discovery.warning });
      return;
    }

    // POST /api/courses/import body { url: string }
    if (pathname === '/api/courses/import' && method === 'POST') {
      const body = await this.parseJsonBody(req, res);
      if (!body) return;

      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!url || url.length > 1000) {
        this.sendError(res, 400, 'INVALID_INPUT', 'پیوند دوره نامعتبر است.');
        return;
      }

      // Demo import must not contact real platform
      if (this.isDemo) {
        this.sendJson(res, 200, { course: DEMO_COURSES[0] });
        return;
      }

      let slug: string;
      try {
        slug = extractCourseSlug(url, this.client.getOrigin());
      } catch (err: any) {
        this.sendError(res, 400, 'INVALID_COURSE_URL', err.message);
        return;
      }

      const courseIdNum = extractCourseIdFromSlug(slug);
      const session = this.storage.getSession();

      try {
        const rawChaptersData = await this.client.fetchChapters(
          slug,
          url,
          courseIdNum,
          session.cookie
        );

        const { chapters, lessonCount } = normalizeCourseChapters(rawChaptersData);
        const courseTitle = decodeURIComponent(slug).replace(/-/g, ' ');
        const courseId = String(courseIdNum || slug);

        const course: Course = {
          id: courseId,
          title: courseTitle,
          slug,
          lessonCount,
          downloadedCount: 0,
        };

        await this.storage.saveCourse(course, chapters);
        this.sendJson(res, 200, { course });
      } catch (err: any) {
        this.sendError(res, 502, 'IMPORT_FAILED', `دریافت سرفصل‌های دوره ناموفق بود: ${err.message}`);
      }
      return;
    }

    // GET /api/courses/:id -> { course: Course, chapters: Chapter[] }
    const courseMatch = pathname.match(/^\/api\/courses\/([^/]+)$/);
    if (courseMatch && method === 'GET') {
      const courseId = decodeURIComponent(courseMatch[1]);

      if (courseId === 'demo-python' || courseId === 'demo-web-dev') {
        if (!this.isDemo) {
          this.sendError(res, 404, 'COURSE_NOT_FOUND', 'دوره مورد نظر یافت نشد.');
          return;
        }
        const demoCourse = DEMO_COURSES.find((c) => c.id === courseId);
        const demoChapters = DEMO_CHAPTERS[courseId] || [];
        this.sendJson(res, 200, {
          course: demoCourse,
          chapters: demoChapters,
        });
        return;
      }

      let cached = this.storage.getCourseDetails(courseId);
      if (!cached) {
        this.sendError(res, 404, 'COURSE_NOT_FOUND', 'دوره مورد نظر یافت نشد.');
        return;
      }

      // Fetch outline on demand if chapters are not cached
      if (!cached.chapters || cached.chapters.length === 0) {
        try {
          const session = this.storage.getSession();
          const courseIdNum = extractCourseIdFromSlug(cached.course.slug);
          const rawChapters = await this.client.fetchChapters(
            cached.course.slug,
            undefined,
            courseIdNum,
            session.cookie
          );
          const { chapters, lessonCount } = normalizeCourseChapters(rawChapters);
          cached.course.lessonCount = lessonCount;
          await this.storage.saveCourse(cached.course, chapters);
          cached = this.storage.getCourseDetails(courseId) || { course: cached.course, chapters };
        } catch (err: any) {
          console.warn(`Outline fetch on demand failed for ${courseId}:`, err.message);
        }
      }

      this.sendJson(res, 200, {
        course: cached.course,
        chapters: cached.chapters,
      });
      return;
    }

    // Helper: validate lesson belongs to course and is accessible (NO fake bypasses)
    const resolveAndValidateLesson = async (
      cId: string,
      lId: string
    ): Promise<{ valid: boolean; accessible: boolean; title?: string }> => {
      if (this.isDemo) {
        const demoChapters = DEMO_CHAPTERS[cId] || [];
        for (const ch of demoChapters) {
          const found = ch.lessons.find((l) => l.id === lId);
          if (found) {
            return { valid: true, accessible: found.accessible, title: found.title };
          }
        }
        return { valid: false, accessible: false };
      }

      let courseDetails = this.storage.getCourseDetails(cId);
      if (!courseDetails) return { valid: false, accessible: false };

      if (!courseDetails.chapters || courseDetails.chapters.length === 0) {
        try {
          const session = this.storage.getSession();
          const courseIdNum = extractCourseIdFromSlug(courseDetails.course.slug);
          const rawChapters = await this.client.fetchChapters(
            courseDetails.course.slug,
            undefined,
            courseIdNum,
            session.cookie
          );
          const { chapters, lessonCount } = normalizeCourseChapters(rawChapters);
          courseDetails.course.lessonCount = lessonCount;
          await this.storage.saveCourse(courseDetails.course, chapters);
          courseDetails = this.storage.getCourseDetails(cId) || { course: courseDetails.course, chapters };
        } catch {}
      }

      for (const ch of courseDetails.chapters) {
        const found = ch.lessons.find((l) => l.id === lId);
        if (found) {
          return { valid: true, accessible: found.accessible, title: found.title };
        }
      }

      return { valid: false, accessible: false };
    };

    // GET /api/lessons/:id/qualities?courseId=... -> { qualities: Quality[] }
    const qualitiesMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/qualities$/);
    if (qualitiesMatch && method === 'GET') {
      const lessonId = decodeURIComponent(qualitiesMatch[1]);
      const courseId = parsedUrl.searchParams.get('courseId') || '';

      if (!courseId) {
        this.sendError(res, 400, 'MISSING_PARAM', 'courseId الزامی است.');
        return;
      }

      const check = await resolveAndValidateLesson(courseId, lessonId);
      if (!check.valid) {
        this.sendError(res, 404, 'LESSON_NOT_FOUND', 'درس مورد نظر در این دوره یافت نشد.');
        return;
      }
      if (!check.accessible) {
        this.sendError(res, 403, 'LESSON_NOT_ACCESSIBLE', 'این درس قفل است و دسترسی به آن نیازمند خرید یا ثبت‌نام است.');
        return;
      }

      // Demo mode: honest sample qualities for synthetic asset
      if (this.isDemo) {
        this.sendJson(res, 200, { qualities: DEMO_QUALITIES });
        return;
      }

      try {
        const session = this.storage.getSession();
        const videoData = await this.client.fetchUnitVideoUrl(lessonId, undefined, session.cookie);
        const qualities = extractAvailableQualities(videoData);
        this.sendJson(res, 200, { qualities });
      } catch (err: any) {
        this.sendError(res, 502, 'FETCH_QUALITIES_FAILED', err.message);
      }
      return;
    }

    // GET /api/lessons/:id/stream?courseId=...&quality=...
    const streamMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/stream$/);
    if (streamMatch && (method === 'GET' || method === 'HEAD')) {
      const lessonId = decodeURIComponent(streamMatch[1]);
      const courseId = parsedUrl.searchParams.get('courseId') || '';
      const quality = parsedUrl.searchParams.get('quality') || undefined;

      if (!courseId) {
        this.sendError(res, 400, 'MISSING_PARAM', 'courseId الزامی است.');
        return;
      }

      const check = await resolveAndValidateLesson(courseId, lessonId);
      if (!check.valid) {
        this.sendError(res, 404, 'LESSON_NOT_FOUND', 'درس مورد نظر در این دوره یافت نشد.');
        return;
      }
      if (!check.accessible) {
        this.sendError(res, 403, 'LESSON_NOT_ACCESSIBLE', 'این درس در دسترس نیست.');
        return;
      }

      // Demo mode: stream genuine synthetic asset using serveLocalFile range logic
      if (this.isDemo) {
        const demoSample = getDemoSamplePath();
        if (!fs.existsSync(demoSample)) {
          this.sendError(res, 404, 'DEMO_MEDIA_NOT_FOUND', 'فایل ویدیویی آزمایشی یافت نشد.');
          return;
        }
        await serveLocalFile(req, res, demoSample, 'video/mp4');
        return;
      }

      await handleStreamLesson(req, res, {
        courseId,
        lessonId,
        quality,
        client: this.client,
        storage: this.storage,
        allowLocalTest: this.allowLocalTest,
      });
      return;
    }

    // GET /api/downloads -> { downloads: Download[] }
    if (pathname === '/api/downloads' && method === 'GET') {
      const downloads = this.storage.getDownloads();
      this.sendJson(res, 200, { downloads });
      return;
    }

    // POST /api/downloads body { courseId, lessonId, quality }
    if (pathname === '/api/downloads' && method === 'POST') {
      const body = await this.parseJsonBody(req, res);
      if (!body) return;

      const courseId = typeof body.courseId === 'string' ? body.courseId.trim() : '';
      const lessonId = typeof body.lessonId === 'string' ? body.lessonId.trim() : '';
      const quality = typeof body.quality === 'string' ? body.quality.trim() : 'default';

      if (!courseId || !lessonId || courseId.length > 100 || lessonId.length > 100) {
        this.sendError(res, 400, 'INVALID_INPUT', 'شناسه معتبر دوره و درس الزامی است.');
        return;
      }

      const check = await resolveAndValidateLesson(courseId, lessonId);
      if (!check.valid) {
        this.sendError(res, 404, 'LESSON_NOT_FOUND', 'درس مورد نظر در این دوره یافت نشد.');
        return;
      }
      if (!check.accessible) {
        this.sendError(res, 403, 'LESSON_NOT_ACCESSIBLE', 'این درس در دسترس نیست و امکان دانلود آن وجود ندارد.');
        return;
      }

      // Demo mode: local synthetic download into managed download folder
      if (this.isDemo) {
        const demoSample = getDemoSamplePath();
        if (!fs.existsSync(demoSample)) {
          this.sendError(res, 404, 'DEMO_MEDIA_NOT_FOUND', 'فایل ویدیویی آزمایشی یافت نشد.');
          return;
        }
        const settings = this.storage.getSettings();
        const demoFolder = path.join(settings.downloadDirectory, courseId);
        await fs.promises.mkdir(demoFolder, { recursive: true });
        const destPath = path.join(demoFolder, `${lessonId}-demo.mp4`);
        await fs.promises.copyFile(demoSample, destPath);
        const st = await fs.promises.stat(destPath);
        const job: Download = {
          id: `demo-dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          courseId,
          lessonId,
          courseTitle: courseId,
          lessonTitle: check.title || lessonId,
          quality: quality || 'demo-720p',
          status: 'completed',
          downloadedBytes: st.size,
          totalBytes: st.size,
          filePath: destPath,
          updatedAt: new Date().toISOString(),
        };
        await this.storage.saveDownload(job);
        this.sendJson(res, 201, { download: job });
        return;
      }

      const courseDetails = this.storage.getCourseDetails(courseId);
      const courseTitle = courseDetails?.course?.title || courseId;
      const lessonTitle = check.title || lessonId;

      const job = await this.downloadEngine.enqueue(
        courseId,
        lessonId,
        quality,
        courseTitle,
        lessonTitle
      );
      this.sendJson(res, 200, { download: job });
      return;
    }

    // POST /api/downloads/:id/pause -> { download: Download }
    const pauseMatch = pathname.match(/^\/api\/downloads\/([^/]+)\/pause$/);
    if (pauseMatch && method === 'POST') {
      const id = decodeURIComponent(pauseMatch[1]);
      try {
        const job = await this.downloadEngine.pause(id);
        this.sendJson(res, 200, { download: job });
      } catch (err: any) {
        this.sendError(res, 404, 'JOB_NOT_FOUND', err.message);
      }
      return;
    }

    // POST /api/downloads/:id/resume -> { download: Download }
    const resumeMatch = pathname.match(/^\/api\/downloads\/([^/]+)\/resume$/);
    if (resumeMatch && method === 'POST') {
      const id = decodeURIComponent(resumeMatch[1]);
      try {
        const job = await this.downloadEngine.resume(id);
        this.sendJson(res, 200, { download: job });
      } catch (err: any) {
        this.sendError(res, 404, 'JOB_NOT_FOUND', err.message);
      }
      return;
    }

    // POST /api/downloads/:id/cancel -> { download: Download }
    const cancelMatch = pathname.match(/^\/api\/downloads\/([^/]+)\/cancel$/);
    if (cancelMatch && method === 'POST') {
      const id = decodeURIComponent(cancelMatch[1]);
      try {
        const job = await this.downloadEngine.cancel(id);
        this.sendJson(res, 200, { download: job });
      } catch (err: any) {
        this.sendError(res, 404, 'JOB_NOT_FOUND', err.message);
      }
      return;
    }

    // GET /api/downloads/:id/media -> completed local file only, full HTTP Range/HEAD
    const mediaMatch = pathname.match(/^\/api\/downloads\/([^/]+)\/media$/);
    if (mediaMatch && (method === 'GET' || method === 'HEAD')) {
      const id = decodeURIComponent(mediaMatch[1]);
      const job = this.storage.getDownload(id);
      if (!job || job.status !== 'completed' || !job.filePath || !fs.existsSync(job.filePath)) {
        this.sendError(res, 404, 'MEDIA_NOT_FOUND', 'فایل دانلود شده موجود نیست یا دانلود کامل نشده است.');
        return;
      }
      await serveLocalFile(req, res, job.filePath);
      return;
    }

    // GET /api/settings -> { downloadDirectory: string }
    if (pathname === '/api/settings' && method === 'GET') {
      const settings = this.storage.getSettings();
      this.sendJson(res, 200, settings);
      return;
    }

    // PUT /api/settings body { downloadDirectory: string }
    if (pathname === '/api/settings' && method === 'PUT') {
      const body = await this.parseJsonBody(req, res);
      if (!body) return;

      const dir = typeof body.downloadDirectory === 'string' ? body.downloadDirectory.trim() : '';
      if (!dir || !path.isAbsolute(dir) || dir.length > 1000) {
        this.sendError(res, 400, 'INVALID_INPUT', 'مسیر پوشه دانلود باید یک مسیر معتبر و مطلق (Absolute) باشد.');
        return;
      }

      try {
        const updated = await this.storage.updateSettings({ downloadDirectory: dir });
        this.sendJson(res, 200, updated);
      } catch (err: any) {
        this.sendError(res, 400, 'INVALID_DIRECTORY', err.message);
      }
      return;
    }

    this.sendError(res, 404, 'NOT_FOUND', `مسیر API یافت نشد: ${method} ${pathname}`);
  }

  /**
   * Serve static client files or fallback to index.html for SPA routes.
   */
  private serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
    if (!fs.existsSync(this.clientDistDir)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><title>داشبورد مکتب‌خونه</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;">
  <h2>داشبورد محلی مکتب‌خونه</h2>
  <p>سرور محلی با موفقیت راه‌اندازی شد. فرانت‌اند در حال ساخت است.</p>
</body>
</html>`);
      return;
    }

    const safeRelative = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    let candidatePath = path.join(this.clientDistDir, safeRelative);

    try {
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
        candidatePath = path.join(candidatePath, 'index.html');
      }
    } catch {}

    if (!fs.existsSync(candidatePath)) {
      candidatePath = path.join(this.clientDistDir, 'index.html');
    }

    if (!fs.existsSync(candidatePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(candidatePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.mp4': 'video/mp4',
    };

    const contentType = mimeMap[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(candidatePath).pipe(res);
  }
}

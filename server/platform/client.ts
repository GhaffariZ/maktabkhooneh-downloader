/**
 * Maktabkhooneh Platform Client.
 * Implements evidenced API integration based on actual platform bundles:
 * - Evidenced CSRF endpoint: /api/v1/general/csrf/
 * - Evidenced owned courses endpoint: /api/v1/accounts/profile-courses/my_courses/
 * - Verified card fields: title, image_url, teachers[].full_name, slug, slug_id, id
 * - Canonical slug construction: ${slug}-mk${slug_id}
 * - Bounded response sizes, total timeout across redirects (<= 5 hops),
 *   discarded redirect body cancellation, cookie propagation on redirects,
 * - Exact origin redirect validation and credential privacy.
 */

import { DEFAULT_ORIGIN, DEFAULT_USER_AGENT } from './constants.js';
import { SimpleCookieStore } from './cookies.js';
import { Course } from '../../shared/types.js';

export interface ProfileSummary {
  isAuthenticated: boolean;
  email?: string;
  userId?: string | number;
  studentId?: string | number;
  hasSubscription: boolean;
  hasCoursePurchase: boolean;
  raw?: any;
}

export interface DiscoveryResult {
  courses: Course[];
  warning?: string;
  expired?: boolean;
}

export class MaktabkhoonehClient {
  private origin: string;
  private userAgent: string;

  constructor(options: { origin?: string; userAgent?: string } = {}) {
    this.origin = (options.origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
  }

  public getOrigin(): string {
    return this.origin;
  }

  private commonHeaders(referer?: string, cookie?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9,fa;q=0.8',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': this.userAgent,
    };
    if (cookie) {
      headers['cookie'] = cookie;
    }
    if (referer) {
      headers['referer'] = referer;
    }
    return headers;
  }

  /**
   * Bounded fetch helper that enforces:
   * - Total timeout across all redirect hops (never resets on redirect)
   * - Maximum 5 redirect hops
   * - Cancellation of discarded redirect bodies to free connections
   * - Cookie propagation across redirects
   * - Strict same-platform origin redirect validation
   * - Maximum response byte cap
   */
  public async fetchBounded(
    initialUrl: string,
    options: RequestInit = {},
    timeoutMs: number = 30_000,
    maxBytes: number = 5 * 1024 * 1024,
    cookieStore?: SimpleCookieStore
  ): Promise<{ res: Response; body: string }> {
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let currentUrl = initialUrl;
    let redirectCount = 0;
    const maxRedirects = 5;

    let currentHeaders: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };

    try {
      while (true) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          controller.abort();
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }

        const res = await fetch(currentUrl, {
          ...options,
          headers: currentHeaders,
          signal: controller.signal,
          redirect: 'manual', // Enforce manual redirect handling
        });

        // Capture any Set-Cookie headers on redirects or final response
        if (typeof (res.headers as any).getSetCookie === 'function') {
          const setCookies = (res.headers as any).getSetCookie();
          if (cookieStore) {
            cookieStore.applySetCookie(setCookies);
            currentHeaders['cookie'] = cookieStore.headerString();
          }
        }

        // Check for redirect status
        if (
          res.status === 301 ||
          res.status === 302 ||
          res.status === 303 ||
          res.status === 307 ||
          res.status === 308
        ) {
          redirectCount++;
          if (redirectCount > maxRedirects) {
            if (res.body) {
              try { await res.body.cancel(); } catch {}
            }
            throw new Error(`Exceeded maximum redirect limit of ${maxRedirects} hops`);
          }

          const location = res.headers.get('location');
          if (!location) {
            if (res.body) {
              try { await res.body.cancel(); } catch {}
            }
            throw new Error(`Redirect response missing Location header (status ${res.status})`);
          }

          const redirectUrl = new URL(location, currentUrl);
          const platformUrl = new URL(this.origin);
          if (redirectUrl.origin !== platformUrl.origin) {
            if (res.body) {
              try { await res.body.cancel(); } catch {}
            }
            throw new Error(`Insecure redirect to third-party origin: ${redirectUrl.origin}`);
          }

          // Properly cancel / drain the discarded redirect body
          if (res.body) {
            try {
              await res.body.cancel();
            } catch {}
          }

          currentUrl = redirectUrl.toString();
          continue;
        }

        // Read and bound non-redirect body
        if (!res.body) {
          return { res, body: '' };
        }

        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              totalBytes += value.length;
              if (totalBytes > maxBytes) {
                try { await reader.cancel(); } catch {}
                throw new Error(`Response exceeded maximum allowed size of ${maxBytes} bytes`);
              }
              chunks.push(value);
            }
          }
        } catch (readErr) {
          try { await reader.cancel(); } catch {}
          throw readErr;
        }

        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const bodyText = new TextDecoder('utf-8').decode(combined);
        return { res, body: bodyText };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Obtain CSRF token using the evidenced public endpoint /api/v1/general/csrf/
   * followed by fallback to /accounts/login/ and /api/v1/general/core-data/.
   */
  public async obtainCsrfToken(store: SimpleCookieStore): Promise<string> {
    // 1. Evidenced platform endpoint
    try {
      const csrfUrl = `${this.origin}/api/v1/general/csrf/`;
      const { res, body } = await this.fetchBounded(csrfUrl, {
        method: 'GET',
        headers: this.commonHeaders(this.origin),
      }, 30_000, 5 * 1024 * 1024, store);

      if (typeof (res.headers as any).getSetCookie === 'function') {
        store.applySetCookie((res.headers as any).getSetCookie());
      }
      try {
        const json = JSON.parse(body);
        if (json?.csrf && typeof json.csrf === 'string') {
          return json.csrf;
        }
      } catch {}
      const ck = store.get('csrftoken');
      if (ck) return ck;
    } catch {
      // Continue to fallback
    }

    // 2. Fallback: GET /accounts/login/
    try {
      const loginPageUrl = `${this.origin}/accounts/login/`;
      const { res, body } = await this.fetchBounded(loginPageUrl, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      }, 30_000, 5 * 1024 * 1024, store);

      if (typeof (res.headers as any).getSetCookie === 'function') {
        store.applySetCookie((res.headers as any).getSetCookie());
      }
      const ck = store.get('csrftoken');
      if (ck) return ck;

      // Extract from hidden input if present
      const m = body.match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)["']/i);
      if (m && m[1]) return m[1];
    } catch {
      // Continue to fallback
    }

    // 3. Fallback: core-data
    try {
      const coreUrl = `${this.origin}/api/v1/general/core-data/?profile=1`;
      const { res, body } = await this.fetchBounded(coreUrl, {
        method: 'GET',
        headers: this.commonHeaders(this.origin),
      }, 30_000, 5 * 1024 * 1024, store);
      if (typeof (res.headers as any).getSetCookie === 'function') {
        store.applySetCookie((res.headers as any).getSetCookie());
      }
      const ck = store.get('csrftoken');
      if (ck) return ck;
      const json = JSON.parse(body);
      if (json?.auth?.csrf) return json.auth.csrf;
    } catch {}

    throw new Error('Unable to obtain CSRF token from Maktabkhooneh');
  }

  /**
   * Fetch core-data to check authentication status and account details.
   */
  public async fetchCoreData(cookie?: string, referer?: string): Promise<ProfileSummary> {
    const url = `${this.origin}/api/v1/general/core-data/?profile=1`;
    const { res, body } = await this.fetchBounded(url, {
      method: 'GET',
      headers: {
        ...this.commonHeaders(referer || this.origin, cookie),
        accept: 'application/json',
      },
    });

    if (res.status === 401 || res.status === 403) {
      return {
        isAuthenticated: false,
        hasSubscription: false,
        hasCoursePurchase: false,
      };
    }

    if (!res.ok) {
      throw new Error(`Core-data request failed: ${res.status} ${res.statusText}`);
    }

    const json = JSON.parse(body);
    const isAuth = !!json?.auth?.details?.is_authenticated;
    const email = json?.auth?.details?.email || json?.profile?.details?.email;
    const userId = json?.auth?.details?.user_id;
    const studentId = json?.auth?.details?.student_id;
    const hasSubscription = !!json?.auth?.conditions?.has_subscription;
    const hasCoursePurchase = !!json?.auth?.conditions?.has_course_purchase;

    return {
      isAuthenticated: isAuth,
      email: email || undefined,
      userId,
      studentId,
      hasSubscription,
      hasCoursePurchase,
      raw: json,
    };
  }

  /**
   * Login with email and password using the platform's multi-step authentication.
   * Never logs passwords or sensitive credentials.
   * Verifies profile authentication before returning success.
   */
  public async loginWithCredentials(
    email: string,
    pass: string
  ): Promise<{ cookie: string; profile: ProfileSummary }> {
    if (!email || !pass) {
      throw new Error('Email and password are required for login');
    }

    const store = new SimpleCookieStore();
    const csrf = await this.obtainCsrfToken(store);

    const addCsrfHeaders = (headers: Record<string, string> = {}) => ({
      ...headers,
      'X-CSRFToken': csrf,
      'Origin': this.origin,
      'Referer': `${this.origin}/accounts/login/`,
      'User-Agent': this.userAgent,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': store.headerString(),
    });

    // Step 1: check-active-user
    const formCheck = new URLSearchParams();
    formCheck.append('csrfmiddlewaretoken', csrf);
    formCheck.append('tessera', email);
    formCheck.append('g-recaptcha-response', '');

    const { res: checkRes, body: checkBody } = await this.fetchBounded(
      `${this.origin}/api/v1/auth/check-active-user`,
      {
        method: 'POST',
        headers: addCsrfHeaders({
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        }),
        body: formCheck.toString(),
      },
      30_000,
      5 * 1024 * 1024,
      store
    );

    if (typeof (checkRes.headers as any).getSetCookie === 'function') {
      store.applySetCookie((checkRes.headers as any).getSetCookie());
    }

    let checkJson: any = null;
    try {
      checkJson = JSON.parse(checkBody);
    } catch {
      throw new Error(`check-active-user returned invalid response (status ${checkRes.status})`);
    }

    if (checkJson.status !== 'success') {
      throw new Error(checkJson.message || `کاربری با این مشخصات یافت نشد (وضعیت: ${checkJson.status})`);
    }
    if (checkJson.message !== 'get-pass') {
      throw new Error(`جریان احراز هویت پشتیبانی نشده است: ${checkJson.message}`);
    }

    // Step 2: login-authentication
    const formLogin = new URLSearchParams();
    formLogin.append('csrfmiddlewaretoken', csrf);
    formLogin.append('tessera', email);
    formLogin.append('hidden_username', email);
    formLogin.append('password', pass);
    formLogin.append('g-recaptcha-response', '');

    const { res: loginRes, body: loginBody } = await this.fetchBounded(
      `${this.origin}/api/v1/auth/login-authentication`,
      {
        method: 'POST',
        headers: addCsrfHeaders({
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        }),
        body: formLogin.toString(),
      },
      30_000,
      5 * 1024 * 1024,
      store
    );

    if (typeof (loginRes.headers as any).getSetCookie === 'function') {
      store.applySetCookie((loginRes.headers as any).getSetCookie());
    }

    let loginJson: any = null;
    try {
      loginJson = JSON.parse(loginBody);
    } catch {
      throw new Error(`login-authentication returned invalid response (status ${loginRes.status})`);
    }

    if (loginJson.status !== 'success') {
      throw new Error(loginJson.message || 'اطلاعات ورود نامعتبر است (ایمیل یا رمز عبور اشتباه است)');
    }

    const sessionid = store.get('sessionid');
    const finalCsrf = store.get('csrftoken') || csrf;
    if (!sessionid) {
      throw new Error('کوکی نشست پس از ورود دریافت نشد');
    }

    const cookieString = `csrftoken=${finalCsrf}; sessionid=${sessionid}`;

    // Verify profile authentication before saving session
    const profile = await this.fetchCoreData(cookieString);
    if (!profile.isAuthenticated) {
      throw new Error('تأیید نشست کاربری با خطا مواجه شد');
    }

    return {
      cookie: cookieString,
      profile,
    };
  }

  /**
   * Discover owned courses using the evidenced platform API endpoint:
   * GET /api/v1/accounts/profile-courses/my_courses/
   * Validates pagination host and path.
   * Derives canonical slug (${slug}-mk${slug_id}), image_url, and teachers[].full_name.
   * Preserves card id.
   */
  public async discoverOwnedCourses(cookie?: string): Promise<DiscoveryResult> {
    if (!cookie) {
      return {
        courses: [],
        warning: 'برای مشاهده دوره‌های خریداری‌شده، لطفاً وارد حساب کاربری خود شوید.',
        expired: false,
      };
    }

    const discoveredCourses: Course[] = [];
    const limit = 20;
    let nextUrl: string | null = `${this.origin}/api/v1/accounts/profile-courses/my_courses/?archived=0&limit=${limit}&offset=0`;
    let pageCount = 0;
    const maxPages = 10;

    while (nextUrl && pageCount < maxPages) {
      pageCount++;
      const currentUrl: string = nextUrl;

      // Validate URL origin
      try {
        const parsed = new URL(currentUrl, this.origin);
        if (parsed.origin !== new URL(this.origin).origin) {
          console.warn(`Disallowed pagination origin: ${parsed.origin}`);
          break;
        }
      } catch {
        break;
      }

      const { res, body } = await this.fetchBounded(currentUrl, {
        method: 'GET',
        headers: {
          ...this.commonHeaders(this.origin, cookie),
          accept: 'application/json',
        },
      });

      // Distinguish expired session
      if (res.status === 401 || res.status === 403) {
        return {
          courses: discoveredCourses,
          warning: 'نشست کاربری شما منقضی شده است. لطفاً مجدداً وارد حساب کاربری خود شوید.',
          expired: true,
        };
      }

      if (!res.ok) {
        throw new Error(`خطا در دریافت لیست دوره‌ها: ${res.status} ${res.statusText}`);
      }

      let data: any;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error('پاسخ سرور برای لیست دوره‌ها ساختار معتبری ندارد.');
      }

      const results = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);

      for (const row of results) {
        // Evidence: card id, slug, slug_id
        const id = String(row.id ?? row.course_id ?? '');
        const rawSlug = String(row.slug || (row.url ? row.url.split('/').filter(Boolean).pop() : '') || id);
        const slugId = row.slug_id !== undefined && row.slug_id !== null ? String(row.slug_id) : '';

        // Construct canonical slug once: ${course.slug}-mk${course.slug_id}
        let canonicalSlug = rawSlug;
        if (slugId && !canonicalSlug.match(/-mk\d+$/i)) {
          canonicalSlug = `${rawSlug}-mk${slugId}`;
        }

        const title = String(row.title || row.name || canonicalSlug).trim();

        // Evidence: teachers array with full_name
        let instructor: string | undefined;
        if (Array.isArray(row.teachers) && row.teachers.length > 0) {
          const names = row.teachers
            .map((t: any) => (t && typeof t.full_name === 'string' ? t.full_name.trim() : ''))
            .filter(Boolean);
          if (names.length > 0) {
            instructor = names.join('، ');
          }
        }
        if (!instructor) {
          instructor = row.instructor?.name || row.teacher || (typeof row.instructor === 'string' ? row.instructor : undefined);
        }

        // Evidence: image_url
        const thumbnail = row.image_url || row.thumbnail || row.cover || row.image || undefined;

        if (!id || !canonicalSlug) continue;

        discoveredCourses.push({
          id, // Preserved card id
          title,
          slug: canonicalSlug, // Canonical slug containing -mk<id>
          thumbnail,
          instructor,
          lessonCount: row.lessons_count || row.units_count || undefined,
          downloadedCount: 0,
        });
      }

      // Read next pagination link
      if (typeof data?.next === 'string' && data.next.trim()) {
        try {
          const nextParsed = new URL(data.next, this.origin);
          if (nextParsed.origin === new URL(this.origin).origin) {
            nextUrl = nextParsed.toString();
          } else {
            nextUrl = null;
          }
        } catch {
          nextUrl = null;
        }
      } else {
        nextUrl = null;
      }
    }

    if (discoveredCourses.length === 0) {
      return {
        courses: [],
        warning: 'هیچ دوره خریداری‌شده‌ای در این حساب یافت نشد. می‌توانید با «افزودن با پیوند دوره»، دوره‌های رایگان یا در دسترس را اضافه کنید.',
        expired: false,
      };
    }

    return {
      courses: discoveredCourses,
      expired: false,
    };
  }

  /**
   * Fetch chapter outline for a course.
   */
  public async fetchChapters(
    courseSlug: string,
    referer?: string,
    courseId?: number | null,
    cookie?: string
  ): Promise<any> {
    // Try new LMS outline API first if course ID is available
    if (courseId) {
      try {
        const apiUrl = `${this.origin}/api/v1/lms/courses/${courseId}/outline/`;
        const { res, body } = await this.fetchBounded(apiUrl, {
          method: 'GET',
          headers: {
            ...this.commonHeaders(referer, cookie),
            accept: 'application/json',
          },
        });
        if (res.ok) {
          const json = JSON.parse(body);
          if (Array.isArray(json?.chapters)) {
            return json;
          }
        }
      } catch {
        // Fall back to old API
      }
    }

    // Fall back to legacy chapters API
    const apiUrl = `${this.origin}/api/v1/courses/${encodeURIComponent(courseSlug)}/chapters/`;
    const { res, body } = await this.fetchBounded(apiUrl, {
      method: 'GET',
      headers: {
        ...this.commonHeaders(referer, cookie),
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch chapters: ${res.status} ${res.statusText}`);
    }
    return JSON.parse(body);
  }

  /**
   * Fetch unit details (new LMS API format).
   */
  public async fetchUnitDetails(unitId: string | number, referer?: string, cookie?: string): Promise<any> {
    const apiUrl = `${this.origin}/api/v1/lms/units/${unitId}/`;
    const { res, body } = await this.fetchBounded(apiUrl, {
      method: 'GET',
      headers: {
        ...this.commonHeaders(referer, cookie),
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch unit details: ${res.status} ${res.statusText}`);
    }
    return JSON.parse(body);
  }

  /**
   * Fetch video URL for a unit (new LMS API format).
   */
  public async fetchUnitVideoUrl(unitId: string | number, referer?: string, cookie?: string): Promise<any> {
    const apiUrl = `${this.origin}/api/v1/lms/units/${unitId}/video_url/`;
    const { res, body } = await this.fetchBounded(apiUrl, {
      method: 'GET',
      headers: {
        ...this.commonHeaders(referer, cookie),
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch video URL: ${res.status} ${res.statusText}`);
    }
    return JSON.parse(body);
  }
}

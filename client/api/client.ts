import type {
  SessionState,
  LoginCredentials,
  LogoutResult,
  CoursesResponse,
  ImportCourseResponse,
  CourseDetailResponse,
  QualitiesResponse,
  DownloadsResponse,
  DownloadResponse,
  Settings,
  BootstrapResponse,
  ApiError,
} from '@shared/types';

export class ApiClientError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

class ApiClient {
  private csrfToken: string | null = null;

  async init(): Promise<void> {
    try {
      const res = await fetch('/api/bootstrap', { credentials: 'same-origin' });
      if (res.ok) {
        const data: BootstrapResponse = await res.json();
        this.csrfToken = data.csrfToken;
      }
    } catch {
      // Bootstrap optional if CSRF not enforced
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const method = (options.method || 'GET').toUpperCase();
    const isMutation = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';

    if (isMutation) {
      // Backend contract requires JSON Content-Type on ALL mutation requests
      headers['Content-Type'] = 'application/json';
      // Supply empty JSON body if bodyless
      if (options.body === undefined || options.body === null) {
        options.body = '{}';
      }
    }

    if (this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    const response = await fetch(endpoint, {
      ...options,
      headers,
      credentials: 'same-origin',
    });

    if (!response.ok) {
      let errorMessage = `درخواست با کد خطای ${response.status} ناموفق بود`;
      let errorCode: string | undefined;

      try {
        const errorData: ApiError = await response.json();
        if (errorData?.error) {
          if (errorData.error.message) {
            errorMessage = errorData.error.message;
          }
          if (errorData.error.code) {
            errorCode = errorData.error.code;
          }
        }
      } catch {
        if (response.statusText) {
          errorMessage = response.statusText;
        }
      }

      throw new ApiClientError(errorMessage, response.status, errorCode);
    }

    return response.json();
  }

  // Session
  getSession(): Promise<SessionState> {
    return this.request<SessionState>('/api/session');
  }

  login(credentials: LoginCredentials): Promise<SessionState> {
    return this.request<SessionState>('/api/session/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  logout(): Promise<LogoutResult> {
    return this.request<LogoutResult>('/api/session/logout', {
      method: 'POST',
    });
  }

  // Courses
  getCourses(): Promise<CoursesResponse> {
    return this.request<CoursesResponse>('/api/courses');
  }

  refreshCourses(): Promise<CoursesResponse> {
    return this.request<CoursesResponse>('/api/courses/refresh', {
      method: 'POST',
    });
  }

  importCourse(url: string): Promise<ImportCourseResponse> {
    return this.request<ImportCourseResponse>('/api/courses/import', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  getCourseDetail(courseId: string): Promise<CourseDetailResponse> {
    return this.request<CourseDetailResponse>(`/api/courses/${encodeURIComponent(courseId)}`);
  }

  // Lesson Qualities (Explicit on user action, never bulk)
  getLessonQualities(lessonId: string, courseId: string): Promise<QualitiesResponse> {
    return this.request<QualitiesResponse>(
      `/api/lessons/${encodeURIComponent(lessonId)}/qualities?courseId=${encodeURIComponent(courseId)}`
    );
  }

  // Video Streaming URL
  getStreamUrl(lessonId: string, courseId: string, quality?: string): string {
    const params = new URLSearchParams({ courseId });
    if (quality) params.set('quality', quality);
    return `/api/lessons/${encodeURIComponent(lessonId)}/stream?${params.toString()}`;
  }

  // Local Completed Media URL
  getLocalMediaUrl(downloadId: string): string {
    return `/api/downloads/${encodeURIComponent(downloadId)}/media`;
  }

  // Downloads
  getDownloads(): Promise<DownloadsResponse> {
    return this.request<DownloadsResponse>('/api/downloads');
  }

  enqueueDownload(courseId: string, lessonId: string, quality: string): Promise<DownloadResponse> {
    return this.request<DownloadResponse>('/api/downloads', {
      method: 'POST',
      body: JSON.stringify({ courseId, lessonId, quality }),
    });
  }

  pauseDownload(downloadId: string): Promise<DownloadResponse> {
    return this.request<DownloadResponse>(`/api/downloads/${encodeURIComponent(downloadId)}/pause`, {
      method: 'POST',
    });
  }

  resumeDownload(downloadId: string): Promise<DownloadResponse> {
    return this.request<DownloadResponse>(`/api/downloads/${encodeURIComponent(downloadId)}/resume`, {
      method: 'POST',
    });
  }

  cancelDownload(downloadId: string): Promise<DownloadResponse> {
    return this.request<DownloadResponse>(`/api/downloads/${encodeURIComponent(downloadId)}/cancel`, {
      method: 'POST',
    });
  }

  // Settings
  getSettings(): Promise<Settings> {
    return this.request<Settings>('/api/settings');
  }

  updateSettings(downloadDirectory: string): Promise<Settings> {
    return this.request<Settings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ downloadDirectory }),
    });
  }
}

export const api = new ApiClient();

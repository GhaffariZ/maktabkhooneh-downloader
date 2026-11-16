/**
 * Shared TypeScript type definitions for Maktabkhooneh Local Dashboard.
 * These types define the exact API contracts and domain models shared
 * between backend server and frontend client.
 */

export interface SessionState {
  authenticated: boolean;
  email?: string;
  demo: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LogoutResult {
  ok: true;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  thumbnail?: string;
  instructor?: string;
  lessonCount?: number;
  downloadedCount?: number;
}

export interface CoursesResponse {
  courses: Course[];
  warning?: string;
}

export interface ImportCoursePayload {
  url: string;
}

export interface ImportCourseResponse {
  course: Course;
}

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface Download {
  id: string;
  courseId: string;
  lessonId: string;
  courseTitle: string;
  lessonTitle: string;
  quality: string;
  status: DownloadStatus;
  downloadedBytes: number;
  totalBytes?: number;
  error?: string;
  filePath?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Lesson {
  id: string;
  title: string;
  duration?: number;
  accessible: boolean;
  download?: Download;
}

export interface Chapter {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface CourseDetailResponse {
  course: Course;
  chapters: Chapter[];
}

export interface Quality {
  id: string;
  label: string;
  bytes?: number;
}

export interface QualitiesResponse {
  qualities: Quality[];
}

export interface DownloadsResponse {
  downloads: Download[];
}

export interface EnqueueDownloadPayload {
  courseId: string;
  lessonId: string;
  quality: string;
}

export interface DownloadResponse {
  download: Download;
}

export interface Settings {
  downloadDirectory: string;
  downloadDirectoryManaged?: boolean;
}

export interface UpdateSettingsPayload {
  downloadDirectory: string;
}

export interface BootstrapResponse {
  csrfToken: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

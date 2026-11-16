/**
 * Persistent Storage Manager.
 * Manages serialized, atomic persistence for settings, session cookies,
 * course metadata cache, and download jobs.
 * Prevents prototype pollution, corrupt state loss, and concurrent write races.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { Course, Chapter, Download, Settings } from '../../shared/types.js';

export interface StorageData {
  settings: Settings;
  session: {
    email?: string;
    cookie?: string;
    updatedAt?: string;
  };
  courses: Record<string, { course: Course; chapters?: Chapter[] }>;
  downloads: Record<string, Download>;
}

export class StorageManager {
  private dataDir: string;
  private stateFilePath: string;
  private state: StorageData;
  private initialized: boolean = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(customDataDir?: string) {
    this.dataDir = customDataDir
      ? path.resolve(customDataDir)
      : path.resolve(process.cwd(), 'data');
    this.stateFilePath = path.join(this.dataDir, 'app-state.json');

    const defaultDownloadDir = path.join(os.homedir(), 'Downloads', 'Maktabkhooneh');
    this.state = {
      settings: {
        downloadDirectory: defaultDownloadDir,
      },
      session: {},
      courses: Object.create(null),
      downloads: Object.create(null),
    };
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    await fs.promises.mkdir(this.dataDir, { recursive: true });

    if (fs.existsSync(this.stateFilePath)) {
      let isCorrupted = false;
      let corruptError: any = null;

      try {
        const raw = await fs.promises.readFile(this.stateFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // Validate settings
          if (
            parsed.settings &&
            typeof parsed.settings.downloadDirectory === 'string' &&
            path.isAbsolute(parsed.settings.downloadDirectory)
          ) {
            this.state.settings = {
              downloadDirectory: path.normalize(parsed.settings.downloadDirectory),
            };
          }

          // Validate session
          if (parsed.session && typeof parsed.session === 'object') {
            this.state.session = {
              email: typeof parsed.session.email === 'string' ? parsed.session.email : undefined,
              cookie: typeof parsed.session.cookie === 'string' ? parsed.session.cookie : undefined,
              updatedAt: typeof parsed.session.updatedAt === 'string' ? parsed.session.updatedAt : undefined,
            };
          }

          // Validate courses (null-prototype to prevent prototype pollution)
          this.state.courses = Object.create(null);
          if (parsed.courses && typeof parsed.courses === 'object') {
            for (const key of Object.keys(parsed.courses)) {
              if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
              const item = parsed.courses[key];
              if (item && item.course && typeof item.course.id === 'string') {
                this.state.courses[key] = {
                  course: { ...item.course },
                  chapters: Array.isArray(item.chapters) ? JSON.parse(JSON.stringify(item.chapters)) : [],
                };
              }
            }
          }

          // Validate downloads (null-prototype)
          this.state.downloads = Object.create(null);
          if (parsed.downloads && typeof parsed.downloads === 'object') {
            for (const key of Object.keys(parsed.downloads)) {
              if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
              const d = parsed.downloads[key];
              if (d && typeof d.id === 'string' && typeof d.courseId === 'string' && typeof d.lessonId === 'string') {
                this.state.downloads[key] = { ...d };
              }
            }
          }
        } else {
          isCorrupted = true;
          corruptError = new Error('State file does not contain a JSON object');
        }
      } catch (err) {
        isCorrupted = true;
        corruptError = err;
      }

      if (isCorrupted) {
        // Must backup corrupt state; if backup fails, MUST NOT continue or overwrite!
        await this.backupCorruptedState();
        console.warn('Preserved corrupt app-state backup; continuing with clean state:', corruptError?.message);
      }
    }

    // Contract gate: "interrupted jobs restart paused"
    let mutated = false;
    for (const id of Object.keys(this.state.downloads)) {
      const job = this.state.downloads[id];
      if (job.status === 'downloading' || job.status === 'queued') {
        job.status = 'paused';
        job.updatedAt = new Date().toISOString();
        mutated = true;
      }
    }

    if (mutated || !fs.existsSync(this.stateFilePath)) {
      await this.persist();
    }

    this.initialized = true;
  }

  /**
   * Safely backup corrupted state file.
   * If backup fails, re-throws to prevent any silent overwrite of corrupted data.
   */
  public async backupCorruptedState(): Promise<string> {
    if (!fs.existsSync(this.stateFilePath)) {
      return '';
    }
    const backupPath = path.join(this.dataDir, `app-state.corrupt.${Date.now()}.json`);
    try {
      await fs.promises.copyFile(this.stateFilePath, backupPath);
      return backupPath;
    } catch (err: any) {
      throw new Error(`CRITICAL: Failed to backup corrupted state file to ${backupPath}: ${err.message}. Refusing to overwrite.`);
    }
  }

  /**
   * Serialized atomic persistence.
   * Chains via recovered tail so transient write failures never poison subsequent saves,
   * while returning the original error to the caller of the failed save.
   * Never uses non-atomic copyFile fallback over app-state.json.
   */
  private async persist(): Promise<void> {
    const doWrite = async () => {
      const tmpPath = path.join(
        this.dataDir,
        `app-state.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
      );
      const serialized = JSON.stringify(this.state, null, 2);

      try {
        await fs.promises.writeFile(tmpPath, serialized, {
          encoding: 'utf8',
          mode: 0o600,
        });
        // Atomic rename
        await fs.promises.rename(tmpPath, this.stateFilePath);
      } catch (err) {
        // Clean up temporary file; do NOT fall back to non-atomic copyFile
        try {
          await fs.promises.unlink(tmpPath);
        } catch {}
        throw err;
      }
    };

    const currentWrite = this.writeQueue.then(doWrite);
    // Recover queue tail so subsequent saves are not poisoned by this failure
    this.writeQueue = currentWrite.catch(() => {});
    return currentWrite;
  }

  // --- Settings ---
  public getSettings(): Settings {
    return { ...this.state.settings };
  }

  public async updateSettings(newSettings: Partial<Settings>): Promise<Settings> {
    if (newSettings.downloadDirectory !== undefined) {
      const originalPath = String(newSettings.downloadDirectory).trim();
      // Requirement: validate path.isAbsolute on original setting BEFORE path.resolve
      if (!originalPath || !path.isAbsolute(originalPath)) {
        throw new Error('Download directory must be a non-empty absolute path');
      }

      const resolved = path.normalize(originalPath);
      await fs.promises.mkdir(resolved, { recursive: true });
      this.state.settings.downloadDirectory = resolved;
    }

    await this.persist();
    return this.getSettings();
  }

  // --- Session ---
  public getSession(): { email?: string; cookie?: string; updatedAt?: string } {
    return {
      email: this.state.session.email,
      cookie: this.state.session.cookie,
      updatedAt: this.state.session.updatedAt,
    };
  }

  public async setSession(email: string, cookie: string): Promise<void> {
    this.state.session = {
      email,
      cookie,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  public async clearSession(): Promise<void> {
    this.state.session = {};
    await this.persist();
  }

  // --- Courses Cache ---
  public getCourses(): Course[] {
    const list: Course[] = [];
    for (const key of Object.keys(this.state.courses)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const entry = this.state.courses[key];
      if (entry && entry.course) {
        const c = { ...entry.course };
        const completedCount = Object.keys(this.state.downloads).filter((dKey) => {
          const d = this.state.downloads[dKey];
          return d && d.courseId === c.id && d.status === 'completed';
        }).length;
        c.downloadedCount = completedCount;
        list.push(c);
      }
    }
    return JSON.parse(JSON.stringify(list));
  }

  public getCourseDetails(courseId: string): { course: Course; chapters: Chapter[] } | null {
    if (courseId === '__proto__' || courseId === 'constructor' || courseId === 'prototype') {
      return null;
    }
    const entry = this.state.courses[courseId];
    if (!entry) return null;

    const course: Course = { ...entry.course };
    const statusPriority: Record<string, number> = {
      completed: 1,
      downloading: 2,
      queued: 3,
      paused: 4,
      failed: 5,
      canceled: 6,
    };

    const chapters: Chapter[] = (entry.chapters || []).map((ch) => ({
      ...ch,
      lessons: ch.lessons.map((l) => {
        const matchingDownloads = Object.values(this.state.downloads).filter(
          (d) => d && d.courseId === courseId && d.lessonId === l.id
        );
        let matchingDownload: Download | undefined;
        if (matchingDownloads.length > 0) {
          matchingDownloads.sort((a, b) => {
            const pA = statusPriority[a.status] || 99;
            const pB = statusPriority[b.status] || 99;
            if (pA !== pB) return pA - pB;
            const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return timeB - timeA;
          });
          matchingDownload = matchingDownloads[0];
        }

        return {
          ...l,
          download: matchingDownload ? { ...matchingDownload } : undefined,
        };
      }),
    }));

    const completed = Object.values(this.state.downloads).filter(
      (d) => d && d.courseId === courseId && d.status === 'completed'
    );
    course.downloadedCount = completed.length;

    return JSON.parse(JSON.stringify({ course, chapters }));
  }

  public async saveCourse(course: Course, chapters?: Chapter[]): Promise<void> {
    if (course.id === '__proto__' || course.id === 'constructor' || course.id === 'prototype') {
      throw new Error('Invalid course ID');
    }
    const existing = this.state.courses[course.id];
    this.state.courses[course.id] = {
      course: {
        ...course,
        downloadedCount: existing?.course?.downloadedCount || 0,
      },
      chapters: chapters !== undefined ? JSON.parse(JSON.stringify(chapters)) : (existing?.chapters || []),
    };
    await this.persist();
  }

  // --- Downloads ---
  public getDownloads(): Download[] {
    const list: Download[] = [];
    for (const key of Object.keys(this.state.downloads)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const d = this.state.downloads[key];
      if (d) {
        list.push({ ...d });
      }
    }
    return JSON.parse(JSON.stringify(list.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    })));
  }

  public getDownload(id: string): Download | null {
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') return null;
    const item = this.state.downloads[id];
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  public async saveDownload(download: Download): Promise<Download> {
    if (download.id === '__proto__' || download.id === 'constructor' || download.id === 'prototype') {
      throw new Error('Invalid download job ID');
    }
    const now = new Date().toISOString();
    const existing = this.state.downloads[download.id];
    const updated: Download = {
      ...download,
      createdAt: existing?.createdAt || download.createdAt || now,
      updatedAt: now,
    };
    this.state.downloads[download.id] = updated;
    await this.persist();
    return JSON.parse(JSON.stringify(updated));
  }
}

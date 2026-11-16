import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { StorageManager } from '../../../server/storage/storage-manager.js';
import { Course, Download } from '../../../shared/types.js';

describe('Storage Manager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `mk-test-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('initializes default settings and persists updates', async () => {
    const storage = new StorageManager(tmpDir);
    await storage.init();

    const settings = storage.getSettings();
    assert.ok(path.isAbsolute(settings.downloadDirectory));

    const newDir = path.join(tmpDir, 'custom-downloads');
    const updated = await storage.updateSettings({ downloadDirectory: newDir });
    assert.equal(updated.downloadDirectory, newDir);

    // Reload from disk to verify persistence
    const reloaded = new StorageManager(tmpDir);
    await reloaded.init();
    assert.equal(reloaded.getSettings().downloadDirectory, newDir);
  });

  test('rejects relative path in updateSettings before path.resolve', async () => {
    const storage = new StorageManager(tmpDir);
    await storage.init();

    await assert.rejects(async () => {
      await storage.updateSettings({ downloadDirectory: './relative/dir' });
    }, /must be a non-empty absolute path/);

    await assert.rejects(async () => {
      await storage.updateSettings({ downloadDirectory: 'relative-name' });
    }, /must be a non-empty absolute path/);
  });

  test('preserves corrupted state by backing up rather than silent overwrite', async () => {
    const stateFile = path.join(tmpDir, 'app-state.json');
    await fs.promises.writeFile(stateFile, '{ corrupt-json-content: true,');

    const storage = new StorageManager(tmpDir);
    await storage.init();

    // Check that backup file was created
    const files = await fs.promises.readdir(tmpDir);
    const backup = files.find((f) => f.startsWith('app-state.corrupt.'));
    assert.ok(backup, 'Corrupt backup file should have been created');
  });

  test('backupCorruptedState throws and halts init if backup fails, preventing overwrite', async () => {
    const stateFile = path.join(tmpDir, 'app-state.json');
    await fs.promises.writeFile(stateFile, '{ corrupt-json');

    const storage = new StorageManager(tmpDir);

    // Mock backupCorruptedState to simulate backup failure (e.g. disk full / EPERM)
    storage.backupCorruptedState = async () => {
      throw new Error('EACCES: permission denied during backup');
    };

    await assert.rejects(async () => {
      await storage.init();
    }, /permission denied during backup/);

    // Verify original corrupt file was NOT overwritten with default state
    const content = await fs.promises.readFile(stateFile, 'utf8');
    assert.equal(content, '{ corrupt-json');
  });

  test('prevents prototype pollution via __proto__ in courses and downloads', async () => {
    const storage = new StorageManager(tmpDir);
    await storage.init();

    await assert.rejects(async () => {
      await storage.saveCourse({
        id: '__proto__',
        title: 'Exploit',
        slug: 'exploit',
      });
    }, /Invalid course ID/);

    await assert.rejects(async () => {
      await storage.saveDownload({
        id: '__proto__',
        courseId: 'c1',
        lessonId: 'l1',
        courseTitle: 'c',
        lessonTitle: 'l',
        quality: 'q',
        status: 'queued',
        downloadedBytes: 0,
      });
    }, /Invalid download job ID/);

    assert.equal(({} as any).polluted, undefined);
  });

  test('writeQueue recovers from transient failure and does NOT poison later saves', async () => {
    const storage = new StorageManager(tmpDir);
    await storage.init();

    // First save succeeds
    await storage.saveCourse({ id: 'c1', title: 'Course 1', slug: 'slug-1' });

    // Inject temporary failure into fs.promises.rename
    const originalRename = fs.promises.rename;
    let failOnce = true;
    (fs.promises as any).rename = async (oldPath: string, newPath: string) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('Simulated transient rename failure');
      }
      return originalRename(oldPath, newPath);
    };

    try {
      // This save must reject with the original error
      await assert.rejects(async () => {
        await storage.saveCourse({ id: 'c2-failed', title: 'Course 2', slug: 'slug-2' });
      }, /Simulated transient rename failure/);

      // Subsequent save must succeed! writeQueue tail was recovered
      await storage.saveCourse({ id: 'c3-success', title: 'Course 3', slug: 'slug-3' });

      const courses = storage.getCourses();
      const ids = courses.map((c) => c.id);
      assert.ok(ids.includes('c1'));
      assert.ok(ids.includes('c3-success'));
    } finally {
      fs.promises.rename = originalRename;
    }
  });

  test('concurrent writes serialize safely without losing updates', async () => {
    const storage = new StorageManager(tmpDir);
    await storage.init();

    const promises = [];
    for (let i = 0; i < 15; i++) {
      promises.push(
        storage.saveCourse({
          id: `course-${i}`,
          title: `دوره ${i}`,
          slug: `course-slug-${i}`,
        })
      );
    }
    await Promise.all(promises);

    const courses = storage.getCourses();
    assert.equal(courses.length, 15);
  });

  test('interrupted jobs restart in paused status (contract gate)', async () => {
    const storage = new StorageManager(tmpDir);
    await storage.init();

    const activeJob: Download = {
      id: 'job-active-1',
      courseId: 'c1',
      lessonId: 'l1',
      courseTitle: 'دوره ۱',
      lessonTitle: 'درس ۱',
      quality: '720p',
      status: 'downloading',
      downloadedBytes: 1048576,
    };
    await storage.saveDownload(activeJob);

    const restartedStorage = new StorageManager(tmpDir);
    await restartedStorage.init();

    const job1 = restartedStorage.getDownload('job-active-1');
    assert.ok(job1);
    assert.equal(job1.status, 'paused');
    assert.equal(job1.downloadedBytes, 1048576);
  });

  test('getCourseDetails prefers completed available download over failed/earlier entry', async () => {
    const storage = new StorageManager(tmpDir);
    await storage.init();

    await storage.saveCourse(
      { id: 'c-pref', title: 'Course Pref', slug: 'course-pref' },
      [
        {
          id: 1,
          title: 'Chapter 1',
          lessons: [
            { id: 'l-pref', title: 'Lesson Pref', duration: 100, isFree: true, order: 1 },
          ],
        },
      ]
    );

    // Save a failed download first
    await storage.saveDownload({
      id: 'dl-failed-first',
      courseId: 'c-pref',
      lessonId: 'l-pref',
      courseTitle: 'Course Pref',
      lessonTitle: 'Lesson Pref',
      quality: '480p',
      status: 'failed',
      downloadedBytes: 0,
      updatedAt: '2026-01-01T00:00:00Z',
    });

    // Save a completed download second
    await storage.saveDownload({
      id: 'dl-completed-second',
      courseId: 'c-pref',
      lessonId: 'l-pref',
      courseTitle: 'Course Pref',
      lessonTitle: 'Lesson Pref',
      quality: '720p',
      status: 'completed',
      downloadedBytes: 1024,
      filePath: '/downloads/test.mp4',
      updatedAt: '2026-01-02T00:00:00Z',
    });

    const details = storage.getCourseDetails('c-pref');
    assert.ok(details);
    const lesson = details.chapters[0].lessons[0];
    assert.ok(lesson.download);
    assert.equal(lesson.download.id, 'dl-completed-second');
    assert.equal(lesson.download.status, 'completed');
    assert.equal(lesson.download.quality, '720p');
  });
});

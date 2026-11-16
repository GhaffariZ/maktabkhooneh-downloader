import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  lessonKey,
  getStorageKey,
  normalizeProgressTable,
  loadProgress,
  saveProgress,
  applyProgressUpdate,
  LessonProgress,
  ProgressTable,
} from '../../client/utils/studyProgress.js';

class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('Study Progress Persistence & Normalization (Agent P)', () => {
  let originalWindow: typeof globalThis.window;
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    originalWindow = globalThis.window;
    mockStorage = new MockLocalStorage();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: mockStorage,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  describe('lessonKey & Derivation', () => {
    it('creates unambiguous JSON tuple keys without delimiter collision', () => {
      const key1 = lessonKey('course:1', 'lesson:2');
      const key2 = lessonKey('course', '1:lesson:2');
      assert.equal(key1, JSON.stringify(['course:1', 'lesson:2']));
      assert.notEqual(key1, key2, 'Tuple keys must never collide regardless of delimiter characters');

      // Ambiguity test: 'a:b' + 'c' vs 'a' + 'b:c'
      assert.notEqual(lessonKey('a:b', 'c'), lessonKey('a', 'b:c'));
    });

    it('derives dictionary key from validated record on load', () => {
      const raw = {
        'old-arbitrary-key': {
          courseId: 'c1',
          lessonId: 'l1',
          lessonTitle: 'درس اول',
          position: 10,
          completed: false,
          updatedAt: 100,
        },
      };

      const normalized = normalizeProgressTable(raw);
      const expectedKey = lessonKey('c1', 'l1');
      assert.ok(normalized[expectedKey], 'Key must be derived from validated record');
      assert.equal(normalized['old-arbitrary-key'], undefined);
    });
  });

  describe('normalizeProgressTable', () => {
    it('returns empty dictionary for invalid or non-object payloads', () => {
      assert.deepEqual(normalizeProgressTable(null), Object.create(null));
      assert.deepEqual(normalizeProgressTable(undefined), Object.create(null));
      assert.deepEqual(normalizeProgressTable('not-an-object'), Object.create(null));
      assert.deepEqual(normalizeProgressTable(12345), Object.create(null));
      assert.deepEqual(normalizeProgressTable([1, 2, 3]), Object.create(null));
    });

    it('filters out corrupted entries and prototype pollution keys', () => {
      const maliciousPayload = JSON.parse(`{
        "__proto__": { "polluted": true },
        "constructor": { "polluted": true },
        "prototype": { "polluted": true },
        "valid:key": {
          "courseId": "c1",
          "lessonId": "l1",
          "lessonTitle": "درس اول",
          "position": 120.5,
          "duration": 300,
          "completed": true,
          "updatedAt": 1700000000000
        },
        "invalid:entry": {
          "courseId": 123,
          "lessonId": null
        }
      }`);

      const normalized = normalizeProgressTable(maliciousPayload);
      assert.equal(Object.prototype.hasOwnProperty.call(normalized, '__proto__'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'constructor'), false);

      const validKey = lessonKey('c1', 'l1');
      const valid = normalized[validKey];
      assert.ok(valid);
      assert.equal(valid.courseId, 'c1');
      assert.equal(valid.lessonId, 'l1');
      assert.equal(valid.position, 120.5);
      assert.equal(valid.duration, 300);
      assert.equal(valid.completed, true);
      assert.equal(valid.updatedAt, 1700000000000);
    });

    it('clamps negative positions and sanitizes invalid durations', () => {
      const raw = {
        'ignored-key': {
          courseId: 'c',
          lessonId: 'l',
          lessonTitle: 'Test',
          position: -50,
          duration: -10,
          completed: false,
          updatedAt: -5,
        },
      };

      const normalized = normalizeProgressTable(raw);
      const k = lessonKey('c', 'l');
      assert.equal(normalized[k].position, 0);
      assert.equal(normalized[k].duration, undefined);
      assert.equal(normalized[k].updatedAt, 0);
    });
  });

  describe('Storage I/O & Restricted Storage Resilience', () => {
    it('returns empty table when localStorage is unpopulated', () => {
      const progress = loadProgress('real');
      assert.deepEqual(progress, Object.create(null));
    });

    it('gracefully falls back to empty table on malformed/corrupt JSON without throwing', () => {
      mockStorage.setItem(getStorageKey('real'), '{ not valid json syntax ...');
      const progress = loadProgress('real');
      assert.deepEqual(progress, Object.create(null));
    });

    it('survives restricted localStorage access (SecurityError) without crashing', () => {
      // Mock window where accessing localStorage throws SecurityError (e.g. sandboxed iframe or private browsing)
      (globalThis as unknown as { window: unknown }).window = {
        get localStorage(): Storage {
          throw new Error('SecurityError: The operation is insecure.');
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      };

      assert.doesNotThrow(() => {
        const loaded = loadProgress('real');
        assert.deepEqual(loaded, Object.create(null));
      });

      assert.doesNotThrow(() => {
        saveProgress('real', {
          [lessonKey('c', 'l')]: {
            courseId: 'c',
            lessonId: 'l',
            lessonTitle: 'T',
            position: 10,
            completed: false,
            updatedAt: 100,
          },
        });
      });
    });

    it('isolates data between demo and real scopes', () => {
      const demoKey = lessonKey('demo-c', 'demo-l');
      const demoData: ProgressTable = {
        [demoKey]: {
          courseId: 'demo-c',
          lessonId: 'demo-l',
          lessonTitle: 'Demo Lesson',
          position: 45,
          completed: false,
          updatedAt: 1000,
        },
      };

      const realKey = lessonKey('real-c', 'real-l');
      const realData: ProgressTable = {
        [realKey]: {
          courseId: 'real-c',
          lessonId: 'real-l',
          lessonTitle: 'Real Lesson',
          position: 180,
          completed: true,
          updatedAt: 2000,
        },
      };

      saveProgress('demo', demoData);
      saveProgress('real', realData);

      const loadedDemo = loadProgress('demo');
      const loadedReal = loadProgress('real');

      assert.ok(loadedDemo[demoKey]);
      assert.equal(loadedDemo[realKey], undefined);

      assert.ok(loadedReal[realKey]);
      assert.equal(loadedReal[demoKey], undefined);
    });

    it('does not read or write when scope is null', () => {
      const k = lessonKey('c', 'l');
      saveProgress(null, {
        [k]: {
          courseId: 'c',
          lessonId: 'l',
          lessonTitle: 'T',
          position: 10,
          completed: false,
          updatedAt: 100,
        },
      });

      assert.equal(mockStorage.getItem(getStorageKey('real')), null);
      assert.equal(mockStorage.getItem(getStorageKey('demo')), null);

      const loaded = loadProgress(null);
      assert.deepEqual(loaded, Object.create(null));
    });
  });

  describe('applyProgressUpdate (Contract & Edge Cases)', () => {
    it('records new playback progress with position, duration, and title', () => {
      const updated = applyProgressUpdate(undefined, 'course-a', 'unit-1', 'معرفی دوره', {
        position: 35.5,
        duration: 360,
      });

      assert.equal(updated.courseId, 'course-a');
      assert.equal(updated.lessonId, 'unit-1');
      assert.equal(updated.lessonTitle, 'معرفی دوره');
      assert.equal(updated.position, 35.5);
      assert.equal(updated.duration, 360);
      assert.equal(updated.completed, false);
      assert.ok(updated.updatedAt > 0);
    });

    it('preserves existing duration and title when only position changes', () => {
      const existing: LessonProgress = {
        courseId: 'course-a',
        lessonId: 'unit-1',
        lessonTitle: 'معرفی دوره',
        position: 30,
        duration: 360,
        completed: false,
        updatedAt: 1000,
      };

      const updated = applyProgressUpdate(existing, 'course-a', 'unit-1', '', {
        position: 120,
      });

      assert.equal(updated.position, 120);
      assert.equal(updated.duration, 360);
      assert.equal(updated.lessonTitle, 'معرفی دوره');
      assert.ok(updated.updatedAt > 1000);
    });

    it('enforces completion stickiness: completed state persists across playback updates', () => {
      const existing: LessonProgress = {
        courseId: 'course-a',
        lessonId: 'unit-1',
        lessonTitle: 'معرفی دوره',
        position: 350,
        duration: 360,
        completed: true,
        updatedAt: 1000,
      };

      // Rewatching or seeking from position 20 without explicit completed: false
      const updated = applyProgressUpdate(existing, 'course-a', 'unit-1', 'معرفی دوره', {
        position: 20,
      });

      assert.equal(updated.position, 20);
      assert.equal(updated.completed, true, 'Completion must stick until explicit manual toggle');
    });

    it('allows explicit manual completion toggling', () => {
      const existing: LessonProgress = {
        courseId: 'course-a',
        lessonId: 'unit-1',
        lessonTitle: 'معرفی دوره',
        position: 20,
        duration: 360,
        completed: true,
        updatedAt: 1000,
      };

      // Explicitly mark uncompleted
      const uncompleted = applyProgressUpdate(existing, 'course-a', 'unit-1', 'معرفی دوره', {
        completed: false,
      });
      assert.equal(uncompleted.completed, false);

      // Explicitly mark completed
      const reCompleted = applyProgressUpdate(uncompleted, 'course-a', 'unit-1', 'معرفی دوره', {
        completed: true,
      });
      assert.equal(reCompleted.completed, true);
    });

    it('ensures manual marking without play does not advance resume updatedAt timestamp', () => {
      // 1. Initial manual mark on unplayed lesson
      const manualFirst = applyProgressUpdate(undefined, 'course-b', 'unit-2', 'درس جدید', {
        completed: true,
      });
      assert.equal(manualFirst.position, 0);
      assert.equal(manualFirst.completed, true);
      assert.equal(manualFirst.updatedAt, 0, 'Unplayed manual mark must not register recent play timestamp');

      // 2. Manual toggle on existing played lesson does not bump updatedAt
      const playedLesson: LessonProgress = {
        courseId: 'course-b',
        lessonId: 'unit-2',
        lessonTitle: 'درس جدید',
        position: 15,
        duration: 200,
        completed: false,
        updatedAt: 5000,
      };

      const manualToggle = applyProgressUpdate(playedLesson, 'course-b', 'unit-2', 'درس جدید', {
        completed: true,
      });
      assert.equal(manualToggle.updatedAt, 5000, 'Manual completion toggle without position update must preserve existing updatedAt');
    });

    it('maintains monotonic updatedAt during playback updates', () => {
      const first = applyProgressUpdate(undefined, 'course-c', 'unit-3', 'درس ۳', {
        position: 10,
      });

      const second = applyProgressUpdate(first, 'course-c', 'unit-3', 'درس ۳', {
        position: 20,
      });

      assert.ok(second.updatedAt >= first.updatedAt);
    });
  });

  describe('Course Progress Derivation', () => {
    it('accurately derives course stats from the typed table', () => {
      const key1 = lessonKey('c1', 'l1');
      const key2 = lessonKey('c1', 'l2');
      const key3 = lessonKey('c2', 'l1');

      const table: ProgressTable = {
        [key1]: {
          courseId: 'c1',
          lessonId: 'l1',
          lessonTitle: 'L1',
          position: 100,
          duration: 100,
          completed: true,
          updatedAt: 10,
        },
        [key2]: {
          courseId: 'c1',
          lessonId: 'l2',
          lessonTitle: 'L2',
          position: 50,
          duration: 120,
          completed: false,
          updatedAt: 50,
        },
        [key3]: {
          courseId: 'c2',
          lessonId: 'l1',
          lessonTitle: 'C2 L1',
          position: 80,
          completed: true,
          updatedAt: 20,
        },
      };

      const c1Lessons = Object.values(table).filter((p) => p.courseId === 'c1');
      const completedCount = c1Lessons.filter((p) => p.completed).length;
      assert.equal(completedCount, 1);
      assert.equal(c1Lessons.length, 2);

      // Most recent unfinished played lesson for resume
      const unfinishedPlayed = c1Lessons
        .filter((p) => !p.completed && p.position > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      assert.equal(unfinishedPlayed.length, 1);
      assert.equal(unfinishedPlayed[0].lessonId, 'l2');
      assert.equal(unfinishedPlayed[0].position, 50);
    });
  });
});

import { useState, useEffect, useCallback, useRef } from 'react';

export interface LessonProgress {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  position: number;
  duration?: number;
  completed: boolean;
  updatedAt: number;
}

export type ProgressTable = Record<string, LessonProgress>;

export interface ProgressUpdate {
  position?: number;
  duration?: number;
  completed?: boolean;
}

const STORAGE_VERSION = 'v1';
const STORAGE_PREFIX = `mk_study_progress_${STORAGE_VERSION}`;

/**
 * Builds an unambiguous, collision-resistant key for course/lesson pair using a JSON tuple.
 * Eliminates delimiter ambiguities (e.g. ('a:b', 'c') vs ('a', 'b:c')).
 */
export function lessonKey(courseId: string, lessonId: string): string {
  return JSON.stringify([courseId, lessonId]);
}

export function getStorageKey(scope: 'demo' | 'real'): string {
  return `${STORAGE_PREFIX}_${scope}`;
}

/**
 * Normalizes unknown data from storage into a safe, prototype-pollution-free ProgressTable.
 * Derives keys from the validated records themselves to ensure consistency.
 */
export function normalizeProgressTable(data: unknown): ProgressTable {
  const result: ProgressTable = Object.create(null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return result;
  }

  for (const [rawKey, value] of Object.entries(data as Record<string, unknown>)) {
    if (rawKey === '__proto__' || rawKey === 'constructor' || rawKey === 'prototype') {
      continue;
    }
    if (!value || typeof value !== 'object') {
      continue;
    }

    const v = value as Record<string, unknown>;
    if (typeof v.courseId !== 'string' || typeof v.lessonId !== 'string') {
      continue;
    }

    const position =
      typeof v.position === 'number' && Number.isFinite(v.position) && v.position >= 0
        ? v.position
        : 0;
    const duration =
      typeof v.duration === 'number' && Number.isFinite(v.duration) && v.duration > 0
        ? v.duration
        : undefined;
    const completed = typeof v.completed === 'boolean' ? v.completed : false;
    const updatedAt =
      typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) && v.updatedAt >= 0
        ? v.updatedAt
        : 0;
    const lessonTitle = typeof v.lessonTitle === 'string' ? v.lessonTitle : '';

    // Derive deterministic tuple key from the validated record itself
    const key = lessonKey(v.courseId, v.lessonId);

    result[key] = {
      courseId: v.courseId,
      lessonId: v.lessonId,
      lessonTitle,
      position,
      duration,
      completed,
      updatedAt,
    };
  }

  return result;
}

/**
 * Safe reader from localStorage with malformed storage fallback.
 * Strictly accesses window.localStorage inside try-catch so restricted environments cannot crash.
 */
export function loadProgress(scope: 'demo' | 'real' | null): ProgressTable {
  if (!scope || typeof window === 'undefined') {
    return Object.create(null);
  }

  try {
    const storage = window.localStorage;
    if (!storage) return Object.create(null);
    const raw = storage.getItem(getStorageKey(scope));
    if (!raw) return Object.create(null);
    const parsed = JSON.parse(raw);
    return normalizeProgressTable(parsed);
  } catch {
    return Object.create(null);
  }
}

/**
 * Safe writer to localStorage.
 * Strictly accesses window.localStorage inside try-catch so restricted environments cannot crash.
 */
export function saveProgress(scope: 'demo' | 'real' | null, table: ProgressTable): void {
  if (!scope || typeof window === 'undefined') {
    return;
  }

  try {
    const storage = window.localStorage;
    if (!storage) return;
    storage.setItem(getStorageKey(scope), JSON.stringify(table));
  } catch (err) {
    console.warn('Failed to persist study progress to localStorage:', err);
  }
}

/**
 * Pure helper to compute next LessonProgress record according to contract:
 * - Position clamped >= 0
 * - Duration preserved if omitted
 * - Completion sticks until manual toggle
 * - UpdatedAt monotonic for playback; manual marking without playback does not advance resume timestamp
 */
export function applyProgressUpdate(
  existing: LessonProgress | undefined,
  courseId: string,
  lessonId: string,
  lessonTitle: string,
  update: ProgressUpdate
): LessonProgress {
  const isPlaybackUpdate = update.position !== undefined;

  let position = existing?.position ?? 0;
  if (update.position !== undefined) {
    position =
      typeof update.position === 'number' && Number.isFinite(update.position) && update.position >= 0
        ? update.position
        : 0;
  }

  let duration = existing?.duration;
  if (update.duration !== undefined) {
    duration =
      typeof update.duration === 'number' && Number.isFinite(update.duration) && update.duration > 0
        ? update.duration
        : existing?.duration;
  }

  // Completion sticks until manual toggle
  let completed = existing?.completed ?? false;
  if (update.completed !== undefined) {
    completed = Boolean(update.completed);
  }

  // UpdatedAt: keep monotonic with Date.now; manual marking without play does not turn into recent resume
  let updatedAt = existing?.updatedAt ?? 0;
  if (isPlaybackUpdate) {
    const now = Date.now();
    updatedAt = Math.max(now, (existing?.updatedAt ?? 0) + 1);
  } else if (!existing) {
    // Initial manual mark before any playback
    updatedAt = 0;
  }

  return {
    courseId,
    lessonId,
    lessonTitle: lessonTitle || existing?.lessonTitle || '',
    position,
    duration,
    completed,
    updatedAt,
  };
}

/**
 * React hook to manage study progress isolated by scope ('demo' vs 'real').
 * Uses an immediate scoped ref and table snapshot for synchronous final writes so pause/reload
 * is reliable and stale scope state cannot overwrite another namespace.
 * saveProgress is executed synchronously outside the React state updater to avoid double-invocation under StrictMode.
 */
export function useStudyProgress(scope: 'demo' | 'real' | null): {
  progress: ProgressTable;
  recordProgress: (
    courseId: string,
    lessonId: string,
    lessonTitle: string,
    update: ProgressUpdate
  ) => void;
} {
  const [progress, setProgress] = useState<ProgressTable>(() => loadProgress(scope));

  // Immediate scoped ref and table snapshot for reliable synchronous writes
  const scopeRef = useRef<'demo' | 'real' | null>(scope);
  const tableRef = useRef<ProgressTable>(progress);

  // Synchronize refs and state whenever scope changes
  useEffect(() => {
    scopeRef.current = scope;
    const initial = loadProgress(scope);
    tableRef.current = initial;
    setProgress(initial);

    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      try {
        if (scope && e.key === getStorageKey(scope)) {
          const reloaded = loadProgress(scope);
          tableRef.current = reloaded;
          setProgress(reloaded);
        }
      } catch {}
    };

    try {
      window.addEventListener('storage', onStorage);
      return () => {
        try {
          window.removeEventListener('storage', onStorage);
        } catch {}
      };
    } catch {}
  }, [scope]);

  const recordProgress = useCallback(
    (courseId: string, lessonId: string, lessonTitle: string, update: ProgressUpdate) => {
      // Capture immediate scope snapshot: prevents stale scope closure from writing to wrong namespace
      const currentScope = scopeRef.current;
      if (!currentScope) return;

      const currentTable = tableRef.current;
      const key = lessonKey(courseId, lessonId);
      const existing = currentTable[key];
      const nextItem = applyProgressUpdate(existing, courseId, lessonId, lessonTitle, update);

      const nextTable: ProgressTable = {
        ...currentTable,
        [key]: nextItem,
      };

      // 1. Immediately update ref snapshot for synchronous consistency
      tableRef.current = nextTable;

      // 2. Synchronous storage write OUTSIDE React state updater (safe from StrictMode double-execution and reliable on pause/unload)
      saveProgress(currentScope, nextTable);

      // 3. Update React state
      setProgress(nextTable);
    },
    []
  );

  return { progress, recordProgress };
}

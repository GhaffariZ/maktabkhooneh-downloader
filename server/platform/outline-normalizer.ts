/**
 * Chapter and lesson outline normalizer.
 * Adapts both modern LMS outline API (/api/v1/lms/courses/:id/outline/)
 * and legacy outline API (/api/v1/courses/:slug/chapters/) into consistent Chapter/Lesson models.
 */

import { Chapter, Lesson } from '../../shared/types.js';

export function normalizeCourseChapters(rawChaptersData: any): {
  chapters: Chapter[];
  lessonCount: number;
} {
  const rawChapters = Array.isArray(rawChaptersData?.chapters)
    ? rawChaptersData.chapters
    : Array.isArray(rawChaptersData)
    ? rawChaptersData
    : [];

  let lessonCount = 0;
  const chapters: Chapter[] = [];

  for (let chIdx = 0; chIdx < rawChapters.length; chIdx++) {
    const ch = rawChapters[chIdx];
    const rawUnits = Array.isArray(ch.units)
      ? ch.units
      : Array.isArray(ch.unit_set)
      ? ch.unit_set
      : [];

    const lessons: Lesson[] = [];
    for (let uIdx = 0; uIdx < rawUnits.length; uIdx++) {
      const u = rawUnits[uIdx];

      // Detect if unit is a video lecture
      // LMS API: u.type === 1
      // Legacy API: u.type === 'lecture'
      const isVideoUnit = u.type === 1 || u.type === 'lecture';
      if (!isVideoUnit) continue;

      // Old API has status flag (skip if status explicitly false)
      if ('status' in u && u.status === false) continue;

      lessonCount++;

      // Accessible flag: locked === false (or not locked)
      const isLocked = u.locked === true;
      const isAccessible = !isLocked;

      let duration: number | undefined;
      if (typeof u.duration === 'number' && !isNaN(u.duration)) {
        duration = Math.round(u.duration);
      } else if (typeof u.duration === 'string') {
        const parsed = parseInt(u.duration, 10);
        if (!isNaN(parsed)) duration = parsed;
      }

      lessons.push({
        id: String(u.id ?? u.unit_id ?? `${chIdx + 1}-${uIdx + 1}`),
        title: String(u.title || u.slug || `درس ${uIdx + 1}`).trim(),
        duration,
        accessible: isAccessible,
      });
    }

    chapters.push({
      id: String(ch.id ?? ch.slug ?? chIdx + 1),
      title: String(ch.title || ch.slug || `فصل ${chIdx + 1}`).trim(),
      lessons,
    });
  }

  return { chapters, lessonCount };
}

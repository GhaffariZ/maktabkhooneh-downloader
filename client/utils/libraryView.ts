import type { Course } from "@shared/types";
import type { ProgressTable } from "./studyProgress";

export type LibraryFilter =
  "all" | "started" | "saved" | "offline" | "completed";
export function searchText(text: string): string {
  return text
    .toLocaleLowerCase("fa")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200e\u200f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function courseActivity(course: Course, progress: ProgressTable) {
  const lessons = Object.values(progress).filter(
    (item) => item.courseId === course.id,
  );
  const watched = lessons.filter((item) => item.completed).length;
  return {
    watched,
    started: lessons.some((item) => item.completed || item.position > 0),
    completed: !!course.lessonCount && watched >= course.lessonCount,
    updatedAt: Math.max(0, ...lessons.map((item) => item.updatedAt)),
    percent: course.lessonCount
      ? Math.min(100, Math.round((watched / course.lessonCount) * 100))
      : null,
  };
}

import React, { useState, useMemo } from "react";
import {
  Search,
  RefreshCw,
  Plus,
  BookOpen,
  Play,
  HardDrive,
  Bookmark,
  LayoutGrid,
  List,
  ArrowUpLeft,
  Check,
} from "lucide-react";
import type { Course } from "@shared/types";
import type { LessonProgress, ProgressTable } from "../utils/studyProgress";
import { formatDuration } from "../utils/format";
import {
  courseActivity,
  searchText,
  type LibraryFilter,
} from "../utils/libraryView";

interface CourseLibraryProps {
  courses: Course[];
  loading: boolean;
  warning?: string;
  progress: ProgressTable;
  scope?: "demo" | "real";
  onSelectCourse: (course: Course) => void;
  onResumeLesson?: (course: Course, resume: LessonProgress) => void;
  onRefresh: () => void;
  onOpenImport: () => void;
}
const filters: [LibraryFilter, string][] = [
  ["all", "همه دوره‌ها"],
  ["started", "در حال یادگیری"],
  ["saved", "نشان‌شده‌ها"],
  ["offline", "آفلاین"],
  ["completed", "تکمیل‌شده"],
];
export const CourseLibrary: React.FC<CourseLibraryProps> = ({
  courses,
  loading,
  warning,
  progress,
  scope = "real",
  onSelectCourse,
  onResumeLesson,
  onRefresh,
  onOpenImport,
}) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState("recent");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [saveError, setSaveError] = useState("");
  const storageKey = "mk_bookmarks_v3_" + scope;
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey) || "[]",
      );
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const toggleBookmark = (id: string) => {
    const next = bookmarks.includes(id)
      ? bookmarks.filter((item) => item !== id)
      : [...bookmarks, id];
    setBookmarks(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSaveError("");
    } catch {
      setSaveError(
        "ذخیره نشان‌ها ممکن نشد؛ تغییرات فقط تا بستن این صفحه باقی می‌مانند.",
      );
    }
  };
  const activity = useMemo(
    () =>
      new Map(
        courses.map((course) => [course.id, courseActivity(course, progress)]),
      ),
    [courses, progress],
  );
  const visible = useMemo(
    () =>
      courses
        .filter((course) => {
          const state = activity.get(course.id)!;
          const match = searchText(
            course.title + " " + (course.instructor || ""),
          ).includes(searchText(query));
          const accepts =
            filter === "all" ||
            (filter === "saved" && bookmarks.includes(course.id)) ||
            (filter === "started" && state.started && !state.completed) ||
            (filter === "offline" && (course.downloadedCount || 0) > 0) ||
            (filter === "completed" && state.completed);
          return match && accepts;
        })
        .sort((a, b) => {
          if (sort === "title") return a.title.localeCompare(b.title, "fa");
          if (sort === "progress")
            return (
              (activity.get(b.id)!.percent || 0) -
              (activity.get(a.id)!.percent || 0)
            );
          return activity.get(b.id)!.updatedAt - activity.get(a.id)!.updatedAt;
        }),
    [courses, activity, query, filter, bookmarks, sort],
  );
  const recent = useMemo(
    () =>
      Object.values(progress)
        .filter(
          (item) =>
            !item.completed && item.position > 0 && activity.has(item.courseId),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)[0],
    [progress, activity],
  );
  const featured =
    courses.find((course) => course.id === recent?.courseId) || courses[0];
  const completedLessons = Object.values(progress).filter(
    (item) => item.completed && activity.has(item.courseId),
  ).length;
  const offlineLessons = courses.reduce(
    (sum, course) => sum + (course.downloadedCount || 0),
    0,
  );
  const startFeatured = () => {
    if (!featured) return;
    if (recent && onResumeLesson) onResumeLesson(featured, recent);
    else onSelectCourse(featured);
  };
  return (
    <div className="course-library-container v3-library">
      <header className="page-topbar">
        <div>
          <h1 className="page-title">فضای یادگیری من</h1>
          <p className="page-subtitle">هر بار یک درس، یک قدم جلوتر.</p>
        </div>
        <div className="topbar-actions">
          <button
            className="btn btn-secondary"
            onClick={onRefresh}
            disabled={loading}
            aria-label="بروزرسانی دوره‌ها"
          >
            <RefreshCw size={17} className={loading ? "spinning" : ""} />
            <span>بروزرسانی</span>
          </button>
          <button className="btn btn-primary" onClick={onOpenImport}>
            <Plus size={18} />
            افزودن دوره
          </button>
        </div>
      </header>
      {(warning || saveError) && (
        <div className="warning-banner" role="status">
          {warning || saveError}
        </div>
      )}
      <section className="study-overview" aria-label="مرور یادگیری">
        <div className="study-feature">
          <div className="study-feature-copy">
            <span className="feature-label">
              <span className="live-dot" />
              {recent
                ? "ادامه از همان‌جا که بودی"
                : "وقتِ یک چیز تازه یاد گرفتن"}
            </span>
            <h2>
              {recent
                ? recent.lessonTitle
                : featured
                  ? "مسیر بعدی تو، از اینجا شروع می‌شود."
                  : "کتابخانه‌ات را بساز."}
            </h2>
            <p>
              {featured
                ? featured.title
                : "دوره‌هایت را اضافه کن و درس‌ها را با ریتم خودت پیش ببر."}
            </p>
            <div className="feature-bottom">
              <button
                className="btn feature-play"
                onClick={featured ? startFeatured : onOpenImport}
              >
                <Play size={18} fill="currentColor" />
                {recent
                  ? "ادامه یادگیری"
                  : featured
                    ? "شروع یادگیری"
                    : "افزودن اولین دوره"}
              </button>
              {recent && <span>{formatDuration(recent.position)}</span>}
            </div>
          </div>
          <div className="book-composition" aria-hidden="true">
            <div className="book-back" />
            <div className="book-front">
              <BookOpen size={42} strokeWidth={1} />
              <span>
                یادگیری
                <br />
                ادامه دارد.
              </span>
              <div className="book-rule" />
            </div>
          </div>
        </div>
        <div className="study-summary">
          <h2>تا اینجای مسیر</h2>
          <div>
            <BookOpen size={19} />
            <strong>{courses.length.toLocaleString("fa")}</strong>
            <span>دوره در کتابخانه</span>
          </div>
          <div>
            <Check size={19} />
            <strong>{completedLessons.toLocaleString("fa")}</strong>
            <span>درس تکمیل‌شده</span>
          </div>
          <div>
            <HardDrive size={19} />
            <strong>{offlineLessons.toLocaleString("fa")}</strong>
            <span>درس آماده آفلاین</span>
          </div>
        </div>
      </section>
      <div className="library-section-heading">
        <h2>
          کتابخانه من <span>{courses.length.toLocaleString("fa")}</span>
        </h2>
        <div className="view-switch" aria-label="نمای کتابخانه">
          <button
            aria-label="نمای شبکه‌ای"
            aria-pressed={layout === "grid"}
            onClick={() => setLayout("grid")}
          >
            <LayoutGrid size={18} />
          </button>
          <button
            aria-label="نمای فهرستی"
            aria-pressed={layout === "list"}
            onClick={() => setLayout("list")}
          >
            <List size={19} />
          </button>
        </div>
      </div>
      <div className="library-toolbar">
        <div className="library-tabs" aria-label="فیلتر دوره‌ها">
          {filters.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="library-controls">
          <div className="input-group search-input-group">
            <Search size={17} />
            <input
              id="course-search-input"
              type="search"
              className="input-control"
              placeholder="جستجوی دوره یا مدرس…"
              aria-label="جستجوی عنوان دوره یا نام مدرس"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            aria-label="مرتب‌سازی دوره‌ها"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="recent">آخرین مطالعه</option>
            <option value="title">نام دوره</option>
            <option value="progress">بیشترین پیشرفت</option>
          </select>
        </div>
      </div>
      <p className="result-count" aria-live="polite">
        {visible.length.toLocaleString("fa")} دوره{query ? " مطابق جستجو" : ""}
      </p>
      {loading && !courses.length ? (
        <div className="state-box" role="status">
          <RefreshCw className="spinning" />
          در حال بارگذاری کتابخانه…
        </div>
      ) : !visible.length ? (
        <div className="state-box">
          <BookOpen size={32} />
          <h2>اینجا هنوز دوره‌ای نیست</h2>
          <p>
            {filter === "saved"
              ? "با زدن نشان کنار هر دوره، آن را برای بعد نگه دار."
              : "فیلترها را تغییر بده یا دوره‌ای به کتابخانه اضافه کن."}
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            نمایش همه دوره‌ها
          </button>
        </div>
      ) : (
        <div className={"library-cards " + layout}>
          {visible.map((course, index) => {
            const state = activity.get(course.id)!;
            const saved = bookmarks.includes(course.id);
            return (
              <article className="library-card" key={course.id}>
                <div className={"course-cover cover-" + (index % 4)}>
                  <div className="cover-type" aria-hidden="true">
                    <BookOpen size={34} strokeWidth={1.2} />
                    <span>{course.title.replace(/\[.*?\]/g, "").trim()}</span>
                  </div>
                  {course.thumbnail && (
                    <img
                      src={course.thumbnail}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                    />
                  )}
                  <button
                    className="bookmark-button"
                    aria-label={
                      (saved ? "حذف نشان " : "نشان کردن ") + course.title
                    }
                    aria-pressed={saved}
                    onClick={() => toggleBookmark(course.id)}
                  >
                    <Bookmark
                      size={18}
                      fill={saved ? "currentColor" : "none"}
                    />
                  </button>
                  {!!course.downloadedCount && (
                    <span className="cover-offline">
                      <HardDrive size={13} />
                      آفلاین
                    </span>
                  )}
                </div>
                <div className="library-card-body">
                  <span className="card-instructor">
                    {course.instructor || "دوره مکتب‌خونه"}
                  </span>
                  <h3>
                    <button onClick={() => onSelectCourse(course)}>
                      {course.title}
                    </button>
                  </h3>
                  <div className="card-progress-label">
                    <span>
                      {state.started
                        ? state.watched.toLocaleString("fa") + " درس تکمیل‌شده"
                        : "آماده شروع"}
                    </span>
                    <span>
                      {state.percent !== null
                        ? state.percent.toLocaleString("fa") + "٪"
                        : "—"}
                    </span>
                  </div>
                  <progress
                    aria-label={"پیشرفت " + course.title}
                    max={100}
                    value={state.percent || 0}
                  />
                  <div className="card-footer">
                    <span>
                      {course.lessonCount !== undefined
                        ? course.lessonCount.toLocaleString("fa") + " درس"
                        : "مشاهده سرفصل‌ها"}
                    </span>
                    <button
                      onClick={() => onSelectCourse(course)}
                      aria-label={"باز کردن " + course.title}
                    >
                      {state.completed
                        ? "مرور دوره"
                        : state.started
                          ? "ادامه دوره"
                          : "مشاهده دوره"}
                      <ArrowUpLeft size={17} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

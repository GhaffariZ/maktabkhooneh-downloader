import React, { useState, useMemo } from 'react';
import { Search, RefreshCw, Plus, BookOpen, User, AlertCircle, Play, Clock, HardDrive } from 'lucide-react';
import type { Course } from '@shared/types';
import type { LessonProgress, ProgressTable } from '../utils/studyProgress';
import { formatDuration } from '../utils/format';

interface CourseLibraryProps {
  courses: Course[];
  loading: boolean;
  warning?: string;
  progress: ProgressTable;
  onSelectCourse: (course: Course) => void;
  onResumeLesson?: (course: Course, resume: LessonProgress) => void;
  onRefresh: () => void;
  onOpenImport: () => void;
}

export const CourseLibrary: React.FC<CourseLibraryProps> = ({
  courses,
  loading,
  warning,
  progress,
  onSelectCourse,
  onResumeLesson,
  onRefresh,
  onOpenImport,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Find most recent unfinished played lesson across available courses for modest "ادامه یادگیری"
  const recentResume = useMemo<{ course: Course; progress: LessonProgress } | null>(() => {
    const list = Object.values(progress || {});
    // Candidates: not completed, played (position > 0), belongs to an available course
    const candidates = list.filter((p) => {
      if (p.completed || !p.position || p.position <= 0) return false;
      return courses.some((c) => c.id === p.courseId);
    });

    if (candidates.length === 0) return null;

    // Sort by most recently updated
    candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const top = candidates[0];
    const course = courses.find((c) => c.id === top.courseId);
    if (!course) return null;

    return { course, progress: top };
  }, [courses, progress]);

  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return courses;
    const q = searchQuery.toLowerCase().trim();
    return courses.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.instructor && c.instructor.toLowerCase().includes(q))
    );
  }, [courses, searchQuery]);

  return (
    <div className="course-library-container">
      {/* Topbar */}
      <div className="page-topbar">
        <div>
          <h1 style={{ fontSize: '1.35rem', marginBottom: 'var(--space-1)', fontWeight: 700 }}>
            دوره‌های آموزشی
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', margin: 0 }}>
            کتابخانه شخصی و سوابق مطالعه در مکتب‌خونه
          </p>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRefresh}
            disabled={loading}
            title="بروزرسانی فهرست دوره‌ها از سرور"
          >
            <RefreshCw size={15} className={loading ? 'spinning' : ''} aria-hidden="true" />
            <span>بروزرسانی</span>
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onOpenImport}
            title="ثبت دوره جدید با پیوند اینترنتی"
          >
            <Plus size={15} aria-hidden="true" />
            <span>افزودن با پیوند</span>
          </button>
        </div>
      </div>

      {warning && (
        <div className="warning-banner" style={{ marginBottom: 'var(--space-4)' }} role="status">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{warning}</span>
        </div>
      )}

      {/* Modest "ادامه یادگیری" Shelf */}
      {recentResume && !searchQuery.trim() && (
        <div className="resume-shelf" aria-label="ادامه یادگیری">
          <div className="resume-shelf-info">
            <div className="resume-shelf-badge">
              <Clock size={13} aria-hidden="true" />
              <span>ادامه یادگیری</span>
            </div>
            <div className="resume-shelf-title" title={recentResume.progress.lessonTitle}>
              {recentResume.progress.lessonTitle}
            </div>
            <div className="resume-shelf-meta">
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {recentResume.course.title}
              </span>
              <span className="tabular-num" style={{ color: 'var(--color-text-muted)' }}>
                موقعیت: {formatDuration(recentResume.progress.position)}
                {recentResume.progress.duration
                  ? ` از ${formatDuration(recentResume.progress.duration)}`
                  : ''}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-sm resume-action-btn"
            onClick={() => onResumeLesson?.(recentResume.course, recentResume.progress)}
            aria-label={`ادامه یادگیری درس ${recentResume.progress.lessonTitle}`}
          >
            <Play size={15} aria-hidden="true" />
            <span>ادامه درس</span>
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div style={{ maxWidth: 460, marginBottom: 'var(--space-5)' }}>
        <div className="input-group">
          <Search size={18} color="var(--color-text-muted)" aria-hidden="true" />
          <input
            id="course-search-input"
            name="courseSearch"
            type="search"
            className="input-control"
            placeholder="جستجوی عنوان دوره یا نام مدرس..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="جستجوی عنوان دوره یا نام مدرس"
          />
        </div>
      </div>

      {loading && courses.length === 0 ? (
        <div className="state-box">
          <RefreshCw size={36} className="spinning" color="var(--color-accent)" aria-hidden="true" />
          <div className="state-title">در حال بارگذاری دوره‌ها...</div>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="state-box">
          <BookOpen className="state-icon" aria-hidden="true" />
          <div className="state-title">
            {searchQuery ? 'هیچ دوره‌ای مطابق جستجو یافت نشد' : 'دوره‌ای در کتابخانه موجود نیست'}
          </div>
          <p style={{ maxWidth: 400, fontSize: '0.88rem' }}>
            {searchQuery
              ? 'لطفاً عبارت دیگری را برای جستجو وارد کنید.'
              : 'می‌توانید با استفاده از دکمه «افزودن با پیوند»، دوره مورد نظرتان را اضافه کنید یا وارد حساب خود شوید.'}
          </p>
          {!searchQuery && (
            <button type="button" className="btn btn-primary" onClick={onOpenImport}>
              <Plus size={16} aria-hidden="true" />
              <span>افزودن دوره با پیوند</span>
            </button>
          )}
        </div>
      ) : (
        <div className="course-grid">
          {filteredCourses.map((course) => {
            const hasDownloaded = (course.downloadedCount || 0) > 0;

            // Calculate watched lessons count from progress table
            const watchedCount = Object.values(progress || {}).filter(
              (p) => p.courseId === course.id && p.completed
            ).length;

            const totalCount = course.lessonCount;
            const hasKnownTotal = totalCount !== undefined && totalCount > 0;
            const percentWatched = hasKnownTotal
              ? Math.min(100, Math.round((watchedCount / (totalCount as number)) * 100))
              : null;

            return (
              <div
                key={course.id}
                className="course-card clickable"
                onClick={() => onSelectCourse(course)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectCourse(course);
                  }
                }}
                aria-label={`دوره ${course.title}`}
              >
                {/* Fixed thumbnail & fallback layering */}
                <div className="course-thumbnail-wrapper">
                  <div className="course-thumbnail-fallback" aria-hidden="true">
                    <BookOpen size={36} aria-hidden="true" />
                    <span>مکتب‌خونه</span>
                  </div>
                  {course.thumbnail ? (
                    <img
                      src={course.thumbnail}
                      alt=""
                      className="course-thumbnail"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                </div>

                <div className="course-card-content">
                  <h2 className="course-title" title={course.title}>
                    {course.title}
                  </h2>

                  {course.instructor ? (
                    <div className="course-instructor">
                      <User size={14} style={{ display: 'inline', marginInlineEnd: 4 }} aria-hidden="true" />
                      <span>{course.instructor}</span>
                    </div>
                  ) : (
                    <div className="course-instructor" style={{ color: 'var(--color-text-muted)' }}>
                      مدرس مشخص نشده
                    </div>
                  )}

                  {/* Progress Line */}
                  {percentWatched !== null ? (
                    <div className="course-progress-container">
                      <div className="course-progress-header">
                        <span className="course-progress-label">
                          <span className="tabular-num">{watchedCount}</span> از{' '}
                          <span className="tabular-num">{totalCount}</span> درس تکمیل شده
                        </span>
                        <span className="tabular-num course-progress-pct">{percentWatched}٪</span>
                      </div>
                      <div
                        className="course-progress-track"
                        role="progressbar"
                        aria-valuenow={percentWatched}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${percentWatched} درصد از دوره مشاهده شده`}
                      >
                        <div
                          className="course-progress-fill"
                          style={{ width: `${percentWatched}%` }}
                        />
                      </div>
                    </div>
                  ) : watchedCount > 0 ? (
                    <div className="course-progress-container">
                      <div className="course-progress-header">
                        <span className="course-progress-label">
                          <span className="tabular-num">{watchedCount}</span> درس مشاهده شده
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {/* Meta row at bottom */}
                  <div className="course-meta-row">
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      {hasKnownTotal ? (
                        <>
                          <span className="tabular-num">{totalCount}</span> درس
                        </>
                      ) : (
                        'تعداد درس نامشخص'
                      )}
                    </span>

                    {/* Downloaded badge kept strictly separate from watched state */}
                    {hasDownloaded && (
                      <span
                        className="lesson-badge-pill badge-offline"
                        title={`${course.downloadedCount} درس در حافظه دستگاه`}
                      >
                        <HardDrive size={12} aria-hidden="true" />
                        <span>
                          <span className="tabular-num">{course.downloadedCount}</span> آفلاین
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

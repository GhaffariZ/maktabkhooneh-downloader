import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowRight,
  Play,
  Download,
  CheckCircle2,
  Lock,
  Clock,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Loader2,
  Search,
  X,
  Maximize2,
  Minimize2,
  HelpCircle,
} from 'lucide-react';
import type { Course, Chapter, Lesson, Quality } from '@shared/types';
import { VideoPlayer } from './VideoPlayer';
import { StudyNotes } from './StudyNotes';
import { QualitySelectorModal } from './QualitySelectorModal';
import { formatDuration, formatQualityLabel } from '../utils/format';
import { preferredPlaybackQuality } from '../utils/playbackQuality';
import type { QualityPreference } from '../utils/studyPreferences';
import { api } from '../api/client';
import {
  lessonKey,
  type ProgressTable,
  type ProgressUpdate,
  type LessonProgress,
} from '../utils/studyProgress';
import '../styles/study-player.css';

export interface InitialOfflinePlayback {
  downloadId: string;
  lessonId: string;
  lessonTitle: string;
  quality: string;
}

interface LessonPlayback {
  lesson: Lesson;
  position?: number;
  autoPlay: boolean;
  qualityId?: string;
  qualities: Quality[];
  preparing: boolean;
}

export interface CourseDetailProps {
  scope?: 'demo' | 'real';
  course: Course;
  chapters: Chapter[];
  loading: boolean;
  initialPlayback?: InitialOfflinePlayback | null;
  onBack: () => void;
  onEnqueueDownload: (courseId: string, lessonId: string, quality: string) => Promise<void>;
  // Study progress & preferences props
  progress?: ProgressTable;
  onProgress?: (courseId: string, lessonId: string, lessonTitle: string, update: ProgressUpdate) => void;
  initialResume?: LessonProgress | null;
  preferredQuality?: QualityPreference;
  playbackRate?: number;
}

export const CourseDetail: React.FC<CourseDetailProps> = ({
  scope = 'real',
  course,
  chapters,
  loading,
  initialPlayback,
  onBack,
  onEnqueueDownload,
  progress,
  onProgress,
  initialResume,
  preferredQuality = 'auto',
  playbackRate,
}) => {
  const [playback, setPlayback] = useState<LessonPlayback | null>(null);
  const selectedLesson = playback?.lesson ?? null;
  const download = selectedLesson?.download;
  const offlineDownload = download?.status === 'completed' ? download : null;
  const videoSrc = !selectedLesson || playback?.preparing ? null : offlineDownload
    ? api.getLocalMediaUrl(offlineDownload.id)
    : api.getStreamUrl(selectedLesson.id, course.id, playback?.qualityId);
  const playerRef = useRef<HTMLDivElement>(null);
  const [playbackStarts, setPlaybackStarts] = useState(0);
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});

  // Focus mode & keyboard shortcuts hint state
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Outline search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unfinished' | 'watched'>('all');

  // Quality modal state and request-id guard
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLesson, setModalLesson] = useState<Lesson | null>(null);
  const [modalQualities, setModalQualities] = useState<Quality[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);

  // Invalidate any in-flight quality fetches on close, new lesson, or unmount
  const qualityRequestIdRef = useRef(0);
  const handledInitialResumeRef = useRef<string | null>(null);
  const handledInitialPlaybackRef = useRef<string | null>(null);

  // Keep a stable ref to progress so effects consuming it once don't re-trigger on watch events
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    if (!playbackStarts) return;
    const frame = requestAnimationFrame(() => {
      playerRef.current?.focus({ preventScroll: true });
      playerRef.current?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [playbackStarts]);

  useEffect(() => {
    return () => {
      qualityRequestIdRef.current++;
    };
  }, [course.id]);

  // Manage body class and Escape shortcut for Focus Mode
  useEffect(() => {
    if (isFocusMode) {
      document.body.classList.add('study-focus-active');
    } else {
      document.body.classList.remove('study-focus-active');
    }
    return () => {
      document.body.classList.remove('study-focus-active');
    };
  }, [isFocusMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape must let an open dialog close before exiting focus
      if (modalOpen) {
        return;
      }

      // Ignore Escape if already handled by inner controls (e.g. Video.js menu/dialog)
      if (e.defaultPrevented) {
        return;
      }

      // Ignore fullscreen Escape if a fullscreen element is currently active
      if (document.fullscreenElement) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }

      // Defer Escape if target or focus belongs to a Video.js menu or popup inside .study-video-skin
      if (
        target?.closest?.('.study-video-skin [role="menu"], .study-video-skin [role="dialog"], .study-video-skin [popover]')
      ) {
        return;
      }

      if (e.key === 'Escape' && isFocusMode) {
        e.preventDefault();
        setIsFocusMode(false);
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsFocusMode((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFocusMode, modalOpen]);

  const handlePlayLesson = async (lesson: Lesson, resumePosition?: number) => {
    const saved = progressRef.current?.[lessonKey(course.id, lesson.id)];
    const offline = lesson.download?.status === 'completed';
    const next: LessonPlayback = {
      lesson,
      position: resumePosition ?? (saved?.completed ? undefined : saved?.position),
      autoPlay: true,
      qualities: [],
      preparing: !offline && preferredQuality !== 'auto',
    };
    setPlayback(next);
    setPlayerError(null);
    setPlaybackStarts((count) => count + 1);
    if (offline) return;

    const result = await api.getLessonQualities(lesson.id, course.id).catch(() => null);
    const qualities = result?.qualities ?? [];
    setPlayback((current) => current === next ? {
      ...current,
      preparing: false,
      qualities,
      qualityId: preferredPlaybackQuality(qualities, preferredQuality),
    } : current);
  };

  const handlePlaybackQualityChange = (qualityId: string, position: number, paused: boolean) => {
    if (!playback || playback.qualityId === (qualityId || undefined)) return;
    setPlayerError(null);
    setPlayback({ ...playback, qualityId: qualityId || undefined, position, autoPlay: !paused });
  };

  // Consume initial offline playback once per explicit ID/course without re-triggering on progress.
  useEffect(() => {
    if (!initialPlayback) {
      return;
    }
    const playbackKey = `${course.id}_${initialPlayback.downloadId}_${initialPlayback.lessonId}`;
    if (handledInitialPlaybackRef.current === playbackKey) {
      return;
    }
    handledInitialPlaybackRef.current = playbackKey;

    void handlePlayLesson({
      id: initialPlayback.lessonId,
      title: initialPlayback.lessonTitle,
      accessible: true,
      download: {
        id: initialPlayback.downloadId,
        courseId: course.id,
        lessonId: initialPlayback.lessonId,
        courseTitle: course.title,
        lessonTitle: initialPlayback.lessonTitle,
        quality: initialPlayback.quality,
        status: 'completed',
        downloadedBytes: 0,
      },
    });
  }, [initialPlayback, course.id, course.title]);

  // Wire explicit initialResume: finds target in loaded outline FIRST, then marks handled
  useEffect(() => {
    if (!initialResume || initialResume.courseId !== course.id) {
      return;
    }
    const resumeKey = `${initialResume.courseId}_${initialResume.lessonId}_${initialResume.position}`;
    if (handledInitialResumeRef.current === resumeKey) {
      return;
    }

    // Find target first among loaded chapters
    let targetLesson: Lesson | null = null;
    for (const ch of chapters) {
      const match = ch.lessons.find((l) => l.id === initialResume.lessonId);
      if (match && (match.accessible || match.download?.status === 'completed')) {
        targetLesson = match;
        break;
      }
    }

    // If target not yet found in chapters (outline still loading) or not accessible, wait for chapters
    if (!targetLesson) {
      return;
    }

    // Target found and accessible/completed: mark handled NOW
    handledInitialResumeRef.current = resumeKey;

    void handlePlayLesson(targetLesson, initialResume.position);
  }, [initialResume, course.id, chapters]);

  const toggleChapter = (chapterId: string) => {
    setCollapsedChapters((prev) => ({ ...prev, [chapterId]: !prev[chapterId] }));
  };

  const handleCloseQualityModal = () => {
    qualityRequestIdRef.current++;
    setModalOpen(false);
    setModalLesson(null);
    setModalQualities([]);
    setModalError(null);
    setModalLoading(false);
  };

  const handleOpenDownloadQuality = async (lesson: Lesson) => {
    const requestId = ++qualityRequestIdRef.current;
    setModalLesson(lesson);
    setModalOpen(true);
    setModalLoading(true);
    setModalError(null);
    setModalQualities([]);

    try {
      const res = await api.getLessonQualities(lesson.id, course.id);
      if (requestId === qualityRequestIdRef.current) {
        setModalQualities(res.qualities || []);
      }
    } catch (err: unknown) {
      if (requestId === qualityRequestIdRef.current) {
        const msg = err instanceof Error ? err.message : 'خطا در دریافت کیفیت‌های ویدیو';
        setModalError(msg);
      }
    } finally {
      if (requestId === qualityRequestIdRef.current) {
        setModalLoading(false);
      }
    }
  };

  const handleConfirmQuality = async (qualityId: string) => {
    if (!modalLesson) return;

    const requestId = qualityRequestIdRef.current;
    setModalLoading(true);
    try {
      await onEnqueueDownload(course.id, modalLesson.id, qualityId);
      if (requestId === qualityRequestIdRef.current) handleCloseQualityModal();
    } catch (err: unknown) {
      if (requestId !== qualityRequestIdRef.current) return;
      const msg = err instanceof Error ? err.message : 'خطا در افزودن به صف دانلود';
      setModalError(msg);
      setModalLoading(false);
    }
  };

  // Video progress callback from VideoPlayer
  const handleVideoProgress = (update: ProgressUpdate) => {
    if (selectedLesson && onProgress) {
      onProgress(course.id, selectedLesson.id, selectedLesson.title, update);
    }
  };

  // Manual watched toggle
  const handleToggleWatched = (lesson: Lesson, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onProgress) return;
    const key = lessonKey(course.id, lesson.id);
    const existing = progress?.[key];
    const isCompleted = existing?.completed ?? false;
    onProgress(course.id, lesson.id, lesson.title, {
      completed: !isCompleted,
    });
  };

  // Course completion summary: strictly independent of outline search/filter
  const { totalLessons, completedCount, completionPercent } = useMemo(() => {
    const all = chapters.flatMap((c) => c.lessons);
    const total = all.length;
    let completed = 0;
    if (progress) {
      for (const lesson of all) {
        if (progress[lessonKey(course.id, lesson.id)]?.completed) {
          completed++;
        }
      }
    }
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { totalLessons: total, completedCount: completed, completionPercent: percent };
  }, [chapters, progress, course.id]);

  // Filtered chapters for the outline sidebar
  const filteredChapters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return chapters
      .map((chapter) => {
        const lessons = chapter.lessons.filter((lesson) => {
          if (query && !lesson.title.toLowerCase().includes(query)) {
            return false;
          }
          const isCompleted = progress?.[lessonKey(course.id, lesson.id)]?.completed ?? false;
          if (filterMode === 'watched') {
            return isCompleted;
          }
          if (filterMode === 'unfinished') {
            return !isCompleted;
          }
          return true;
        });
        return {
          ...chapter,
          lessons,
        };
      })
      .filter((chapter) => chapter.lessons.length > 0);
  }, [chapters, searchQuery, filterMode, progress, course.id]);

  return (
    <div className={`course-detail-container ${isFocusMode ? 'focus-mode-container' : ''}`}>
      {/* Topbar navigation: hidden via CSS in focus mode */}
      <div className="page-topbar detail-topbar">
        <div className="detail-topbar-start">
          <button
            type="button"
            className="btn btn-secondary btn-sm back-nav-btn"
            onClick={onBack}
            aria-label="بازگشت به فهرست دوره‌ها"
          >
            <ArrowRight size={15} aria-hidden="true" />
            <span>بازگشت به دوره‌ها</span>
          </button>
          <div>
            <h1 className="detail-course-title">{course.title}</h1>
            {course.instructor && (
              <div className="detail-instructor-tag">
                مدرس: {course.instructor}
              </div>
            )}
          </div>
        </div>

        <div className="detail-topbar-end">
          <span className="detail-meta-pill tabular-num">
            {totalLessons} درس
          </span>
          {completionPercent > 0 && (
            <span className="detail-meta-pill completion-pill tabular-num">
              {completionPercent}٪ مشاهده شده
            </span>
          )}
        </div>
      </div>

      <div className="course-detail-layout">
        {/* Main Video Player Column */}
        <div className="course-main-column">
          {/* Study Tools Toolbar */}
          <div className="study-player-tools">
            <div className="study-tools-left">
              {isFocusMode ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm btn-exit-focus"
                  onClick={() => setIsFocusMode(false)}
                  aria-label="خروج از حالت تمرکز (کلید Esc)"
                >
                  <Minimize2 size={15} aria-hidden="true" />
                  <span>خروج از تمرکز (Esc)</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsFocusMode(true)}
                  title="حالت تمرکز برای مطالعه (مخفی کردن منو و فهرست)"
                  aria-label="ورود به حالت تمرکز"
                >
                  <Maximize2 size={15} aria-hidden="true" />
                  <span>حالت تمرکز</span>
                </button>
              )}

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowShortcutsHelp((prev) => !prev)}
                title="راهنمای کلیدهای میانبر"
                aria-label="راهنمای کلیدهای میانبر"
                aria-expanded={showShortcutsHelp}
              >
                <HelpCircle size={15} aria-hidden="true" />
                <span>کلیدهای میانبر</span>
              </button>
            </div>

            {selectedLesson && (
              <div className="study-tools-status">
                <span className="current-lesson-label" title={selectedLesson.title}>
                  درس جاری: {selectedLesson.title}
                </span>
              </div>
            )}
          </div>

          {/* Collapsible Keyboard Shortcuts Panel - Matches V's actual controls */}
          {showShortcutsHelp && (
            <div className="study-shortcuts-hint" role="region" aria-label="راهنمای کلیدهای میانبر">
              <div className="shortcuts-grid">
                <div><kbd>Space</kbd>: پخش / توقف</div>
                <div><kbd>→</kbd> / <kbd>←</kbd>: پرش زمانی (جلو / عقب)</div>
                <div><kbd>F</kbd>: حالت تمرکز</div>
                <div><kbd>Esc</kbd>: خروج از تمرکز</div>
              </div>
            </div>
          )}

          {/* Native Video Player */}
          <VideoPlayer
            panelRef={playerRef}
            playbackStart={playbackStarts}
            course={course}
            lesson={selectedLesson}
            videoSrc={videoSrc}
            isOfflineSource={!!offlineDownload}
            offlineQuality={offlineDownload ? formatQualityLabel(undefined, offlineDownload.quality) : undefined}
            preparing={playback?.preparing}
            qualities={playback?.qualities}
            qualityId={playback?.qualityId}
            onQualityChange={handlePlaybackQualityChange}
            errorMessage={playerError}
            onError={setPlayerError}
            resumeSeconds={playback?.position}
            autoPlay={playback?.autoPlay}
            defaultPlaybackRate={playbackRate}
            onProgress={handleVideoProgress}
          />
          {selectedLesson && !isFocusMode && <StudyNotes
            key={JSON.stringify([scope, course.id, selectedLesson.id])}
            scope={scope} courseId={course.id} lessonId={selectedLesson.id} title={selectedLesson.title}
          />}
        </div>

        {/* Chapters & Lessons Outline Sidebar */}
        <div className="course-outline-panel" aria-label="سرفصل‌ها و درس‌های دوره">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>سرفصل‌های دوره</h2>
            <span className="tabular-num" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              {totalLessons} درس
            </span>
          </div>

          {/* Course Completion Summary */}
          <div className="course-progress-summary">
            <div className="course-progress-header">
              <span className="course-progress-title">پیشرفت دوره</span>
              <span className="course-progress-stat tabular-num">
                {completedCount} از {totalLessons} درس تکمیل شده ({completionPercent}٪)
              </span>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div
                className="progress-fill"
                style={{ width: `${completionPercent}%` }}
              />
            </div>
          </div>

          {/* Outline Search & Filters */}
          <div className="outline-filter-bar">
            <div className="lesson-search-box">
              <Search size={14} className="search-icon" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی درس..."
                className="lesson-search-input"
                aria-label="جستجوی درس‌های دوره"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="پاک کردن جستجو"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Filter Buttons with aria-pressed */}
            <div className="filter-pill-group" role="group" aria-label="فیلتر وضعیت درس‌ها">
              <button
                type="button"
                aria-pressed={filterMode === 'all'}
                className={`filter-pill ${filterMode === 'all' ? 'active' : ''}`}
                onClick={() => setFilterMode('all')}
              >
                همه ({totalLessons})
              </button>
              <button
                type="button"
                aria-pressed={filterMode === 'unfinished'}
                className={`filter-pill ${filterMode === 'unfinished' ? 'active' : ''}`}
                onClick={() => setFilterMode('unfinished')}
              >
                مشاهده نشده ({totalLessons - completedCount})
              </button>
              <button
                type="button"
                aria-pressed={filterMode === 'watched'}
                className={`filter-pill ${filterMode === 'watched' ? 'active' : ''}`}
                onClick={() => setFilterMode('watched')}
              >
                مشاهده شده ({completedCount})
              </button>
            </div>
          </div>

          {loading ? (
            <div className="state-box" style={{ padding: 'var(--space-8)' }}>
              <Loader2 size={28} className="spinning" color="var(--color-accent)" aria-hidden="true" />
              <div style={{ fontSize: '0.88rem' }}>در حال دریافت سرفصل‌ها...</div>
            </div>
          ) : chapters.length === 0 ? (
            <div className="state-box" style={{ padding: 'var(--space-6)' }}>
              <div style={{ fontSize: '0.88rem' }}>سرفصلی برای این دوره ثبت نشده است.</div>
            </div>
          ) : filteredChapters.length === 0 ? (
            <div className="outline-empty-state">
              <div>درسی مطابق با فیلتر یا جستجوی شما یافت نشد.</div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSearchQuery('');
                  setFilterMode('all');
                }}
              >
                نمایش همه درس‌ها
              </button>
            </div>
          ) : (
            <div
              className="chapter-scroll"
              role="region"
              aria-label="فهرست فصل‌ها و درس‌ها"
              tabIndex={0}
            >
              {filteredChapters.map((chapter) => {
                const isCollapsed = !!collapsedChapters[chapter.id];

                return (
                  <div key={chapter.id} className="chapter-group">
                    <button
                      type="button"
                      className="chapter-header clickable"
                      onClick={() => toggleChapter(chapter.id)}
                      style={{
                        width: '100%',
                        border: 'none',
                        background: 'var(--color-surface-subtle)',
                        textAlign: 'right',
                        color: 'var(--color-text-primary)',
                      }}
                      aria-expanded={!isCollapsed}
                    >
                      <span style={{ color: 'var(--color-text-primary)' }}>{chapter.title}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span className="tabular-num" style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                          {chapter.lessons.length} درس
                        </span>
                        {isCollapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <div className="lesson-list">
                        {chapter.lessons.map((lesson) => {
                          const isSelected = selectedLesson?.id === lesson.id;
                          const isOffline = lesson.download?.status === 'completed';
                          const isDownloading =
                            lesson.download?.status === 'downloading' ||
                            lesson.download?.status === 'queued';

                          // Study progress state for this lesson
                          const pKey = lessonKey(course.id, lesson.id);
                          const progressRecord = progress ? progress[pKey] : undefined;
                          const isWatched = progressRecord?.completed ?? false;
                          const positionSeconds = progressRecord?.position ?? 0;

                          return (
                            <div
                              key={lesson.id}
                              className={`lesson-item ${isSelected ? 'selected' : ''} ${!lesson.accessible ? 'inaccessible' : ''}`}
                            >
                              {/* Manual Watched Toggle */}
                              <button
                                type="button"
                                className={`btn-toggle-watched ${isWatched ? 'is-completed' : ''}`}
                                onClick={(e) => handleToggleWatched(lesson, e)}
                                title={
                                  isWatched
                                    ? 'علامت‌گذاری به عنوان مشاهده نشده'
                                    : 'علامت‌گذاری به عنوان مشاهده شده'
                                }
                                aria-label={
                                  isWatched
                                    ? `علامت‌گذاری درس ${lesson.title} به عنوان مشاهده نشده`
                                    : `علامت‌گذاری درس ${lesson.title} به عنوان مشاهده شده`
                                }
                              >
                                <CheckCircle2 size={16} aria-hidden="true" />
                              </button>

                              <div className="lesson-title-col">
                                <span className="lesson-title-text" title={lesson.title}>
                                  {lesson.title}
                                </span>
                                <div className="lesson-meta-text">
                                  {lesson.duration ? (
                                    <span>
                                      <Clock size={12} style={{ display: 'inline', marginInlineEnd: 2 }} aria-hidden="true" />
                                      <span className="tabular-num">{formatDuration(lesson.duration)}</span>
                                    </span>
                                  ) : null}

                                  {/* Distinct Offline Indicator */}
                                  {isOffline && (
                                    <span className="lesson-badge-pill badge-offline">
                                      <HardDrive size={12} aria-hidden="true" />
                                      <span>آفلاین</span>
                                    </span>
                                  )}

                                  {/* Distinct Watched Indicator */}
                                  {isWatched && (
                                    <span className="lesson-badge-pill badge-watched">
                                      <CheckCircle2 size={12} aria-hidden="true" />
                                      <span>مشاهده شده</span>
                                    </span>
                                  )}

                                  {/* Distinct Resume Position Indicator */}
                                  {!isWatched && positionSeconds > 5 && (
                                    <span
                                      className="lesson-badge-pill badge-resumable"
                                      title={`موقعیت ذخیره شده: ${formatDuration(Math.floor(positionSeconds))}`}
                                    >
                                      <span>تا {formatDuration(Math.floor(positionSeconds))}</span>
                                    </span>
                                  )}

                                  {isDownloading && (
                                    <span className="lesson-badge-pill badge-downloading">
                                      <span>{lesson.download?.status === 'downloading' ? 'در حال دانلود' : 'در صف'}</span>
                                    </span>
                                  )}

                                  {!lesson.accessible && (
                                    <span className="lesson-badge-pill badge-inaccessible">
                                      <Lock size={12} aria-hidden="true" />
                                      <span>غیرقابل دسترس</span>
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="lesson-actions">
                                {/* DISTINCT Play Button with Resume Labeling */}
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm btn-icon"
                                  disabled={!lesson.accessible && !isOffline}
                                  onClick={() => void handlePlayLesson(lesson)}
                                  title={
                                    isOffline
                                      ? 'پخش آفلاین'
                                      : !isWatched && positionSeconds > 5
                                      ? `ادامه از ${formatDuration(Math.floor(positionSeconds))}`
                                      : 'پخش آنلاین'
                                  }
                                  aria-label={`پخش درس ${lesson.title}`}
                                >
                                  {isOffline ? (
                                    <HardDrive size={14} color="var(--color-success)" aria-hidden="true" />
                                  ) : (
                                    <Play size={14} color="var(--color-accent)" aria-hidden="true" />
                                  )}
                                </button>

                                {/* DISTINCT Download Button */}
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm btn-icon"
                                  disabled={!lesson.accessible || isOffline || isDownloading}
                                  onClick={() => void handleOpenDownloadQuality(lesson)}
                                  title={
                                    isOffline
                                      ? 'دانلود شده است'
                                      : isDownloading
                                      ? 'در حال دانلود است'
                                      : 'دانلود تکی این درس'
                                  }
                                  aria-label={`دانلود درس ${lesson.title}`}
                                >
                                  {isOffline ? (
                                    <CheckCircle2 size={16} color="var(--color-success)" aria-hidden="true" />
                                  ) : (
                                    <Download size={16} aria-hidden="true" />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quality Picker Modal */}
      {modalLesson && (
        <QualitySelectorModal
          key={modalLesson.id}
          isOpen={modalOpen}
          onClose={handleCloseQualityModal}
          lesson={modalLesson}
          qualities={modalQualities}
          loading={modalLoading}
          error={modalError}
          onConfirm={handleConfirmQuality}
        />
      )}
    </div>
  );
};

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  SessionState,
  Course,
  Chapter,
  Download,
  Settings,
  LoginCredentials,
} from '@shared/types';
import { api, ApiClientError } from './api/client';
import { Navbar } from './components/Navbar';
import { DemoBanner } from './components/DemoBanner';
import { CourseLibrary } from './components/CourseLibrary';
import { CourseDetail, type InitialOfflinePlayback } from './components/CourseDetail';
import { DownloadsView } from './components/DownloadsView';
import { AccountModal } from './components/AccountModal';
import { SettingsModal } from './components/SettingsModal';
import { ImportCourseModal } from './components/ImportCourseModal';
import { useStudyPreferences } from './utils/studyPreferences';
import { useStudyProgress, type LessonProgress } from './utils/studyProgress';

export const App: React.FC = () => {
  // Study preferences (theme, density, playback rate, quality preference)
  const { preferences, updatePreferences, effectiveTheme } = useStudyPreferences();

  const handleToggleTheme = () => {
    updatePreferences({
      theme: effectiveTheme === 'dark' ? 'light' : 'dark',
    });
  };

  // Session state
  const [session, setSession] = useState<SessionState>({
    authenticated: false,
    demo: false,
  });
  const [sessionFetched, setSessionFetched] = useState(false);

  // Isolated study progress table for demo vs real (gated to null until session fetched)
  const progressScope = !sessionFetched ? null : session.demo ? 'demo' : 'real';
  const { progress, recordProgress } = useStudyProgress(progressScope);

  // Navigation tab
  const [currentTab, setCurrentTab] = useState<'courses' | 'downloads'>('courses');

  // Courses state
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [courseWarning, setCourseWarning] = useState<string | undefined>(undefined);

  // Selected course for detail view
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [courseChapters, setCourseChapters] = useState<Chapter[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [initialPlayback, setInitialPlayback] = useState<InitialOfflinePlayback | null>(null);
  const [initialResume, setInitialResume] = useState<LessonProgress | null>(null);

  // Request identity refs to guard async race conditions
  const courseRequestIdRef = useRef(0);
  const selectedCourseRef = useRef<Course | null>(null);
  selectedCourseRef.current = selectedCourse;

  // Downloads state
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [downloadsLoading, setDownloadsLoading] = useState(false);

  // Settings state
  const [settings, setSettings] = useState<Settings>({ downloadDirectory: '' });

  // Modals state
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Global notification/error
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Active polling timer ref
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Unified API error handler with session expiration detection
  const handleApiError = useCallback((err: unknown, defaultMessage: string) => {
    if (err instanceof ApiClientError) {
      if (
        err.status === 401 ||
        err.code === 'UNAUTHENTICATED' ||
        err.code === 'EXPIRED_SESSION' ||
        err.code === 'SESSION_EXPIRED'
      ) {
        // Update session state without clearing offline library or cached courses, keeping session.demo
        setSession((prev) => ({ authenticated: false, demo: prev.demo }));
      }
      setGlobalError(err.message);
    } else if (err instanceof Error) {
      setGlobalError(err.message);
    } else {
      setGlobalError(defaultMessage);
    }
  }, []);

  // Load session
  const loadSession = useCallback(async () => {
    try {
      const s = await api.getSession();
      setSession(s);
    } catch (err: unknown) {
      console.warn('Failed to load session:', err);
    } finally {
      setSessionFetched(true);
    }
  }, []);

  // Load courses
  const loadCourses = useCallback(async () => {
    setCoursesLoading(true);
    setCourseWarning(undefined);
    try {
      const res = await api.getCourses();
      setCourses(res.courses || []);
      setCourseWarning(res.warning);
    } catch (err: unknown) {
      handleApiError(err, 'خطا در بارگذاری دوره‌ها');
    } finally {
      setCoursesLoading(false);
    }
  }, [handleApiError]);

  // Refresh courses from server (preserves existing list on failure)
  const handleRefreshCourses = async () => {
    setCoursesLoading(true);
    setCourseWarning(undefined);
    try {
      const res = await api.refreshCourses();
      setCourses(res.courses || []);
      setCourseWarning(res.warning);
    } catch (err: unknown) {
      handleApiError(err, 'خطا در بروزرسانی دوره‌ها');
    } finally {
      setCoursesLoading(false);
    }
  };

  // Load downloads
  const loadDownloads = useCallback(async () => {
    setDownloadsLoading(true);
    try {
      const res = await api.getDownloads();
      setDownloads(res.downloads || []);
    } catch (err: unknown) {
      console.warn('Failed to load downloads:', err);
    } finally {
      setDownloadsLoading(false);
    }
  }, []);

  // Load settings
  const loadSettings = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
    } catch (err: unknown) {
      console.warn('Failed to load settings:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const initApp = async () => {
      await api.init();
      await Promise.all([loadSession(), loadCourses(), loadDownloads(), loadSettings()]);
    };
    initApp();
  }, [loadSession, loadCourses, loadDownloads, loadSettings]);

  // Download polling: Poll only when active jobs exist
  const activeDownloads = downloads.filter(
    (d) => d.status === 'downloading' || d.status === 'queued'
  );

  useEffect(() => {
    if (activeDownloads.length > 0) {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(async () => {
          await loadDownloads();
          // If we also have an open course detail, update its chapters' download status safely
          if (selectedCourseRef.current) {
            const currentCourseId = selectedCourseRef.current.id;
            try {
              const detail = await api.getCourseDetail(currentCourseId);
              // Ensure course hasn't switched during background fetch
              if (selectedCourseRef.current?.id === currentCourseId) {
                setCourseChapters(detail.chapters || []);
              }
            } catch {
              // Ignore background update errors
            }
          }
        }, 1500);
      }
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activeDownloads.length, loadDownloads]);

  // Select course and fetch detail with request identity protection
  const handleSelectCourse = async (course: Course) => {
    const requestId = ++courseRequestIdRef.current;
    setSelectedCourse(course);
    selectedCourseRef.current = course;
    setDetailLoading(true);
    setCourseChapters([]);

    try {
      const res = await api.getCourseDetail(course.id);
      if (requestId === courseRequestIdRef.current) {
        setCourseChapters(res.chapters || []);
      }
    } catch (err: unknown) {
      if (requestId === courseRequestIdRef.current) {
        handleApiError(err, 'خطا در بارگذاری سرفصل‌های دوره');
      }
    } finally {
      if (requestId === courseRequestIdRef.current) {
        setDetailLoading(false);
      }
    }
  };

  // Back to courses list (invalidates pending in-flight requests)
  const handleBackToCourses = () => {
    courseRequestIdRef.current++;
    setSelectedCourse(null);
    selectedCourseRef.current = null;
    setInitialPlayback(null);
    setInitialResume(null);
    setCourseChapters([]);
    loadCourses(); // refresh counts
  };

  // Enqueue download for a lesson
  const handleEnqueueDownload = async (courseId: string, lessonId: string, quality: string) => {
    await api.enqueueDownload(courseId, lessonId, quality);
    await loadDownloads();
    // Update active chapters safely
    if (selectedCourseRef.current?.id === courseId) {
      const res = await api.getCourseDetail(courseId);
      if (selectedCourseRef.current?.id === courseId) {
        setCourseChapters(res.chapters || []);
      }
    }
  };

  // Download controls with error display
  const handlePauseDownload = async (id: string) => {
    try {
      await api.pauseDownload(id);
      await loadDownloads();
    } catch (err: unknown) {
      handleApiError(err, 'خطا در متوقف‌سازی دانلود');
    }
  };

  const handleResumeDownload = async (id: string) => {
    try {
      await api.resumeDownload(id);
      await loadDownloads();
    } catch (err: unknown) {
      handleApiError(err, 'خطا در ادامه دانلود');
    }
  };

  const handleCancelDownload = async (id: string) => {
    try {
      await api.cancelDownload(id);
      await loadDownloads();
      if (selectedCourseRef.current) {
        const res = await api.getCourseDetail(selectedCourseRef.current.id);
        if (selectedCourseRef.current) {
          setCourseChapters(res.chapters || []);
        }
      }
    } catch (err: unknown) {
      handleApiError(err, 'خطا در لغو دانلود');
    }
  };

  // Play offline from downloads table - wires requested video directly without online qualities
  const handlePlayOffline = async (downloadItem: Download) => {
    let course = courses.find((c) => c.id === downloadItem.courseId);
    if (!course) {
      course = {
        id: downloadItem.courseId,
        title: downloadItem.courseTitle,
        slug: downloadItem.courseId,
      };
    }

    setInitialResume(null);
    setInitialPlayback({
      downloadId: downloadItem.id,
      lessonId: downloadItem.lessonId,
      lessonTitle: downloadItem.lessonTitle,
      quality: downloadItem.quality,
    });

    setCurrentTab('courses');
    await handleSelectCourse(course);
  };

  // Account login
  const handleLogin = async (credentials: LoginCredentials) => {
    const s = await api.login(credentials);
    setSession(s);
    await Promise.all([loadCourses(), loadDownloads()]);
  };

  // Account logout
  const handleLogout = async () => {
    await api.logout();
    setSession((prev) => ({ authenticated: false, demo: prev.demo }));
    await loadCourses();
  };

  // Save settings directory
  const handleSaveSettings = async (downloadDirectory: string) => {
    const s = await api.updateSettings(downloadDirectory);
    setSettings(s);
  };

  // Import course by URL
  const handleImportCourse = async (url: string) => {
    const res = await api.importCourse(url);
    await loadCourses();
    await handleSelectCourse(res.course);
  };

  return (
    <div className="app-container" dir="rtl">
      {/* Sticky Right-side Navbar */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (tab !== currentTab) {
            handleBackToCourses();
            setCurrentTab(tab);
          }
        }}
        session={session}
        onOpenAccount={() => setAccountModalOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
        theme={effectiveTheme}
        onToggleTheme={handleToggleTheme}
        activeDownloadsCount={activeDownloads.length}
      />

      {/* Main Content Area */}
      <main className="app-main">
        {/* Labeled Demo Banner */}
        {session.demo && <DemoBanner isDemo={session.demo} />}

        {/* Global Error Banner */}
        {globalError && (
          <div className="error-banner" style={{ marginBottom: 'var(--space-4)' }} role="alert">
            <span>{globalError}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setGlobalError(null)}
              style={{ marginInlineStart: 'auto' }}
            >
              بستن
            </button>
          </div>
        )}

        {/* Render Tab Content */}
        {currentTab === 'downloads' ? (
          <DownloadsView
            downloads={downloads}
            loading={downloadsLoading}
            onPause={handlePauseDownload}
            onResume={handleResumeDownload}
            onCancel={handleCancelDownload}
            onPlayOffline={handlePlayOffline}
          />
        ) : selectedCourse ? (
          <CourseDetail
            course={selectedCourse}
            chapters={courseChapters}
            loading={detailLoading}
            initialPlayback={initialPlayback}
            onBack={handleBackToCourses}
            onEnqueueDownload={handleEnqueueDownload}
            progress={progress}
            onProgress={recordProgress}
            initialResume={initialResume}
            preferredQuality={preferences.preferredQuality}
            playbackRate={preferences.playbackRate}
          />
        ) : (
          <CourseLibrary
            courses={courses}
            loading={coursesLoading}
            warning={session.demo ? undefined : courseWarning}
            progress={progress}
            onSelectCourse={(course) => {
              setInitialPlayback(null);
              setInitialResume(null);
              handleSelectCourse(course);
            }}
            onResumeLesson={(course, resumeRecord) => {
              setInitialPlayback(null);
              setInitialResume(resumeRecord);
              handleSelectCourse(course);
            }}
            onRefresh={handleRefreshCourses}
            onOpenImport={() => setImportModalOpen(true)}
          />
        )}
      </main>

      {/* Modals */}
      <AccountModal
        isOpen={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        session={session}
        onLogin={handleLogin}
        onLogout={handleLogout}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={settings}
        preferences={preferences}
        onSave={handleSaveSettings}
        onUpdatePreferences={updatePreferences}
      />

      <ImportCourseModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportCourse}
      />
    </div>
  );
};

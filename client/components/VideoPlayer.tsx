import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Film, HardDrive, Wifi, AlertTriangle } from 'lucide-react';
import type { Lesson, Course } from '@shared/types';
import type { ProgressUpdate } from '../utils/studyProgress';
import {
  Video,
  VideoPlayer as VideojsPlayer,
  NeutralVideoSkin,
} from '@videojs/react/video';
import '@videojs/react/video/neutral-skin.css';
import { I18nProvider } from '@videojs/react/i18n';
import '@videojs/react/i18n/locales/fa/register';

interface VideoPlayerProps {
  course: Course;
  lesson: Lesson | null;
  videoSrc: string | null;
  isOfflineSource: boolean;
  activeQuality?: string;
  errorMessage?: string | null;
  onError?: (message: string) => void;
  resumeSeconds?: number;
  defaultPlaybackRate?: number;
  onProgress?: (update: ProgressUpdate) => void;
}

const SPEED_OPTIONS: number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  course,
  lesson,
  videoSrc,
  isOfflineSource,
  activeQuality,
  errorMessage,
  onError,
  resumeSeconds,
  defaultPlaybackRate = 1,
  onProgress,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    return typeof defaultPlaybackRate === 'number' && Number.isFinite(defaultPlaybackRate) && defaultPlaybackRate > 0
      ? defaultPlaybackRate
      : 1;
  });

  // Track the source for which initial seek / speed setup has already occurred
  const initializedSrcRef = useRef<string | null>(null);

  // Throttled timeupdate tracker (every 3s)
  const lastTimeUpdateRef = useRef<number>(0);

  // Keep reference to latest onProgress callback
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // Sync internal playbackRate state when defaultPlaybackRate prop changes
  useEffect(() => {
    if (
      typeof defaultPlaybackRate === 'number' &&
      Number.isFinite(defaultPlaybackRate) &&
      defaultPlaybackRate > 0
    ) {
      setPlaybackRate(defaultPlaybackRate);
      if (videoRef.current) {
        try {
          videoRef.current.playbackRate = defaultPlaybackRate;
        } catch (err) {
          console.debug('Failed to update playback rate:', err);
        }
      }
    }
  }, [defaultPlaybackRate]);

  /**
   * Save actual position and duration.
   * Strictly enforces:
   * 1. No read/write for empty player (missing videoSrc or lesson)
   * 2. No writing to new lesson from stale video events
   */
  const saveProgress = useCallback(
    (video: HTMLVideoElement | null, extra?: { completed?: boolean }) => {
      // Guard: do not read/write progress for empty player
      if (!video || !videoSrc || !lesson || !onProgress) {
        return;
      }

      // Guard: verify the event originates from the active lesson and video source
      const eventLessonId = video.getAttribute('data-lesson-id');
      const eventSrc = video.getAttribute('data-src');
      if (eventLessonId !== lesson.id || eventSrc !== videoSrc) {
        return;
      }

      if (video.readyState < 1 && !Number.isFinite(video.duration)) {
        return;
      }

      const position = video.currentTime;
      if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
        return;
      }

      const duration =
        typeof video.duration === 'number' && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : undefined;

      const isCompleted = video.ended || extra?.completed === true;

      onProgress({
        position,
        duration,
        ...(isCompleted ? { completed: true } : {}),
      });
    },
    [videoSrc, lesson, onProgress]
  );

  // Video event handlers for saving progress
  const handlePause = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    saveProgress(e.currentTarget);
  };

  const handleSeeked = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    saveProgress(e.currentTarget);
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const now = Date.now();
    if (now - lastTimeUpdateRef.current >= 3000) {
      lastTimeUpdateRef.current = now;
      saveProgress(e.currentTarget);
    }
  };

  const handleEnded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    saveProgress(e.currentTarget, { completed: true });
  };

  // Capture valid speed changes from the underlying Video onRateChange
  const handleRateChange = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const target = e.currentTarget;
    if (target && typeof target.playbackRate === 'number' && target.playbackRate > 0) {
      setPlaybackRate(target.playbackRate);
    }
  };

  /**
   * After an explicitly selected source is mounted:
   * Seek on loadedmetadata to saved time if valid, set default speed, and play with controls fallback.
   */
  const initPlayback = useCallback(
    (video: HTMLVideoElement) => {
      if (!videoSrc || !lesson) return;

      // Ensure initialization runs once per mounted source
      if (initializedSrcRef.current === videoSrc) return;
      initializedSrcRef.current = videoSrc;

      // 1. Seek to saved time if valid
      if (
        typeof resumeSeconds === 'number' &&
        Number.isFinite(resumeSeconds) &&
        resumeSeconds > 0 &&
        (!Number.isFinite(video.duration) || resumeSeconds < video.duration)
      ) {
        try {
          video.currentTime = resumeSeconds;
        } catch (err) {
          console.debug('Failed to seek to resumeSeconds:', err);
        }
      }

      // 2. Set default / configured speed
      const effectiveRate = playbackRate || defaultPlaybackRate || 1;
      try {
        video.playbackRate = effectiveRate;
      } catch (err) {
        console.debug('Failed to set playback rate:', err);
      }

      // 3. Play with controls fallback
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err: unknown) => {
          console.debug('Playback auto-start deferred or prevented:', err);
        });
      }
    },
    [videoSrc, lesson, resumeSeconds, playbackRate, defaultPlaybackRate]
  );

  const initPlaybackRef = useRef(initPlayback);
  initPlaybackRef.current = initPlayback;

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    initPlayback(e.currentTarget);
  };

  /**
   * Capture the video element and source's progress callback keyed by source/lesson.
   * Flushes captured element on pagehide/cleanup if metadata is valid.
   * Resets timeupdate throttle per source.
   */
  useEffect(() => {
    // Reset timeupdate throttle per source
    lastTimeUpdateRef.current = 0;

    if (!videoSrc || !lesson) return;

    // Capture the video DOM element and this source's progress callback
    const video = videoRef.current;
    const capturedProgress = onProgressRef.current;

    const flush = () => {
      if (!video || !capturedProgress) return;
      if (video.readyState < 1 && !Number.isFinite(video.duration)) {
        return;
      }

      const position = video.currentTime;
      if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
        return;
      }

      const duration =
        typeof video.duration === 'number' && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : undefined;

      capturedProgress({
        position,
        duration,
        ...(video.ended ? { completed: true } : {}),
      });
    };

    // If video metadata is already ready upon mount (e.g. cached source)
    if (video && video.readyState >= 1) {
      initPlaybackRef.current(video);
    }

    window.addEventListener('pagehide', flush);

    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [videoSrc, lesson?.id]);

  // Scoped keyboard shortcuts J / K / L on focusable player region
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ignore modifier combinations (e.g. Ctrl+L address bar, Ctrl+J downloads)
    if (e.ctrlKey || e.altKey || e.metaKey) {
      return;
    }

    // Do not interfere if empty player or video element missing
    if (!videoRef.current || !videoSrc || !lesson) {
      return;
    }

    // Do not interfere with native controls or form fields (input, textarea, select, contentEditable)
    const target = e.target as HTMLElement | null;
    if (target) {
      const tagName = target.tagName ? target.tagName.toLowerCase() : '';
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target.isContentEditable
      ) {
        return;
      }
    }

    const key = e.key ? e.key.toLowerCase() : '';
    const code = e.code;
    const video = videoRef.current;

    if (key === 'j' || code === 'KeyJ') {
      e.preventDefault();
      const cur = video.currentTime;
      video.currentTime = Math.max(0, cur - 10);
    } else if (key === 'k' || code === 'KeyK') {
      e.preventDefault();
      if (video.paused) {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.catch((err: unknown) => {
            console.debug('Playback resume deferred or prevented:', err);
          });
        }
      } else {
        video.pause();
      }
    } else if (key === 'l' || code === 'KeyL') {
      e.preventDefault();
      const cur = video.currentTime;
      const dur = video.duration;
      const targetTime = cur + 10;
      video.currentTime = Number.isFinite(dur) && dur > 0 ? Math.min(dur, targetTime) : targetTime;
    }
  };

  return (
    <div
      className="player-panel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={`پخش‌کننده ویدیو: ${lesson?.title || course.title}`}
      style={{ outline: 'none' }}
    >
      <div className="video-wrapper">
        {videoSrc ? (
          <I18nProvider locale="fa">
            <VideojsPlayer
              key={videoSrc}
              defaultPlaybackRates={SPEED_OPTIONS}
            >
              <NeutralVideoSkin className="study-video-skin">
                <Video
                  ref={videoRef}
                  key={videoSrc}
                  src={videoSrc}
                  data-lesson-id={lesson?.id}
                  data-src={videoSrc}
                  className="native-video-player"
                  preload="auto"
                  playsInline
                  onLoadedMetadata={handleLoadedMetadata}
                  onPause={handlePause}
                  onSeeked={handleSeeked}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={handleEnded}
                  onRateChange={handleRateChange}
                  onError={() => {
                    onError?.('پخش ویدیو با خطا مواجه شد. لطفاً کیفیت دیگری را انتخاب کنید یا ارتباط اینترنتی را بررسی نمایید.');
                  }}
                  aria-label={`پخش ویدیو: ${lesson?.title || course.title}`}
                >
                  مرورگر شما از پخش مستقیم ویدیو پشتیبانی نمی‌کند.
                </Video>
              </NeutralVideoSkin>
            </VideojsPlayer>
          </I18nProvider>
        ) : (
          <div className="player-placeholder">
            <Film size={48} strokeWidth={1.5} color="#9ca3af" aria-hidden="true" />
            <div className="placeholder-title" style={{ fontWeight: 600, fontSize: '1rem', color: '#f9fafb' }}>
              {lesson ? 'کیفیت مورد نظر را برای پخش انتخاب کنید' : 'یک درس را برای مشاهده انتخاب کنید'}
            </div>
            <p style={{ fontSize: '0.82rem', maxWidth: 360, color: '#9ca3af' }}>
              {lesson
                ? 'با کلیک روی دکمه «پخش» در ردیف درس، می‌توانید کیفیت استریم یا فایل آفلاین را انتخاب نمایید.'
                : 'برای شروع پخش، از فهرست فصل‌ها در سمت چپ درس مورد نظرتان را انتخاب کنید.'}
            </p>
          </div>
        )}
      </div>

      {videoSrc && (
        <div
          className="study-player-tools"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {/* Shortcuts Hint */}
          <div
            className="player-shortcuts-hint"
            aria-label="راهنمای کلیدهای میانبر: J عقب ۱۰ ثانیه، K پخش یا توقف، L جلو ۱۰ ثانیه"
            title="کلیدهای میانبر: J عقب ۱۰ ثانیه، K پخش یا توقف، L جلو ۱۰ ثانیه"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              direction: 'rtl',
            }}
          >
            <span>کلیدهای میانبر:</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', direction: 'ltr' }}>
              <kbd
                style={{
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}
              >
                J
              </kbd>
              <span>-10s</span>
              <kbd
                style={{
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}
              >
                K
              </kbd>
              <span>پخش/مکث</span>
              <kbd
                style={{
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}
              >
                L
              </kbd>
              <span>+10s</span>
            </span>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {lesson && (
        <div className="player-meta">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              {course.title}
            </div>
            <h2 style={{ fontSize: '1.05rem', margin: '2px 0 0' }} title={lesson.title}>
              {lesson.title}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {activeQuality && (
              <span className="lesson-badge-pill" style={{ backgroundColor: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)' }}>
                کیفیت: <span className="tabular-num">{activeQuality}</span>
              </span>
            )}

            {isOfflineSource ? (
              <span className="lesson-badge-pill badge-offline">
                <HardDrive size={13} aria-hidden="true" />
                <span>پخش از حافظه دستگاه (آفلاین)</span>
              </span>
            ) : videoSrc ? (
              <span className="lesson-badge-pill badge-online">
                <Wifi size={13} aria-hidden="true" />
                <span>پخش برخط (استریم)</span>
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { Download, Pause, Play, X, HardDrive, Loader2, CheckCircle2, Database, Clock } from 'lucide-react';
import type { Download as DownloadItem } from '@shared/types';
import { formatBytes, formatQualityLabel, getDownloadStatusLabel } from '../utils/format';

interface DownloadsViewProps {
  downloads: DownloadItem[];
  loading: boolean;
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onPlayOffline: (download: DownloadItem) => void;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  downloads,
  loading,
  onPause,
  onResume,
  onCancel,
  onPlayOffline,
}) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const visibleDownloads = downloads.filter(item =>
    (status === 'all' || item.status === status) &&
    (item.courseTitle + ' ' + item.lessonTitle).toLocaleLowerCase('fa').includes(query.trim().toLocaleLowerCase('fa'))
  );
  const { totalCount, downloadingCount, completedCount, totalDownloadedBytes } = useMemo(() => {
    let dl = 0;
    let comp = 0;
    let bytes = 0;
    for (const item of downloads) {
      if (item.status === 'downloading') dl++;
      if (item.status === 'completed') comp++;
      bytes += item.downloadedBytes || 0;
    }
    return {
      totalCount: downloads.length,
      downloadingCount: dl,
      completedCount: comp,
      totalDownloadedBytes: bytes,
    };
  }, [downloads]);

  return (
    <div className="downloads-panel">
      {/* Topbar */}
      <div className="page-topbar">
        <div>
          <h1 className="page-title">دانلودها و پخش آفلاین</h1>
          <p className="page-subtitle">
            مدیریت صف دریافت درس‌ها و دسترسی به ویدیوهای ذخیره‌شده در حافظه دستگاه
          </p>
        </div>
      </div>

      {/* Metrics Overview Strip */}
      {downloads.length > 0 && (
        <div className="downloads-metrics-grid">
          <div className="metric-card">
            <div className="metric-header">
              <Download size={15} aria-hidden="true" />
              <span>کل صف دانلود</span>
            </div>
            <div className="metric-value tabular-num">{totalCount}</div>
          </div>

          <div className="metric-card">
            <div className="metric-header">
              <Clock size={15} aria-hidden="true" />
              <span>در حال دریافت</span>
            </div>
            <div className="metric-value tabular-num">{downloadingCount}</div>
          </div>

          <div className="metric-card">
            <div className="metric-header">
              <CheckCircle2 size={15} color="var(--color-success)" aria-hidden="true" />
              <span>آماده پخش آفلاین</span>
            </div>
            <div className="metric-value tabular-num">{completedCount}</div>
          </div>

          <div className="metric-card">
            <div className="metric-header">
              <Database size={15} color="var(--color-accent)" aria-hidden="true" />
              <span>حجم ذخیره‌شده</span>
            </div>
            <div className="metric-value tabular-num">{formatBytes(totalDownloadedBytes)}</div>
          </div>
        </div>
      )}

      {downloads.length > 0 && <div className="library-controls" style={{ marginBottom: 20 }}>
        <input className="input-control" type="search" aria-label="جستجوی دانلودها" placeholder="جستجوی دوره یا درس دانلودشده…" value={query} onChange={event => setQuery(event.target.value)} />
        <select aria-label="فیلتر وضعیت دانلود" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="all">همه دانلودها</option><option value="completed">آماده پخش</option><option value="downloading">در حال دریافت</option><option value="queued">در صف</option><option value="paused">متوقف‌شده</option><option value="failed">ناموفق</option>
        </select>
      </div>}
      {downloads.length > 0 && visibleDownloads.length === 0 && <p role="status">دانلودی با این جستجو و فیلتر پیدا نشد.</p>}
      {loading && downloads.length === 0 ? (
        <div className="state-box">
          <Loader2 size={32} className="spinning" color="var(--color-accent)" aria-hidden="true" />
          <div className="state-title">در حال بارگذاری فهرست دانلودها...</div>
        </div>
      ) : downloads.length === 0 ? (
        <div className="state-box">
          <Download className="state-icon" aria-hidden="true" />
          <div className="state-title">صف دانلود خالی است</div>
          <p style={{ maxWidth: 420, fontSize: '0.86rem' }}>
            هیچ درسی برای دانلود انتخاب نشده است. با ورود به هر دوره می‌توانید درس‌های مورد نظر خود را برای استفاده در حالت آفلاین ذخیره کنید.
          </p>
        </div>
      ) : (
        <div className="download-table-container">
          <table className="download-table" aria-label="فهرست دانلودها">
            <thead>
              <tr>
                <th scope="col">دوره و درس</th>
                <th scope="col">کیفیت</th>
                <th scope="col">وضعیت و پیشرفت</th>
                <th scope="col">حجم</th>
                <th scope="col" style={{ textAlign: 'center' }}>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {visibleDownloads.map((item) => {
                const isDownloading = item.status === 'downloading';
                const isPaused = item.status === 'paused';
                const isCompleted = item.status === 'completed';
                const isFailed = item.status === 'failed';
                const isQueued = item.status === 'queued';

                const hasKnownTotal = item.totalBytes !== undefined && item.totalBytes > 0;
                const percent = hasKnownTotal
                  ? Math.min(100, Math.round((item.downloadedBytes / (item.totalBytes as number)) * 100))
                  : null;

                return (
                  <tr key={item.id}>
                    {/* Course & Lesson */}
                    <td style={{ minWidth: 220 }}>
                      <div className="download-lesson-title">{item.lessonTitle}</div>
                      <div className="download-course-title">
                        {item.courseTitle}
                      </div>
                    </td>

                    {/* Quality */}
                    <td>
                      <span className="tabular-num quality-pill">
                        {formatQualityLabel(undefined, item.quality)}
                      </span>
                    </td>

                    {/* Status & Progress */}
                    <td style={{ minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span
                          className="download-status-badge"
                          style={{
                            color: isCompleted
                              ? 'var(--color-success)'
                              : isFailed
                              ? 'var(--color-danger)'
                              : isPaused
                              ? 'var(--color-warning)'
                              : 'var(--color-text-secondary)',
                          }}
                        >
                          {getDownloadStatusLabel(item.status)}
                        </span>
                        {percent !== null && isDownloading && (
                          <span className="tabular-num download-percent-text">
                            {percent}%
                          </span>
                        )}
                      </div>

                      {/* Progress track */}
                      {(isDownloading || isPaused) && (
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{
                              width: percent !== null ? `${percent}%` : '40%',
                              backgroundColor: isPaused ? 'var(--color-warning)' : 'var(--color-accent)',
                            }}
                          />
                        </div>
                      )}

                      {/* Error details if failed */}
                      {isFailed && item.error && (
                        <div className="download-error-text">
                          {item.error}
                        </div>
                      )}
                    </td>

                    {/* Bytes */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="tabular-num" style={{ fontSize: '0.85rem' }}>
                        {formatBytes(item.downloadedBytes)}
                      </span>
                      {hasKnownTotal && (
                        <span className="tabular-num" style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                          {' / '}
                          {formatBytes(item.totalBytes)}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1-5)' }}>
                        {/* Play Offline button for completed downloads */}
                        {isCompleted && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onPlayOffline(item)}
                            title="پخش آفلاین ویدیو"
                            aria-label={`پخش آفلاین ${item.lessonTitle}`}
                          >
                            <HardDrive size={14} color="var(--color-success)" aria-hidden="true" />
                            <span>پخش آفلاین</span>
                          </button>
                        )}

                        {/* Pause button */}
                        {isDownloading && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-icon"
                            onClick={() => onPause(item.id)}
                            title="توقف موقت دانلود"
                            aria-label="توقف موقت دانلود"
                          >
                            <Pause size={15} aria-hidden="true" />
                          </button>
                        )}

                        {/* Resume button */}
                        {(isPaused || isFailed) && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-icon"
                            onClick={() => onResume(item.id)}
                            title="ادامه دانلود"
                            aria-label="ادامه دانلود"
                          >
                            <Play size={15} color="var(--color-accent)" aria-hidden="true" />
                          </button>
                        )}

                        {/* Cancel button */}
                        {(isDownloading || isPaused || isQueued) && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => onCancel(item.id)}
                            title="لغو دریافت"
                            aria-label="لغو دریافت"
                          >
                            <X size={15} color="var(--color-danger)" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

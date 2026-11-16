import React from 'react';
import { Download, Pause, Play, X, HardDrive, Loader2 } from 'lucide-react';
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
  return (
    <div className="downloads-panel">
      <div className="page-topbar">
        <div>
          <h1 style={{ fontSize: '1.4rem', marginBottom: 'var(--space-1)' }}>دانلودها و پخش آفلاین</h1>
          <p style={{ fontSize: '0.88rem' }}>
            مدیریت صف دریافت درس‌ها و دسترسی به ویدیوهای ذخیره‌شده در حافظه دستگاه
          </p>
        </div>
      </div>

      {loading && downloads.length === 0 ? (
        <div className="state-box">
          <Loader2 size={36} className="spinning" color="var(--color-accent)" aria-hidden="true" />
          <div className="state-title">در حال بارگذاری فهرست دانلودها...</div>
        </div>
      ) : downloads.length === 0 ? (
        <div className="state-box">
          <Download className="state-icon" aria-hidden="true" />
          <div className="state-title">صف دانلود خالی است</div>
          <p style={{ maxWidth: 420, fontSize: '0.88rem' }}>
            هیچ درسی برای دانلود انتخاب نشده است. با ورود به هر دوره می‌توانید درس‌های مورد نظر خود را برای استفاده در حالت آفلاین ذخیره کنید.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
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
              {downloads.map((item) => {
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
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{item.lessonTitle}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                        {item.courseTitle}
                      </div>
                    </td>

                    {/* Quality */}
                    <td>
                      <span className="tabular-num" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        {formatQualityLabel(undefined, item.quality)}
                      </span>
                    </td>

                    {/* Status & Progress */}
                    <td style={{ minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 500,
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
                          <span className="tabular-num" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {percent}%
                          </span>
                        )}
                      </div>

                      {/* Progress track if downloading or paused with partial progress */}
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
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: 4 }}>
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
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
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

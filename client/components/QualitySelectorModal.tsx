import React, { useState, useEffect } from 'react';
import { X, Play, Download, Film, AlertCircle, Loader2 } from 'lucide-react';
import type { Quality, Lesson } from '@shared/types';
import { formatBytes, formatQualityLabel } from '../utils/format';
import { useModalFocus } from '../utils/useModal';

interface QualitySelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  lesson: Lesson;
  mode: 'play' | 'download';
  qualities: Quality[];
  loading: boolean;
  error?: string | null;
  onConfirm: (qualityId: string) => void;
  preferredQuality?: 'ask' | 'low' | 'high';
}

/**
 * Extracts a numeric resolution rank from a quality option.
 * Recognizes labels like '480p', '480 (mp4)', '720', '1080p', as well as HQ/HD (720) and LQ/SD (360).
 * Returns null if the quality uses an opaque ID or lacks resolution indicators.
 */
function extractResolutionRank(q: Quality): number | null {
  const combined = `${q.label || ''} ${q.id || ''}`;

  // Match resolution digits with optional 'p' or format suffix (e.g. '480p', '480 (mp4)', '720', '1080p')
  const resMatch = combined.match(/\b(240|360|480|540|720|1080|1440|2160)(?:p|\s*\([^)]*\))?\b/i);
  if (resMatch) {
    return parseInt(resMatch[1], 10);
  }

  // Recognize qualitative tokens
  if (/\b(hq|hd)\b/i.test(combined)) return 720;
  if (/\b(lq|sd)\b/i.test(combined)) return 360;

  return null;
}

/**
 * Preselects a quality based on user preferences without mixing resolution numbers and byte sizes.
 * 1. Uses resolution/HQ-LQ ranking ONLY if all options have detectable resolution.
 * 2. Otherwise uses file sizes ONLY if every option has positive numeric bytes.
 * 3. Falls back safely to default first item for opaque IDs or mixed/incomplete metadata.
 * Only applies to 'play' mode, never affects download selection.
 */
function determineInitialQuality(
  qualities: Quality[],
  preferredQuality: 'ask' | 'low' | 'high' | undefined,
  mode: 'play' | 'download'
): string {
  if (qualities.length === 0) return '';
  if (mode !== 'play' || !preferredQuality || preferredQuality === 'ask') {
    return qualities[0].id;
  }

  // Strategy 1: Compare by resolution/HQ-LQ if ALL options have resolution rank
  const resRanks = qualities.map((q) => extractResolutionRank(q));
  const allHaveResolution = resRanks.every((rank): rank is number => rank !== null);

  if (allHaveResolution) {
    const paired = qualities.map((q, i) => ({ q, rank: resRanks[i] as number }));
    const sorted = [...paired].sort((a, b) => a.rank - b.rank);
    return preferredQuality === 'low' ? sorted[0].q.id : sorted[sorted.length - 1].q.id;
  }

  // Strategy 2: If not all have resolution, compare file sizes ONLY if EVERY option has valid bytes
  const allHaveBytes = qualities.every(
    (q) => typeof q.bytes === 'number' && Number.isFinite(q.bytes) && q.bytes > 0
  );

  if (allHaveBytes) {
    const sortedByBytes = [...qualities].sort((a, b) => (a.bytes as number) - (b.bytes as number));
    return preferredQuality === 'low'
      ? sortedByBytes[0].id
      : sortedByBytes[sortedByBytes.length - 1].id;
  }

  // Fallback: Safe first option, avoiding misleading sort on opaque IDs or mixed data
  return qualities[0].id;
}

export const QualitySelectorModal: React.FC<QualitySelectorModalProps> = ({
  isOpen,
  onClose,
  lesson,
  mode,
  qualities,
  loading,
  error,
  onConfirm,
  preferredQuality,
}) => {
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const modalRef = useModalFocus(isOpen, onClose);

  // Reset or preselect quality when modal opens or qualities arrive
  useEffect(() => {
    if (isOpen && qualities.length > 0) {
      const initial = determineInitialQuality(qualities, preferredQuality, mode);
      setSelectedQuality(initial || qualities[0].id);
    } else if (isOpen) {
      setSelectedQuality('');
    }
  }, [isOpen, lesson.id, qualities, preferredQuality, mode]);

  if (!isOpen) return null;

  const currentSelected =
    selectedQuality || (qualities.length > 0 ? qualities[0].id : '');

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="quality-modal-title">
      <div ref={modalRef} className="modal-card">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {mode === 'play' ? (
              <Play size={20} color="var(--color-accent)" aria-hidden="true" />
            ) : (
              <Download size={20} color="var(--color-accent)" aria-hidden="true" />
            )}
            <h3 id="quality-modal-title" className="modal-title">
              {mode === 'play' ? 'انتخاب کیفیت برای پخش' : 'انتخاب کیفیت برای دانلود'}
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onClose}
            aria-label="بستن پنجره"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div>
          <div style={{ fontSize: '0.84rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>
            عنوان درس:
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{lesson.title}</div>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="state-box" style={{ padding: 'var(--space-6)' }}>
            <Loader2 size={32} className="spinning" color="var(--color-accent)" aria-hidden="true" />
            <div style={{ fontSize: '0.9rem' }}>در حال دریافت کیفیت‌های قابل دسترس...</div>
          </div>
        ) : qualities.length === 0 ? (
          <div className="state-box" style={{ padding: 'var(--space-6)' }}>
            <Film className="state-icon" aria-hidden="true" />
            <div style={{ fontSize: '0.9rem' }}>کیفیتی برای این درس یافت نشد.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              کیفیت‌های موجود:
            </label>
            {qualities.map((q) => {
              const isChecked = currentSelected === q.id;
              const inputId = `quality-radio-${q.id}`;
              const displayLabel = formatQualityLabel(q.label, q.id);
              const hasBytes = typeof q.bytes === 'number' && q.bytes > 0;

              return (
                <label
                  key={q.id}
                  htmlFor={inputId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${isChecked ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    backgroundColor: isChecked ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <input
                      id={inputId}
                      type="radio"
                      name="quality"
                      value={q.id}
                      checked={isChecked}
                      aria-label={`انتخاب کیفیت ${displayLabel}`}
                      onChange={() => setSelectedQuality(q.id)}
                    />
                    <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{displayLabel}</span>
                  </div>

                  {mode === 'download' ? (
                    <span className="tabular-num" style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                      {hasBytes ? formatBytes(q.bytes) : 'حجم نامشخص'}
                    </span>
                  ) : hasBytes ? (
                    <span className="tabular-num" style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                      {formatBytes(q.bytes)}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            انصراف
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || qualities.length === 0 || !currentSelected}
            onClick={() => {
              if (currentSelected) onConfirm(currentSelected);
            }}
          >
            {mode === 'play' ? (
              <>
                <Play size={16} aria-hidden="true" />
                <span>شروع پخش</span>
              </>
            ) : (
              <>
                <Download size={16} aria-hidden="true" />
                <span>افزودن به صف دانلود</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

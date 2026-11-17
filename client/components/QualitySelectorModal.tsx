import React, { useState } from 'react';
import { X, Download, Film, AlertCircle, Loader2 } from 'lucide-react';
import type { Quality, Lesson } from '@shared/types';
import { formatBytes, formatQualityLabel } from '../utils/format';
import { useModalFocus } from '../utils/useModal';

interface QualitySelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  lesson: Lesson;
  qualities: Quality[];
  loading: boolean;
  error?: string | null;
  onConfirm: (qualityId: string) => void;
}

export const QualitySelectorModal: React.FC<QualitySelectorModalProps> = ({
  isOpen,
  onClose,
  lesson,
  qualities,
  loading,
  error,
  onConfirm,
}) => {
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const modalRef = useModalFocus(isOpen, onClose);

  if (!isOpen) return null;

  const currentSelected =
    qualities.find((quality) => quality.id === selectedQuality)?.id ?? qualities[0]?.id;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="quality-modal-title">
      <div ref={modalRef} className="modal-card">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Download size={20} color="var(--color-accent)" aria-hidden="true" />
            <h3 id="quality-modal-title" className="modal-title">
              انتخاب کیفیت برای دانلود
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

                  <span className="tabular-num" style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    {hasBytes ? formatBytes(q.bytes) : 'حجم نامشخص'}
                  </span>
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
            <Download size={16} aria-hidden="true" />
            <span>افزودن به صف دانلود</span>
          </button>
        </div>
      </div>
    </div>
  );
};

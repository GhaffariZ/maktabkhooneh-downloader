import React, { useState } from 'react';
import { X, Plus, Link, AlertCircle, Loader2 } from 'lucide-react';
import { useModalFocus } from '../utils/useModal';

interface ImportCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (url: string) => Promise<void>;
}

export const ImportCourseModal: React.FC<ImportCourseModalProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modalRef = useModalFocus(isOpen, onClose);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('لطفاً آدرس اینترنتی دوره را وارد کنید');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onImport(url.trim());
      setUrl('');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطا در ثبت دوره از آدرس اینترنتی';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
      <div ref={modalRef} className="modal-card">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Link size={20} color="var(--color-accent)" aria-hidden="true" />
            <h3 id="import-modal-title" className="modal-title">
              افزودن دوره با پیوند اینترنتی
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

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <label
              htmlFor="import-course-url"
              style={{ display: 'block', fontSize: '0.88rem', marginBottom: 6, fontWeight: 500 }}
            >
              آدرس صفحه دوره در مکتب‌خونه:
            </label>
            <div className="input-group">
              <input
                id="import-course-url"
                name="courseUrl"
                type="url"
                className="input-control latin-text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://maktabkhooneh.org/course/..."
                required
                autoFocus
              />
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 6 }}>
              آدرس صفحه اصلی دوره یا یکی از جلسات آن را وارد کنید تا اطلاعات و سرفصل‌ها دریافت و ذخیره شود.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              انصراف
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <Loader2 size={16} className="spinning" aria-hidden="true" />
              ) : (
                <Plus size={16} aria-hidden="true" />
              )}
              <span>دریافت و افزودن دوره</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { X, User, LogIn, LogOut, AlertCircle, ShieldCheck, Loader2 } from 'lucide-react';
import type { SessionState, LoginCredentials } from '@shared/types';
import { useModalFocus } from '../utils/useModal';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: SessionState;
  onLogin: (credentials: LoginCredentials) => Promise<void>;
  onLogout: () => Promise<void>;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  session,
  onLogin,
  onLogout,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modalRef = useModalFocus(isOpen, onClose);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('لطفاً ایمیل و رمز عبور را وارد کنید');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onLogin({ email: email.trim(), password });
      setPassword(''); // Never keep password in component memory
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ورود با خطا مواجه شد';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    setError(null);
    try {
      await onLogout();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خروج با خطا مواجه شد';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
      <div ref={modalRef} className="modal-card">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <User size={20} color="var(--color-accent)" aria-hidden="true" />
            <h3 id="account-modal-title" className="modal-title">
              {session.authenticated ? 'مدیریت حساب کاربری' : 'ورود به حساب مکتب‌خونه'}
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

        {session.authenticated ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div
              style={{
                padding: 'var(--space-4)',
                backgroundColor: 'var(--color-surface-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <ShieldCheck size={18} color="var(--color-success)" aria-hidden="true" />
                <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>وضعیت اتصال: متصل</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                ایمیل کاربر: <strong className="latin-text">{session.email}</strong>
              </div>
              {session.demo && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-warning)', marginTop: 4 }}>
                  (حالت آزمایشی فعال است)
                </div>
              )}
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              با خروج از حساب کاربری، فایل‌های دانلودشده و کتابخانه محلی شما همچنان در دسترس خواهند بود.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
                انصراف
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleLogout}
                disabled={loading}
              >
                {loading ? <Loader2 size={16} className="spinning" aria-hidden="true" /> : <LogOut size={16} aria-hidden="true" />}
                <span>خروج از حساب</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              برای مشاهده دوره‌های خریداری‌شده و دانلود با کیفیت کامل، با اطلاعات حساب کاربری مکتب‌خونه خود وارد شوید.
            </p>

            <div>
              <label
                htmlFor="account-email"
                style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4, fontWeight: 500 }}
              >
                ایمیل یا نام کاربری:
              </label>
              <div className="input-group">
                <input
                  id="account-email"
                  name="email"
                  type="email"
                  className="input-control latin-text"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="account-password"
                style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4, fontWeight: 500 }}
              >
                رمز عبور:
              </label>
              <div className="input-group">
                <input
                  id="account-password"
                  name="password"
                  type="password"
                  className="input-control latin-text"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              رمز عبور شما فقط برای ارسال مستقیم به سرور محلی استفاده شده و هرگز در فرانت‌اند ذخیره نمی‌گردد.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
                انصراف
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <Loader2 size={16} className="spinning" aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
                <span>ورود به حساب</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

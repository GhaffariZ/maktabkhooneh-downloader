import React from 'react';
import { BookOpen, Download, Settings as SettingsIcon, User, Sun, Moon, GraduationCap } from 'lucide-react';
import type { SessionState } from '@shared/types';

interface NavbarProps {
  currentTab: 'courses' | 'downloads';
  onSelectTab: (tab: 'courses' | 'downloads') => void;
  session: SessionState;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  activeDownloadsCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  session,
  onOpenAccount,
  onOpenSettings,
  theme,
  onToggleTheme,
  activeDownloadsCount,
}) => {
  return (
    <aside className="app-sidebar" aria-label="ناوبری اصلی برنامه">
      <div className="sidebar-header">
        <div className="brand-badge">
          <div className="brand-logo-icon" aria-hidden="true">
            <GraduationCap size={20} />
          </div>
          <div>
            <div style={{ lineHeight: 1.2 }}>مکتب‌خونه</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>
              کتابخانه شخصی
            </div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          type="button"
          className={`nav-item ${currentTab === 'courses' ? 'active' : ''}`}
          onClick={() => onSelectTab('courses')}
          aria-current={currentTab === 'courses' ? 'page' : undefined}
        >
          <BookOpen size={18} aria-hidden="true" />
          <span>دوره‌های من</span>
        </button>

        <button
          type="button"
          className={`nav-item ${currentTab === 'downloads' ? 'active' : ''}`}
          onClick={() => onSelectTab('downloads')}
          aria-current={currentTab === 'downloads' ? 'page' : undefined}
        >
          <Download size={18} aria-hidden="true" />
          <span>دانلودها و آفلاین</span>
          {activeDownloadsCount > 0 && (
            <span className="nav-badge tabular-num" aria-label={`${activeDownloadsCount} دانلود در حال انجام`}>
              {activeDownloadsCount}
            </span>
          )}
        </button>
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="session-card clickable"
          onClick={onOpenAccount}
          title={session.authenticated ? 'مدیریت حساب کاربری' : 'ورود به حساب کاربری'}
          aria-label={session.authenticated ? `حساب کاربری: ${session.email}` : 'ورود به حساب کاربری'}
        >
          <User size={18} aria-hidden="true" color={session.authenticated ? 'var(--color-success)' : 'var(--color-text-muted)'} />
          <div className="session-info">
            <div className="session-email" style={{ color: 'var(--color-text-primary)' }}>
              {session.authenticated ? session.email || 'کاربر متصل' : 'حساب کاربری'}
            </div>
            <div className="session-status" style={{ color: 'var(--color-text-muted)' }}>
              {session.demo ? 'حالت آزمایشی' : session.authenticated ? 'متصل' : 'ورود با ایمیل'}
            </div>
          </div>
        </button>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ flex: 1 }}
            onClick={onOpenSettings}
            title="تنظیمات ذخیره‌سازی"
          >
            <SettingsIcon size={16} aria-hidden="true" />
            <span>تنظیمات</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm btn-icon"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'تغییر به پوسته روشن' : 'تغییر به پوسته تیره'}
            aria-label={theme === 'dark' ? 'فعال‌سازی حالت روشن' : 'فعال‌سازی حالت تیره'}
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </aside>
  );
};

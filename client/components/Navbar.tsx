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
    <>
      {/* Desktop & Tablet Sidebar */}
      <aside className="app-sidebar" aria-label="ناوبری اصلی برنامه">
        <div className="sidebar-header">
          <div className="brand-badge">
            <div className="brand-logo-icon" aria-hidden="true">
              <GraduationCap size={18} />
            </div>
            <div>
              <div className="brand-name">مکتب‌خونه</div>
              <div className="brand-tagline">کتابخانه شخصی</div>
            </div>
          </div>

          <div className="sidebar-mobile-actions">
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

        <nav className="sidebar-nav">
          <button
            type="button"
            className={`nav-item ${currentTab === 'courses' ? 'active' : ''}`}
            onClick={() => onSelectTab('courses')}
            aria-current={currentTab === 'courses' ? 'page' : undefined}
          >
            <BookOpen size={18} aria-hidden="true" />
            <span>دوره‌های من</span>
            {currentTab === 'courses' && <span className="nav-active-indicator" aria-hidden="true" />}
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
            {currentTab === 'downloads' && <span className="nav-active-indicator" aria-hidden="true" />}
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
            <div className="session-avatar-wrap">
              <User size={17} aria-hidden="true" color={session.authenticated ? 'var(--color-success)' : 'var(--color-text-muted)'} />
              <span
                className={`session-status-dot ${session.authenticated ? 'online' : 'idle'}`}
                aria-hidden="true"
              />
            </div>
            <div className="session-info">
              <div className="session-email">
                {session.authenticated ? session.email || 'کاربر متصل' : 'حساب کاربری'}
              </div>
              <div className="session-status">
                {session.demo ? 'حالت آزمایشی (آفلاین)' : session.authenticated ? 'متصل' : 'ورود با ایمیل'}
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
              <SettingsIcon size={15} aria-hidden="true" />
              <span>تنظیمات</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm btn-icon"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'تغییر به پوسته روشن' : 'تغییر به پوسته تیره'}
              aria-label={theme === 'dark' ? 'فعال‌سازی حالت روشن' : 'فعال‌سازی حالت تیره'}
            >
              {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Docked Mobile Bottom Navigation Bar */}
      <nav className="mobile-dock" aria-label="ناوبری همراه">
        <button
          type="button"
          className={`dock-item ${currentTab === 'courses' ? 'active' : ''}`}
          onClick={() => onSelectTab('courses')}
          aria-current={currentTab === 'courses' ? 'page' : undefined}
        >
          <BookOpen size={19} aria-hidden="true" />
          <span>دوره‌ها</span>
        </button>

        <button
          type="button"
          className={`dock-item ${currentTab === 'downloads' ? 'active' : ''}`}
          onClick={() => onSelectTab('downloads')}
          aria-current={currentTab === 'downloads' ? 'page' : undefined}
        >
          <div className="dock-icon-wrap">
            <Download size={19} aria-hidden="true" />
            {activeDownloadsCount > 0 && (
              <span className="dock-badge tabular-num">{activeDownloadsCount}</span>
            )}
          </div>
          <span>دانلودها</span>
        </button>

        <button
          type="button"
          className="dock-item"
          onClick={onOpenSettings}
          title="تنظیمات"
          aria-label="تنظیمات"
        >
          <SettingsIcon size={19} aria-hidden="true" />
          <span>تنظیمات</span>
        </button>

        <button
          type="button"
          className="dock-item"
          onClick={onOpenAccount}
          title="حساب کاربری"
          aria-label="حساب کاربری"
        >
          <User
            size={19}
            aria-hidden="true"
            color={session.authenticated ? 'var(--color-success)' : 'currentColor'}
          />
          <span>حساب</span>
        </button>
      </nav>
    </>
  );
};

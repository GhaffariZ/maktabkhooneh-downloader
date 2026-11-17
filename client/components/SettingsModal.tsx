import React, { useState, useEffect } from 'react';
import { X, Settings as SettingsIcon, Folder, Save, AlertCircle, Check, Loader2, Palette, Sliders, Gauge } from 'lucide-react';
import type { Settings } from '@shared/types';
import { useModalFocus } from '../utils/useModal';
import {
  type StudyPreferences,
  type ThemePreference,
  type DensityPreference,
  type QualityPreference,
  SPEED_OPTIONS,
} from '../utils/studyPreferences';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  preferences: StudyPreferences;
  onSave: (downloadDirectory: string) => Promise<void>;
  onUpdatePreferences: (update: Partial<StudyPreferences>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  preferences,
  onSave,
  onUpdatePreferences,
}) => {
  const [directory, setDirectory] = useState(settings.downloadDirectory);
  const [theme, setTheme] = useState<ThemePreference>(preferences.theme);
  const [density, setDensity] = useState<DensityPreference>(preferences.density);
  const [preferredQuality, setPreferredQuality] = useState<QualityPreference>(preferences.preferredQuality);
  const [playbackRate, setPlaybackRate] = useState<number>(preferences.playbackRate);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const modalRef = useModalFocus(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      setDirectory(settings.downloadDirectory);
      setTheme(preferences.theme);
      setDensity(preferences.density);
      setPreferredQuality(preferences.preferredQuality);
      setPlaybackRate(preferences.playbackRate);
      setError(null);
      setSavedSuccess(false);
    }
  }, [isOpen, settings.downloadDirectory, preferences]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedDir = directory.trim();
    if (!settings.downloadDirectoryManaged && !trimmedDir) {
      setError('مسیر پوشه ذخیره‌سازی نمی‌تواند خالی باشد');
      return;
    }

    // Save validated changed directory first, then onUpdatePreferences and close
    const directoryChanged = !settings.downloadDirectoryManaged && trimmedDir !== settings.downloadDirectory;

    if (directoryChanged) {
      setLoading(true);
      try {
        await onSave(trimmedDir);
        onUpdatePreferences({
          theme,
          density,
          preferredQuality,
          playbackRate,
        });
        setSavedSuccess(true);
        setTimeout(() => {
          onClose();
        }, 600);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات پوشه';
        setError(msg);
      } finally {
        setLoading(false);
      }
    } else {
      onUpdatePreferences({
        theme,
        density,
        preferredQuality,
        playbackRate,
      });
      setSavedSuccess(true);
      setTimeout(() => {
        onClose();
      }, 500);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div ref={modalRef} className="modal-card" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <SettingsIcon size={20} color="var(--color-accent)" aria-hidden="true" />
            <h3 id="settings-modal-title" className="modal-title">
              تنظیمات برنامه و یادگیری
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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Section 1: Appearance & Layout */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Palette size={16} aria-hidden="true" />
              <span>پوسته و چیدمان</span>
            </div>

            <div className="settings-row">
              <label htmlFor="settings-theme-select" className="settings-label">
                پوسته نمایشی:
              </label>
              <select
                id="settings-theme-select"
                className="input-control settings-select"
                value={theme}
                onChange={(e) => setTheme(e.target.value as ThemePreference)}
              >
                <option value="system">هماهنگ با سیستم‌عامل (پیش‌فرض)</option>
                <option value="light">روشن (کاغذ ملایم)</option>
                <option value="dark">تیره (گرافیت)</option>
              </select>
            </div>

            <div className="settings-row">
              <label htmlFor="settings-density-select" className="settings-label">
                تراکم نمایش:
              </label>
              <select
                id="settings-density-select"
                className="input-control settings-select"
                value={density}
                onChange={(e) => setDensity(e.target.value as DensityPreference)}
              >
                <option value="comfortable">استاندارد و راحت (Comfortable)</option>
                <option value="compact">فشرده برای نمایشگرهای کوچک (Compact)</option>
              </select>
            </div>
          </div>

          {/* Section 2: Study & Playback */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Sliders size={16} aria-hidden="true" />
              <span>عادات مطالعه و پخش ویدیو</span>
            </div>

            <div className="settings-row">
              <label htmlFor="settings-quality-select" className="settings-label">
                کیفیت ترجیحی پخش برخط:
              </label>
              <select
                id="settings-quality-select"
                className="input-control settings-select"
                value={preferredQuality}
                onChange={(e) => setPreferredQuality(e.target.value as QualityPreference)}
              >
                <option value="auto">خودکار (کیفیت پیش‌فرض)</option>
                <option value="low">کم‌حجم و سریع (اولویت با حجم کمتر)</option>
                <option value="high">کیفیت بالا و شفاف (اولویت با کیفیت برتر)</option>
              </select>
            </div>

            <div className="settings-row">
              <label htmlFor="settings-speed-select" className="settings-label">
                سرعت پیش‌فرض پخش:
              </label>
              <select
                id="settings-speed-select"
                className="input-control settings-select tabular-num"
                value={playbackRate}
                onChange={(e) => setPlaybackRate(Number(e.target.value))}
              >
                {SPEED_OPTIONS.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate === 1 ? '1.0x (سرعت عادی)' : `${rate}x`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 3: Storage */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Gauge size={16} aria-hidden="true" />
              <span>پوشه ذخیره‌سازی آفلاین</span>
            </div>

            {settings.downloadDirectoryManaged ? (
              <p className="settings-label">دانلودها در حافظه داخلی برنامه ذخیره می‌شوند.</p>
            ) : (
            <div>
              <label
                htmlFor="settings-download-directory"
                className="settings-label"
                style={{ marginBottom: 6 }}
              >
                مسیر ذخیره فایل‌ها در دیسک:
              </label>
              <div className="input-group">
                <Folder size={18} color="var(--color-text-muted)" aria-hidden="true" />
                <input
                  id="settings-download-directory"
                  name="downloadDirectory"
                  type="text"
                  className="input-control latin-text"
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                  placeholder="/path/to/downloads"
                  required
                />
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 6, marginInlineStart: 2 }}>
                تغییر این مسیر تنها بر دانلودهای جدید اعمال می‌شود و داده‌های قبلی حفظ می‌گردند.
              </p>
            </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              انصراف
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <Loader2 size={16} className="spinning" aria-hidden="true" />
              ) : savedSuccess ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Save size={16} aria-hidden="true" />
              )}
              <span>{savedSuccess ? 'ذخیره شد' : 'ذخیره تنظیمات'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

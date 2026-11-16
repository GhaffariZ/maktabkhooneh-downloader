import { useState, useEffect, useCallback } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type DensityPreference = 'comfortable' | 'compact';
export type QualityPreference = 'ask' | 'low' | 'high';

export interface StudyPreferences {
  theme: ThemePreference;
  density: DensityPreference;
  preferredQuality: QualityPreference;
  playbackRate: number;
}

export const SPEED_OPTIONS: number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

const STORAGE_KEY = 'maktabkhooneh_preferences';
const LEGACY_THEME_KEY = 'maktabkhooneh_theme';

export function getStoredPreferences(): StudyPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const theme: ThemePreference =
          parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
            ? parsed.theme
            : 'system';
        const density: DensityPreference =
          parsed.density === 'compact' ? 'compact' : 'comfortable';
        const preferredQuality: QualityPreference =
          parsed.preferredQuality === 'low' || parsed.preferredQuality === 'high'
            ? parsed.preferredQuality
            : 'ask';
        const playbackRate =
          typeof parsed.playbackRate === 'number' && SPEED_OPTIONS.includes(parsed.playbackRate)
            ? parsed.playbackRate
            : 1;

        return { theme, density, preferredQuality, playbackRate };
      }
    }
  } catch (e) {
    console.warn('Failed to parse study preferences from localStorage:', e);
  }

  // Migrate legacy theme if present
  let initialTheme: ThemePreference = 'system';
  try {
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacyTheme === 'light' || legacyTheme === 'dark') {
      initialTheme = legacyTheme;
    }
  } catch {}

  return {
    theme: initialTheme,
    density: 'comfortable',
    preferredQuality: 'ask',
    playbackRate: 1,
  };
}

export function savePreferences(prefs: StudyPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('Failed to save study preferences to localStorage:', e);
  }
}

export function useStudyPreferences() {
  const [preferences, setPreferences] = useState<StudyPreferences>(getStoredPreferences);
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const effectiveTheme: 'dark' | 'light' =
    preferences.theme === 'system'
      ? systemIsDark
        ? 'dark'
        : 'light'
      : preferences.theme;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.documentElement.setAttribute('data-density', preferences.density);
    try {
      localStorage.setItem(LEGACY_THEME_KEY, effectiveTheme);
    } catch {}
    savePreferences(preferences);
  }, [preferences, effectiveTheme]);

  const updatePreferences = useCallback((update: Partial<StudyPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...update }));
  }, []);

  return {
    preferences,
    updatePreferences,
    effectiveTheme,
  };
}

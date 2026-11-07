// Préférences d'accessibilité et de confort (par navigateur).
import { useCallback, useEffect, useState } from 'react';

export interface Prefs { sound: boolean; volume: number; textScale: number; motion: 'auto' | 'reduce' | 'full'; contrast: boolean; guide: boolean }
const KEY = 'kingdom-zero:prefs';
const DEFAULTS: Prefs = { sound: true, volume: 0.6, textScale: 1, motion: 'auto', contrast: false, guide: true };

function load(): Prefs {
  try { const t = localStorage.getItem(KEY); if (t) return { ...DEFAULTS, ...JSON.parse(t) }; } catch { /* stockage indisponible */ }
  return { ...DEFAULTS };
}

export function systemReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignoré */ }
    const root = document.documentElement;
    root.style.fontSize = `${Math.round(prefs.textScale * 100)}%`;
    const reduce = prefs.motion === 'reduce' || (prefs.motion === 'auto' && systemReducedMotion());
    root.dataset.motion = reduce ? 'reduce' : 'full';
    root.dataset.contrast = prefs.contrast ? 'high' : 'normal';
  }, [prefs]);
  const update = useCallback((patch: Partial<Prefs>) => setPrefs(p => ({ ...p, ...patch })), []);
  return { prefs, update };
}
export type PrefsApi = ReturnType<typeof usePrefs>;

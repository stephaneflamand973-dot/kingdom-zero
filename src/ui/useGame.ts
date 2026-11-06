// Pont entre le moteur (mutable, sans React) et l'interface.
import { useCallback, useMemo, useRef, useState } from 'react';
import { createWorld, loadFromStore, saveToStore, toDate, type ActionResult, type GameState, type KVStore } from '../engine';

export interface Feed { id: number; time: number; text: string; ok: boolean }

const store: KVStore | null = (() => {
  try { const t = '__kz_test__'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch { return null; }
})();

function initialState(): GameState {
  if (store) {
    const auto = loadFromStore(store, 'auto');
    if (auto.state) return auto.state;
  }
  return createWorld(Math.floor(Math.random() * 1e9));
}

export function useGame() {
  const ref = useRef<GameState>(initialState());
  const [version, setVersion] = useState(0);
  const [feed, setFeed] = useState<Feed[]>([]);
  const seq = useRef(0);
  const lastAutoDay = useRef(toDate(ref.current.time).day);

  const push = useCallback((text: string, ok: boolean) => {
    seq.current += 1;
    const item = { id: seq.current, time: ref.current.time, text, ok };
    setFeed(f => [item, ...f].slice(0, 30));
  }, []);

  /** Exécute une action du moteur, journalise son résultat et rafraîchit l'affichage. */
  const act = useCallback((fn: (s: GameState) => ActionResult) => {
    const r = fn(ref.current);
    push(r.message, r.ok);
    const day = toDate(ref.current.time).day;
    if (store && day !== lastAutoDay.current) { // sauvegarde automatique chaque matin
      lastAutoDay.current = day;
      try { saveToStore(store, 'auto', ref.current); } catch { /* stockage plein : ignoré */ }
    }
    setVersion(v => v + 1);
    return r;
  }, [push]);

  const replace = useCallback((s: GameState, msg: string) => {
    ref.current = s;
    lastAutoDay.current = toDate(s.time).day;
    setFeed([]);
    push(msg, true);
    setVersion(v => v + 1);
  }, [push]);

  const newGame = useCallback(() => {
    const s = createWorld(Math.floor(Math.random() * 1e9));
    replace(s, `Une nouvelle vie commence à Valcendre (graine ${s.seed}).`);
  }, [replace]);

  return useMemo(() => ({ state: ref.current, version, act, feed, push, replace, newGame, store }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, feed]);
}

export type Game = ReturnType<typeof useGame>;

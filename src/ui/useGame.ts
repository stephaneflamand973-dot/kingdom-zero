// Pont entre le moteur (mutable, sans React) et l'interface.
import { useCallback, useMemo, useRef, useState } from 'react';
import { createWorld, loadFromStore, saveToStore, toDate, type ActionResult, type GameState, type KVStore, type WorldEvent } from '../engine';
import { sound } from './audio';

export interface Feed { id: number; time: number; text: string; ok: boolean }
export type ToastTone = 'good' | 'bad' | 'info' | 'major';
export interface Toast { id: number; text: string; tone: ToastTone; title: string }

const GOOD = new Set(['gift', 'help', 'wedding', 'birth', 'title', 'loan_repaid', 'work_praise', 'order_done', 'friendship', 'peace', 'coming_of_age', 'inheritance']);
const BAD = new Set(['theft', 'death', 'sickness', 'insult', 'ambush', 'eviction', 'seizure', 'default', 'fire', 'arrest', 'jail', 'revolt', 'war', 'slander', 'rivalry', 'starving', 'bounty', 'racket', 'argument']);
const TITLES: Record<string, string> = {
  incident: 'Aléa', approach: 'On t’aborde', death: 'Décès', birth: 'Naissance', wedding: 'Noces', war: 'Guerre', revolt: 'Révolte',
  sickness: 'Maladie', theft: 'Vol', ambush: 'Embuscade', festival: 'Fête', title: 'Titre', fire: 'Renvoi', inheritance: 'Héritage',
};

/** Faits nouveaux qui concernent le joueur (acteur, cible ou témoin), du plus récent au plus ancien. */
export function notableFor(state: GameState, sinceSeq: number): WorldEvent[] {
  const p = state.characters[state.playerId];
  const known = new Set(p.knownEvents);
  return state.events.filter(e => Number(e.id.slice(1)) > sinceSeq && e.importance >= 2
    && (e.actorId === p.id || e.targetId === p.id || known.has(e.id))).reverse();
}

function toneOf(e: WorldEvent, playerId: string): ToastTone {
  if (e.type === 'incident') return (e.data?.kind === 'foire' || e.data?.kind === 'recolte') ? 'good' : 'major';
  if (e.type === 'approach') return e.data?.kind === 'provoke' || e.data?.kind === 'creditor' ? 'bad' : 'good';
  if (BAD.has(e.type) && (e.targetId === playerId || e.actorId === playerId || e.importance >= 3)) return 'bad';
  if (GOOD.has(e.type)) return 'good';
  return e.importance >= 3 ? 'major' : 'info';
}

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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);
  const notify = useCallback((evs: WorldEvent[], playerId: string) => {
    if (!evs.length) return;
    const fresh = evs.slice(0, 4).map(e => {
      toastSeq.current += 1;
      return { id: toastSeq.current, text: e.text, tone: toneOf(e, playerId), title: TITLES[e.type] ?? (e.importance >= 3 ? 'Fait majeur' : 'Nouvelle') };
    });
    setToasts(t => [...fresh, ...t].slice(0, 5));
    if (fresh.some(f => f.tone === 'major' || f.tone === 'bad')) sound.play('bell');
  }, []);
  const lastAutoDay = useRef(toDate(ref.current.time).day);

  const push = useCallback((text: string, ok: boolean) => {
    seq.current += 1;
    const item = { id: seq.current, time: ref.current.time, text, ok };
    setFeed(f => [item, ...f].slice(0, 30));
  }, []);

  /** Exécute une action du moteur, journalise son résultat et rafraîchit l'affichage. */
  const act = useCallback((fn: (s: GameState) => ActionResult) => {
    const before = ref.current;
    const seq0 = before.eventSeq, money0 = before.characters[before.playerId].money;
    const pid = before.playerId;
    let r: ActionResult;
    try {
      r = fn(ref.current);
    } catch (err) {
      // filet de sécurité : une erreur du moteur ne doit pas faire disparaître la partie
      console.error(err);
      r = { ok: false, message: `Une erreur inattendue a interrompu l’action (${(err as Error).message}). La partie continue ; pense à sauvegarder.`, minutes: 0 };
    }
    push(r.message, r.ok);
    const me = ref.current.characters[pid];
    sound.play(!r.ok ? 'fail' : me && me.money !== money0 ? 'coin' : 'click');
    notify(notableFor(ref.current, seq0).filter(e => !r.message.includes(e.text)), pid);
    const day = toDate(ref.current.time).day;
    if (store && day !== lastAutoDay.current) { // sauvegarde automatique chaque matin
      lastAutoDay.current = day;
      try { saveToStore(store, 'auto', ref.current); } catch { /* stockage plein : ignoré */ }
    }
    setVersion(v => v + 1);
    return r;
  }, [push, notify]);

  const replace = useCallback((s: GameState, msg: string) => {
    ref.current = s;
    lastAutoDay.current = toDate(s.time).day;
    setFeed([]);
    setToasts([]);
    push(msg, true);
    setVersion(v => v + 1);
  }, [push]);

  const newGame = useCallback(() => {
    const s = createWorld(Math.floor(Math.random() * 1e9));
    replace(s, `Une nouvelle vie commence à Valcendre (graine ${s.seed}).`);
  }, [replace]);

  return useMemo(() => ({ state: ref.current, version, act, feed, push, replace, newGame, store, toasts, dismiss }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, feed, toasts]);
}

export type Game = ReturnType<typeof useGame>;

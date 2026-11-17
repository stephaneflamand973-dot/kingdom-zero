// Pont entre le moteur (mutable, sans React) et l'interface.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backupSlot, createWorld, formatClock, formatDate, loadFromStore, saveToStore, toDate, type ActionResult, type GameState, type KVStore, type PlayerSetup, type WorldEvent } from '../engine';
import { sound } from './audio';
import { cloudStore, cloudSync, flushCloud, memoryStore } from './cloud';

export interface Feed { id: number; time: number; text: string; ok: boolean }
export type ToastTone = 'good' | 'bad' | 'info' | 'major';
export interface Toast { id: number; text: string; tone: ToastTone; title: string }

const GOOD = new Set(['promotion', 'gift', 'help', 'wedding', 'birth', 'title', 'loan_repaid', 'work_praise', 'order_done', 'friendship', 'peace', 'coming_of_age', 'inheritance']);
const BAD = new Set(['theft', 'death', 'sickness', 'insult', 'ambush', 'eviction', 'seizure', 'default', 'fire', 'arrest', 'jail', 'revolt', 'war', 'slander', 'rivalry', 'starving', 'bounty', 'racket', 'argument', 'order_failed']);
const TITLES: Record<string, string> = {
  incident: 'Aléa', approach: 'On t’aborde', death: 'Décès', birth: 'Naissance', wedding: 'Noces', war: 'Guerre', revolt: 'Révolte',
  promotion: 'Promotion', order_done: 'Parole tenue', order_failed: 'Parole non tenue', sickness: 'Maladie', theft: 'Vol', ambush: 'Embuscade', festival: 'Fête', title: 'Titre', fire: 'Renvoi', inheritance: 'Héritage',
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

const local: KVStore | null = (() => {
  try { const t = '__kz_test__'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch { return null; }
})();
/** Le navigateur garde-t-il les sauvegardes ? (sinon, seule la copie en ligne les conserve) */
export const localAvailable = !!local;
// chaque sauvegarde écrite dans le navigateur part aussi dans l'espace en ligne privé du joueur
const store: KVStore | null = cloudStore(local ?? memoryStore());

/** Charge la partie au démarrage : la sauvegarde automatique, sinon la rapide ou la copie de sécurité. */
function savedState(): { state?: GameState; error?: string; note?: string } {
  if (!store) return {};
  let firstError: string | undefined;
  for (const slot of ['auto', 'rapide', 'precedente']) {
    const r = loadFromStore(store, slot);
    if (r.state) {
      const note = slot !== 'auto' ? `La sauvegarde automatique était illisible : reprise depuis « ${slot === 'rapide' ? 'sauvegarde rapide' : 'partie précédente'} ».`
        : r.repaired?.length ? `Ta partie venait d’une version plus ancienne : ${r.repaired.length} incohérence${r.repaired.length > 1 ? 's' : ''} réparée${r.repaired.length > 1 ? 's' : ''} au chargement.` : undefined;
      return { state: r.state, note };
    }
    if (r.error && r.error !== 'Aucune sauvegarde dans cet emplacement.') {
      firstError ??= r.error;
      // on met de côté la sauvegarde illisible plutôt que de la laisser écraser
      if (slot === 'auto') backupSlot(store, 'auto', 'illisible');
    }
  }
  return { error: firstError };
}

export function useGame() {
  // sans partie sauvegardée, le monde attend la création du personnage
  const saved = useRef(savedState());
  const ref = useRef<GameState>(saved.current.state ?? createWorld(Math.floor(Math.random() * 1e9)));
  const [creating, setCreating] = useState(!saved.current.state);
  const startupError = saved.current.error;
  const startupNote = saved.current.note;
  const creatingRef = useRef(creating);
  creatingRef.current = creating;
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
  const acted = useRef(false); // le joueur a-t-il déjà joué depuis l'ouverture ?

  const push = useCallback((text: string, ok: boolean) => {
    seq.current += 1;
    const item = { id: seq.current, time: ref.current.time, text, ok };
    setFeed(f => [item, ...f].slice(0, 30));
  }, []);

  /** Exécute une action du moteur, journalise son résultat et rafraîchit l'affichage. */
  const act = useCallback((fn: (s: GameState) => ActionResult) => {
    acted.current = true;
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

  // ── Sauvegardes ──────────────────────────────────────────
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const saveTo = useCallback((slot: string, silent = false): boolean => {
    if (!store) { if (!silent) push('Le stockage du navigateur est indisponible : télécharge la sauvegarde depuis le menu Partie.', false); return false; }
    try {
      saveToStore(store, slot, ref.current);
      setLastSaved(Date.now());
      if (!silent) push(`Partie sauvegardée${slot === 'rapide' ? ' (sauvegarde rapide)' : ''}.`, true);
      return true;
    } catch { if (!silent) push('Échec de la sauvegarde : stockage du navigateur plein.', false); return false; }
  }, [push]);
  const quickSave = useCallback(() => saveTo('rapide'), [saveTo]);
  const loadFrom = useCallback((slot: string): string | null => {
    if (!store) return 'Le stockage du navigateur est indisponible.';
    const r = loadFromStore(store, slot);
    if (r.error || !r.state) return r.error ?? 'Erreur';
    ref.current = r.state;
    lastAutoDay.current = toDate(r.state.time).day;
    setFeed([]); setToasts([]);
    push(`Partie chargée : ${formatDate(r.state.time)}, ${formatClock(r.state.time)}.${r.repaired?.length ? ` (${r.repaired.length} incohérence${r.repaired.length > 1 ? 's' : ''} d’une ancienne version réparée${r.repaired.length > 1 ? 's' : ''})` : ''}`, true);
    setCreating(false);
    setVersion(v => v + 1);
    return null;
  }, [push]);
  const quickLoad = useCallback(() => { const err = loadFrom('rapide'); if (err) push(err === 'Aucune sauvegarde dans cet emplacement.' ? 'Aucune sauvegarde rapide : appuie d’abord sur K ou 💾.' : err, false); }, [loadFrom, push]);
  useEffect(() => { if (startupNote) push(startupNote, true); }, [startupNote, push]);
  // sauvegarde en ligne : on récupère une partie plus récente (autre appareil, navigateur vidé…)
  useEffect(() => {
    let alive = true;
    void cloudSync(store!, () => acted.current).then(pulled => {
      if (!alive) return;
      if (pulled.includes('auto') && !acted.current) {
        const r = loadFromStore(store!, 'auto');
        if (r.state) {
          ref.current = r.state;
          lastAutoDay.current = toDate(r.state.time).day;
          setFeed([]); setToasts([]);
          push(saved.current.state ? 'Partie reprise depuis ta sauvegarde en ligne : elle était plus récente que celle de ce navigateur.' : 'Partie reprise depuis ta sauvegarde en ligne.', true);
          setCreating(false);
          setVersion(v => v + 1);
        }
      } else if (pulled.includes('enligne')) {
        push('Une partie plus récente existe en ligne (autre appareil) : menu Partie → « Sauvegarde en ligne (autre appareil) ».', true);
      } else if (pulled.length) push(`Sauvegardes récupérées en ligne : ${pulled.length} emplacement${pulled.length > 1 ? 's' : ''}.`, true);
    });
    return () => { alive = false; };
  }, [push]);
  // filet de sécurité : sauvegarde automatique quand on quitte ou masque la page
  useEffect(() => {
    const flush = () => { if (!creatingRef.current) { saveTo('auto', true); flushCloud(store!); } };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onVis); };
  }, [saveTo]);

  const newGame = useCallback((setup?: PlayerSetup, seed?: number) => {
    // filet de sécurité : la partie en cours est conservée avant d'être remplacée
    if (store) backupSlot(store, 'auto', 'precedente');
    const s = createWorld(seed ?? Math.floor(Math.random() * 1e9), setup);
    const p = s.characters[s.playerId];
    replace(s, `Une nouvelle vie commence à Valcendre pour ${p.firstName} ${p.lastName} (graine ${s.seed}).`);
    setCreating(false);
    if (store) { try { saveToStore(store, 'auto', s); } catch { /* stockage plein */ } }
  }, [replace]);

  return useMemo(() => ({ state: ref.current, version, act, feed, push, replace, newGame, store, toasts, dismiss, creating, setCreating, saveTo, loadFrom, quickSave, quickLoad, lastSaved, startupError }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, feed, toasts, creating, lastSaved]);
}

export type Game = ReturnType<typeof useGame>;

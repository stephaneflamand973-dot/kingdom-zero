// Sauvegarde versionnée avec contrôle d'intégrité.
import { checkIntegrity } from './invariants';
import type { GameState } from './types';
import { SAVE_VERSION } from './world';

export interface SaveFile { format: 'KINGDOM_ZERO_SAVE'; version: number; savedAt: string; checksum: string; state: GameState }

/** FNV-1a 32 bits — suffisant pour détecter une corruption accidentelle. */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function serialize(state: GameState, savedAt = new Date().toISOString()): string {
  const body = JSON.stringify(state);
  const file: SaveFile = { format: 'KINGDOM_ZERO_SAVE', version: SAVE_VERSION, savedAt, checksum: checksum(body), state };
  return JSON.stringify(file);
}

/** Migrations de format : version n → n+1. */
const MIGRATIONS: Record<number, (s: GameState) => GameState> = {};

export function deserialize(text: string): { state?: GameState; error?: string; savedAt?: string } {
  let file: SaveFile;
  try { file = JSON.parse(text); } catch { return { error: 'Fichier de sauvegarde illisible.' }; }
  if (file?.format !== 'KINGDOM_ZERO_SAVE' || !file.state) return { error: "Ce n'est pas une sauvegarde de Kingdom Zero." };
  if (checksum(JSON.stringify(file.state)) !== file.checksum) return { error: 'Sauvegarde corrompue (somme de contrôle invalide).' };
  let state = file.state;
  let v = file.version;
  if (v > SAVE_VERSION) return { error: `Sauvegarde d'une version plus récente (${v}).` };
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) return { error: `Aucune migration depuis la version ${v}.` };
    state = m(state); v++;
  }
  state.version = SAVE_VERSION;
  const errors = checkIntegrity(state);
  if (errors.length) return { error: `Sauvegarde incohérente : ${errors.slice(0, 3).join(' ; ')}` };
  return { state, savedAt: file.savedAt };
}

// Stockage navigateur (localStorage) — optionnel, injecté pour rester testable.
export interface KVStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const KEY = (slot: string) => `kingdom-zero:save:${slot}`;

export function saveToStore(store: KVStore, slot: string, state: GameState): void { store.setItem(KEY(slot), serialize(state)); }
export function loadFromStore(store: KVStore, slot: string) {
  const t = store.getItem(KEY(slot));
  if (!t) return { error: 'Aucune sauvegarde dans cet emplacement.' };
  return deserialize(t);
}
export function slotInfo(store: KVStore, slot: string): { savedAt: string; time: number } | null {
  const t = store.getItem(KEY(slot));
  if (!t) return null;
  try { const f = JSON.parse(t) as SaveFile; return { savedAt: f.savedAt, time: f.state.time }; } catch { return null; }
}

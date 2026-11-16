// Sauvegarde versionnée avec contrôle d'intégrité.
import { checkIntegrity } from './invariants';
import type { Festival, GameState } from './types';
import { addPower, addRegion, SAVE_VERSION, valcendreSettlement } from './world';
import { birthDayFor, seedFamilies } from './family';
import { initialAmbition } from './society';

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
const MIGRATIONS: Record<number, (s: GameState) => GameState> = {
  // v1 → v2 (phase 2) : dettes, contrats, commandes, ambitions des PNJ
  1: s => {
    s.loans ??= [];
    s.contracts ??= [];
    s.orders ??= [];
    for (const id of s.characterOrder) {
      const c = s.characters[id];
      if (!c.ambition) c.ambition = c.isPlayer ? { kind: 'vie_paisible', since: s.time } : initialAmbition(s, c);
    }
    return s;
  },
  // v2 → v3 (phase 3) : la région. Valcendre devient une localité parmi trois.
  2: s => {
    if ((s as Partial<GameState>).settlements) return s; // déjà régionale
    const old = (s as unknown as { village: { name: string; taxRate: number; manorId: string; infrastructure: number } }).village;
    delete (s as unknown as { village?: unknown }).village;
    const oldFestival = (s as unknown as { festival?: Festival }).festival;
    delete (s as unknown as { festival?: unknown }).festival;
    s.settlements = { valcendre: valcendreSettlement(old?.infrastructure ?? 55, old?.taxRate ?? 0.05) };
    s.settlementOrder = ['valcendre'];
    for (const id of s.locationOrder) s.locations[id].settlementId = 'valcendre';
    s.roads = []; s.caravans = []; s.properties = []; s.priceBook = {}; s.tradeMemory = {};
    s.festivals = oldFestival ? [{ ...oldFestival, settlementId: 'valcendre' }] : [];
    addRegion(s);
    return s;
  },
  // v3 → v4 (phase 4) : maisons nobles, guilde, bande, guerres, avis de recherche
  3: s => {
    for (const id of s.settlementOrder) {
      const st = s.settlements[id];
      st.lordHouseId ??= id === 'hautepierre' ? 'h_roche' : 'h_delaval';
      st.unrest ??= 20; st.unrestWeeks ??= 0;
    }
    addPower(s, true);
    return s;
  },
  // v4 → v5 (phase 5) : familles, dates de naissance, lignée du joueur
  4: s => {
    for (const id of s.characterOrder) {
      const c = s.characters[id];
      c.parentIds ??= []; c.childIds ??= [];
      c.birthDay ??= birthDayFor(id, c.age) + Math.floor((s.time + 360) / 1440);
    }
    seedFamilies(s);
    s.dynasty ??= { name: s.characters[s.playerId].lastName, generation: 1, heads: [{ id: s.playerId, from: 0 }] };
    return s;
  },
  // v5 → v6 (phase 6) : aléas du monde
  5: s => { s.incidents ??= []; return s; },
  // v6 → v7 : convois de grain physiques
  6: s => { s.convoys ??= []; return s; },
  // v7 → v8 (phase 7) : requêtes et chronique de la lignée
  7: s => { s.quests ??= []; s.chronicle ??= []; s.chronicleSeq ??= s.eventSeq; return s; },
};

export function deserialize(text: string): { state?: GameState; error?: string; savedAt?: string; repaired?: string[] } {
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
  // Une partie jouée avec une version plus ancienne peut porter des incohérences dues à des bogues corrigés
  // depuis : on la répare plutôt que de la refuser.
  let repaired: string[] = [];
  if (checkIntegrity(state).length) repaired = repairState(state);
  const errors = checkIntegrity(state);
  if (errors.length) return { error: `Sauvegarde incohérente : ${errors.slice(0, 3).join(' ; ')}` };
  return { state, savedAt: file.savedAt, repaired };
}

/**
 * Remet d'aplomb une partie incohérente (registres d'emploi, contrats, propriétaires morts, valeurs invalides,
 * horloge). Renvoie la liste des réparations effectuées. Ne touche à rien de ce qui est déjà cohérent.
 */
export function repairState(state: GameState): string[] {
  const fixes: string[] = [];
  const fix = (t: string) => { if (fixes.length < 40) fixes.push(t); };
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const cleanInv = (inv: Record<string, number | undefined>, who: string) => {
    for (const [k, v] of Object.entries(inv)) {
      if (Number.isInteger(v) && v! > 0) continue;
      const n = int(v);
      if (n > 0) inv[k] = n; else delete inv[k];
      fix(`${who} : quantité de ${k} corrigée`);
    }
  };
  const fallback = state.settlements[state.settlementOrder[0]]?.squareId ?? state.locationOrder[0];
  state.characterOrder = state.characterOrder.filter(id => !!state.characters[id]);
  for (const id of state.characterOrder) {
    const c = state.characters[id];
    if (!Number.isInteger(c.money) || c.money < 0) { c.money = int(c.money); fix(`${id} : bourse corrigée`); }
    cleanInv(c.inventory, id);
    if (!state.locations[c.homeId]) { c.homeId = fallback; fix(`${id} : foyer inconnu`); }
    if (!state.locations[c.locationId]) { c.locationId = c.homeId; fix(`${id} : lieu inconnu`); }
    if (!(c.health >= 0 && c.health <= 100)) { c.health = Math.min(100, Math.max(0, Number(c.health) || 0)); fix(`${id} : santé corrigée`); }
    if (c.employerId && !state.businesses[c.employerId]) { c.employerId = undefined; fix(`${id} : employeur disparu`); }
    if (!c.alive && c.employerId) c.employerId = undefined;
  }
  state.businessOrder = state.businessOrder.filter(id => !!state.businesses[id]);
  for (const id of state.businessOrder) {
    const b = state.businesses[id];
    if (!Number.isInteger(b.treasury) || b.treasury < 0) { b.treasury = int(b.treasury); fix(`${id} : caisse corrigée`); }
    cleanInv(b.stock, id);
    if (b.ownerId && !state.characters[b.ownerId]?.alive) { b.ownerId = null; fix(`${id} : propriétaire disparu, passe sous tutelle`); }
    const before = b.employees.length;
    // ne restent au registre que les vivants qui y travaillent vraiment (ou qui n'ont pas d'autre place)
    b.employees = [...new Set(b.employees)].filter(e => {
      const c = state.characters[e];
      if (!c?.alive || b.ownerId === e) return false;
      if (c.employerId === id) return true;
      const other = c.employerId ? state.businesses[c.employerId] : undefined;
      if (other && (other.employees.includes(e) || other.ownerId === e)) return false;
      c.employerId = id;
      return true;
    });
    if (b.employees.length !== before) fix(`${id} : registre du personnel remis à jour`);
  }
  // un vivant qui se dit employé quelque part doit figurer au registre
  for (const id of state.characterOrder) {
    const c = state.characters[id];
    const b = c.alive && c.employerId ? state.businesses[c.employerId] : undefined;
    if (b && b.ownerId !== id && !b.employees.includes(id)) { b.employees.push(id); fix(`${id} : ajouté au registre de ${b.id}`); }
  }
  for (const pr of state.properties ?? []) {
    if (pr.tenantId && !state.characters[pr.tenantId]) { pr.tenantId = undefined; pr.rentDueDay = undefined; fix(`${pr.id} : locataire disparu`); }
    cleanInv(pr.storage, pr.id);
  }
  for (const cv of state.caravans ?? []) cleanInv(cv.cargo, cv.id);
  for (const cv of state.convoys ?? []) cleanInv(cv.cargo, cv.id);
  const loans = state.loans.length;
  state.loans = state.loans.filter(l => state.characters[l.lenderId] && state.characters[l.borrowerId]);
  for (const l of state.loans) if (!Number.isInteger(l.remaining) || l.remaining < 0) l.remaining = int(l.remaining);
  if (state.loans.length !== loans) fix('prêts envers des inconnus effacés');
  for (const k of state.contracts) {
    if (k.status !== 'active') continue;
    const b = state.businesses[k.businessId], w = state.characters[k.workerId];
    if (!b || !w?.alive || !b.employees.includes(w.id) || w.employerId !== b.id) { k.status = 'ended'; k.endReason = 'contrat caduc (réparation)'; fix(`${k.id} : contrat caduc clos`); }
  }
  const hours = Math.floor((state.time + 360) / 60);
  if (state.processedHours !== hours) { state.processedHours = hours; fix('horloge resynchronisée'); }
  return fixes;
}

// Copie brute d'un emplacement vers un autre (filet de sécurité avant d'écraser une partie).
export function backupSlot(store: KVStore, from: string, to: string): boolean {
  const t = store.getItem(KEY(from));
  if (!t) return false;
  try { store.setItem(KEY(to), t); return true; } catch { return false; }
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
export interface SlotInfo { savedAt: string; time: number; who: string; generation: number; money: number }
export function slotInfo(store: KVStore, slot: string): SlotInfo | null {
  const t = store.getItem(KEY(slot));
  if (!t) return null;
  try {
    const f = JSON.parse(t) as SaveFile;
    const p = f.state.characters?.[f.state.playerId];
    return { savedAt: f.savedAt, time: f.state.time, who: p ? `${p.firstName} ${p.lastName}` : '?', generation: f.state.dynasty?.generation ?? 1, money: p?.money ?? 0 };
  } catch { return null; }
}
export function deleteSlot(store: KVStore, slot: string): void { store.removeItem(KEY(slot)); }
/** Nom de fichier lisible pour l'export d'une partie. */
export function saveFileName(state: GameState): string {
  const p = state.characters[state.playerId];
  const slug = `${p.firstName}-${p.lastName}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').toLowerCase();
  return `kingdom-zero-${slug}-jour-${Math.floor((state.time + 360) / 1440)}.json`;
}

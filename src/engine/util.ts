import type { Business, Character, GameState, Inventory, ItemId, Location, Road, Settlement } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function qty(inv: Inventory, item: ItemId): number { return inv[item] ?? 0; }

export function addItem(inv: Inventory, item: ItemId, n: number): void {
  const v = (inv[item] ?? 0) + n;
  if (v < 0) throw new Error(`Inventaire négatif pour ${item}`);
  if (v === 0) delete inv[item]; else inv[item] = v;
}

export function fullName(c: Character): string { return `${c.firstName} ${c.lastName}`; }

export function player(state: GameState): Character { return state.characters[state.playerId]; }

export function aliveCharacters(state: GameState): Character[] {
  const out: Character[] = [];
  for (const id of state.characterOrder) { const c = state.characters[id]; if (c.alive) out.push(c); }
  return out;
}
export function npcs(state: GameState): Character[] {
  return aliveCharacters(state).filter(c => !c.isPlayer);
}

export function charactersAt(state: GameState, locationId: string, includePlayer = false): Character[] {
  return aliveCharacters(state).filter(c => c.locationId === locationId && (includePlayer || !c.isPlayer));
}

export function businessesAt(state: GameState, locationId: string): Business[] {
  return state.businessOrder.map(id => state.businesses[id]).filter(b => b.locationId === locationId);
}

export function allBusinesses(state: GameState): Business[] {
  return state.businessOrder.map(id => state.businesses[id]);
}

// ── Géographie (phase 3) ─────────────────────────────────────

export function settlementIdOf(state: GameState, locationId: string): string {
  return state.locations[locationId]?.settlementId ?? 'valcendre';
}
export function settlementOf(state: GameState, locationId: string): Settlement {
  const id = settlementIdOf(state, locationId);
  return state.settlements[id] ?? state.settlements[state.settlementOrder[0]];
}
/** Localité de résidence d'un personnage (sa maison). */
export function homeSettlement(state: GameState, c: Character): Settlement {
  return settlementOf(state, c.homeId);
}
/** Localité où se trouve un personnage (pour un voyageur, sa localité d'attache). */
export function hereSettlement(state: GameState, c: Character): Settlement {
  return state.locations[c.locationId]?.kind === 'road' ? homeSettlement(state, c) : settlementOf(state, c.locationId);
}
export function businessSettlement(state: GameState, b: Business): Settlement {
  return settlementOf(state, b.locationId);
}
export function businessesIn(state: GameState, settlementId: string): Business[] {
  const out: Business[] = [];
  for (const id of state.businessOrder) {
    const b = state.businesses[id];
    if ((state.locations[b.locationId]?.settlementId ?? 'valcendre') === settlementId) out.push(b);
  }
  return out;
}
export function locationsIn(state: GameState, settlementId: string, kind?: Location['kind']): Location[] {
  return state.locationOrder.map(id => state.locations[id]).filter(l => l.settlementId === settlementId && (!kind || l.kind === kind));
}
export function residents(state: GameState, settlementId: string): Character[] {
  return npcs(state).filter(c => settlementIdOf(state, c.homeId) === settlementId);
}
export function manorOf(state: GameState, settlementId: string): Business {
  return state.businesses[state.settlements[settlementId].manorId];
}

/** Itinéraire le plus court entre deux localités (Dijkstra sur le petit réseau routier). */
export function roadPath(state: GameState, from: string, to: string): { hours: number; roads: Road[] } | undefined {
  if (from === to) return { hours: 0, roads: [] };
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, Road> = {};
  const todo = new Set(state.settlementOrder);
  while (todo.size) {
    let u: string | undefined;
    for (const v of todo) if (dist[v] !== undefined && (u === undefined || dist[v] < dist[u])) u = v;
    if (u === undefined) break;
    todo.delete(u);
    if (u === to) break;
    for (const r of state.roads) {
      const v = r.a === u ? r.b : r.b === u ? r.a : undefined;
      if (!v || !todo.has(v)) continue;
      const d = dist[u] + r.hours;
      if (dist[v] === undefined || d < dist[v]) { dist[v] = d; prev[v] = r; }
    }
  }
  if (dist[to] === undefined) return undefined;
  const roads: Road[] = [];
  for (let v = to; v !== from;) { const r = prev[v]; roads.unshift(r); v = r.a === v ? r.b : r.a; }
  return { hours: dist[to], roads };
}

function localMinutes(state: GameState, a: Location, b: Location): number {
  if (a.id === b.id) return 0;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const infra = state.settlements[a.settlementId]?.infrastructure ?? 50;
  const infraFactor = 1 + (60 - infra) / 200; // chemins entretenus = trajets plus courts
  return Math.max(5, Math.round((d / 18) * infraFactor));
}

export function travelMinutes(state: GameState, fromId: string, toId: string): number {
  if (fromId === toId) return 0;
  const a = state.locations[fromId], b = state.locations[toId];
  if (a.kind === 'road' || b.kind === 'road') return 60;
  if (a.settlementId === b.settlementId) return localMinutes(state, a, b);
  const sa = state.settlements[a.settlementId], sb = state.settlements[b.settlementId];
  const path = roadPath(state, sa.id, sb.id);
  if (!path) return Infinity;
  return localMinutes(state, a, state.locations[sa.squareId]) + path.hours * 60 + localMinutes(state, state.locations[sb.squareId], b);
}

export function newId(state: GameState, prefix: string): string {
  state.idSeq += 1;
  return `${prefix}${state.idSeq}`;
}

export function isOpen(b: Business, hour: number): boolean {
  return b.openFrom <= b.openTo ? hour >= b.openFrom && hour < b.openTo : hour >= b.openFrom || hour < b.openTo;
}

export function ownerName(state: GameState, b: Business): string {
  return b.ownerId ? fullName(state.characters[b.ownerId]) : "l'intendance";
}

export function employerOf(state: GameState, c: Character): Business | undefined {
  return c.employerId ? state.businesses[c.employerId] : undefined;
}

/** Entreprise possédée par le personnage (au plus une en phase 1). */
export function ownedBusiness(state: GameState, c: Character): Business | undefined {
  return allBusinesses(state).find(b => b.ownerId === c.id);
}

export function hasTrait(c: Character, t: Character['traits'][number]): boolean { return c.traits.includes(t); }

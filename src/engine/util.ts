import type { Business, Character, GameState, Inventory, ItemId } from './types';

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
  return state.characterOrder.map(id => state.characters[id]).filter(c => c.alive);
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

export function travelMinutes(state: GameState, fromId: string, toId: string): number {
  if (fromId === toId) return 0;
  const a = state.locations[fromId], b = state.locations[toId];
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const infraFactor = 1 + (60 - state.village.infrastructure) / 200; // routes entretenues = trajets plus courts
  return Math.max(5, Math.round((d / 18) * infraFactor));
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

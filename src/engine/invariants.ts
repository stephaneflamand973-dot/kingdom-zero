// Contrôles de cohérence du monde, utilisés par les tests, la sauvegarde et le débogage.
import { totalMoney } from './economy';
import type { GameState, ItemId } from './types';
import { ITEM_IDS } from './data';

export function checkIntegrity(state: GameState): string[] {
  const errs: string[] = [];
  if (!state.characters[state.playerId]) errs.push('joueur introuvable');
  for (const id of state.characterOrder) {
    const c = state.characters[id];
    if (!c) { errs.push(`personnage ${id} manquant`); continue; }
    if (!Number.isInteger(c.money) || c.money < 0) errs.push(`${id}: argent invalide ${c.money}`);
    for (const [k, v] of Object.entries(c.inventory)) if (!Number.isInteger(v) || v! < 0) errs.push(`${id}: stock ${k} invalide`);
    if (!state.locations[c.locationId]) errs.push(`${id}: lieu ${c.locationId} inconnu`);
    if (c.employerId && !state.businesses[c.employerId]) errs.push(`${id}: employeur inconnu`);
    if (c.alive && c.employerId) {
      const b = state.businesses[c.employerId];
      if (b && b.ownerId !== id && !b.employees.includes(id)) errs.push(`${id}: absent de la liste des employés de ${b.id}`);
    }
    if (c.health < 0 || c.health > 100) errs.push(`${id}: santé hors bornes`);
  }
  for (const id of state.businessOrder) {
    const b = state.businesses[id];
    if (!Number.isInteger(b.treasury) || b.treasury < 0) errs.push(`${id}: trésorerie invalide ${b.treasury}`);
    for (const [k, v] of Object.entries(b.stock)) if (!Number.isInteger(v) || v! < 0) errs.push(`${id}: stock ${k} invalide`);
    for (const e of b.employees) {
      const c = state.characters[e];
      if (!c || !c.alive || c.employerId !== id) errs.push(`${id}: employé ${e} incohérent`);
    }
    if (b.ownerId && !state.characters[b.ownerId]?.alive) errs.push(`${id}: propriétaire ${b.ownerId} mort ou inconnu`);
  }
  for (const l of state.loans) {
    if (!state.characters[l.lenderId] || !state.characters[l.borrowerId]) errs.push(`${l.id}: prêt vers un inconnu`);
    if (!Number.isInteger(l.remaining) || l.remaining < 0) errs.push(`${l.id}: reste dû invalide`);
  }
  for (const k of state.contracts) {
    if (k.status !== 'active') continue;
    const b = state.businesses[k.businessId], w = state.characters[k.workerId];
    if (!b || !w || !b.employees.includes(w.id) || w.employerId !== b.id) errs.push(`${k.id}: contrat actif incohérent`);
  }
  if (state.processedHours !== Math.floor((state.time + 360) / 60)) errs.push('horloge et heures simulées désynchronisées');
  return errs;
}

/** Bilan matière : stock final = initial + produit - consommé + entrées externes. */
export function itemBalance(initial: Partial<Record<ItemId, number>>, state: GameState, current: Partial<Record<ItemId, number>>): Partial<Record<ItemId, number>> {
  const diff: Partial<Record<ItemId, number>> = {};
  for (const it of ITEM_IDS) {
    const expected = (initial[it] ?? 0) + (state.ledger.produced[it] ?? 0) - (state.ledger.consumed[it] ?? 0) + (state.ledger.externalItemsIn[it] ?? 0) - (state.ledger.removedItems[it] ?? 0);
    const d = (current[it] ?? 0) - expected;
    if (d !== 0) diff[it] = d;
  }
  return diff;
}

export function moneyBalance(initialMoney: number, state: GameState): number {
  return totalMoney(state) - (initialMoney + state.ledger.externalMoneyIn - state.ledger.externalMoneyOut);
}

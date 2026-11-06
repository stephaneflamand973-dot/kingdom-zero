// Criminalité élémentaire : vol à l'étalage, détection par les témoins, amende.
import { ITEMS } from './data';
import { P, transferItem, transferMoney } from './economy';
import { logEvent } from './events';
import { chance } from './rng';
import { applyBeliefEffect, modifyRelation } from './social';
import type { Business, Character, GameState, ItemId, WorldEvent } from './types';
import { charactersAt, clamp, fullName, qty } from './util';
import { gainXp } from './skills';

export interface TheftOutcome { success: boolean; caught: boolean; event: WorldEvent; fine: number; detectedBy: string[] }

export function detectionChance(observer: Character, thief: Character, b: Business): number {
  let p = 0.08 + observer.attributes.perception * 0.035;
  if (observer.id === b.ownerId) p += 0.2;
  if (observer.profession === 'garde' && observer.activity.kind === 'work') p += 0.25;
  if (b.employees.includes(observer.id)) p += 0.08;
  p -= thief.skills.discretion / 180 + thief.attributes.agilite * 0.015;
  return clamp(p, 0.03, 0.9);
}

export function attemptTheft(state: GameState, thief: Character, b: Business, item: ItemId, n: number): TheftOutcome | { error: string } {
  if (thief.locationId !== b.locationId) return { error: "Tu n'es pas sur place." };
  if (qty(b.stock, item) < n) return { error: 'Il n’y a pas assez de marchandise à dérober.' };
  const observers = charactersAt(state, b.locationId, true).filter(c => c.id !== thief.id && c.activity.kind !== 'sleep');
  const detectedBy = observers.filter(o => chance(state, detectionChance(o, thief, b))).map(o => o.id);
  const value = ITEMS[item].base * n;
  gainXp(state, thief, 'discretion', 2);
  if (detectedBy.length === 0) {
    transferItem(state, P.b(b.id), P.c(thief.id), item, n);
    // Fait réel connu du seul propriétaire : des biens ont disparu, sans coupable identifié.
    const ev = logEvent(state, {
      type: 'theft', businessId: b.id, locationId: b.locationId, importance: 2,
      text: n > 1 ? `${n} ${ITEMS[item].plural} ont disparu de ${b.name}. Personne n'a rien vu.` : `${cap(ITEMS[item].one)} a disparu de ${b.name}. Personne n'a rien vu.`,
      witnesses: b.ownerId ? [b.ownerId] : [], data: { item, n, culprit: thief.id },
    });
    return { success: true, caught: false, event: ev, fine: 0, detectedBy };
  }
  const guard = observers.find(o => o.profession === 'garde') ?? state.characterOrder.map(id => state.characters[id]).find(c => c.alive && c.profession === 'garde' && c.activity.kind === 'work');
  const ev = logEvent(state, {
    type: 'theft_caught', actorId: thief.id, businessId: b.id, locationId: b.locationId, importance: 3,
    text: `${fullName(thief)} est surpris en train de voler ${n > 1 ? ITEMS[item].plural : ITEMS[item].one} à ${b.name} par ${detectedBy.map(id => fullName(state.characters[id])).join(', ')}.`,
    witnesses: observers.map(o => o.id), data: { item, n },
  });
  for (const id of observers.map(o => o.id)) applyBeliefEffect(state, id, ev);
  if (b.ownerId) modifyRelation(state, b.ownerId, thief.id, -15, -20);
  let fine = 0;
  if (guard) {
    fine = Math.min(thief.money, value * 3 + 10);
    if (fine > 0) transferMoney(state, P.c(thief.id), P.b(state.village.manorId), fine);
    logEvent(state, {
      type: 'fine', actorId: guard.id, targetId: thief.id, locationId: b.locationId, importance: 2,
      text: fine > 0
        ? `Le garde ${fullName(guard)} inflige à ${fullName(thief)} une amende de ${fine} d pour vol.`
        : `Le garde ${fullName(guard)}, faute d'argent à saisir, jette ${fullName(thief)} une nuit au cachot.`,
      witnesses: observers.map(o => o.id), causeIds: [ev.id],
    });
    if (fine === 0) thief.needs.energy = clamp(thief.needs.energy - 25, 0, 100);
  } else {
    thief.health = clamp(thief.health - 6, 0, 100);
    thief.needs.energy = clamp(thief.needs.energy - 10, 0, 100);
  }
  return { success: false, caught: true, event: ev, fine, detectedBy };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

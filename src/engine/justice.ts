// ─────────────────────────────────────────────────────────────
// Justice (phase 4) : avis de recherche, primes, arrestations, prison.
// Les autorités n'agissent que sur ce qu'elles savent : un crime sans témoin reste impuni.
// ─────────────────────────────────────────────────────────────
import { applyWounds, autoBattle, fighterOf, strength } from './combat';
import { askPrice, P, trade, transferItem, transferMoney } from './economy';
import { logEvent } from './events';
import { eat } from './npc';
import { houseOf, isJailed, isLawman } from './orgs';
import { chance } from './rng';
import { killCharacter } from './sim';
import { modifyRelation } from './social';
import { MIN_PER_DAY, toDate } from './time';
import type { Character, GameState, Wanted } from './types';
import { aliveCharacters, businessesIn, charactersAt, fullName, manorOf, qty, residents, settlementIdOf } from './util';

export function wantedFor(state: GameState, charId: string): Wanted | undefined {
  return state.wanted.find(w => w.characterId === charId);
}

/** Les autorités d'une localité déclarent quelqu'un recherché (la prime s'additionne). */
export function addWanted(state: GameState, charId: string, settlementId: string, reason: string, bounty: number): Wanted | undefined {
  const house = houseOf(state, settlementId);
  const c = state.characters[charId];
  if (!house || !c || !c.alive) return undefined;
  let w = wantedFor(state, charId);
  if (w) { w.bounty = Math.min(300, w.bounty + bounty); return w; } // déjà affiché : la prime monte, sans nouvel avis
  w = { characterId: charId, houseId: house.id, reason, bounty, sinceDay: toDate(state.time).day };
  state.wanted.push(w);
  logEvent(state, {
    type: 'bounty', actorId: charId, importance: 2, locationId: state.settlements[settlementId].squareId,
    text: `Avis de recherche à ${state.settlements[settlementId].name} : ${fullName(c)}, pour ${reason}. Prime : ${w.bounty} d.`,
    witnesses: residents(state, settlementId).map(x => x.id),
  });
  return w;
}

/** Met en prison : amende (toute la bourse jusqu'à la prime), jours de geôle, avis levé. */
export function jail(state: GameState, c: Character, settlementId: string, days: number, why: string): void {
  const manor = manorOf(state, settlementId);
  const w = wantedFor(state, c.id);
  const fine = Math.min(c.money, Math.max(10, w?.bounty ?? 10));
  if (fine > 0) transferMoney(state, P.c(c.id), P.b(manor.id), fine);
  c.jailedUntil = state.time + days * MIN_PER_DAY;
  c.locationId = manor.locationId;
  c.activity = { kind: 'jailed', locationId: manor.locationId, since: state.time, until: c.jailedUntil, note: `En prison à ${state.settlements[settlementId].name}` };
  state.wanted = state.wanted.filter(x => x.characterId !== c.id);
  logEvent(state, {
    type: 'jail', actorId: c.id, locationId: manor.locationId, importance: 2,
    text: `${fullName(c)} est jeté en prison à ${state.settlements[settlementId].name} pour ${days} jours (${why}) ; amende de ${fine} d.`,
    witnesses: residents(state, settlementId).map(x => x.id),
  });
}

/** Chaque heure : libérations, puis les gardes en service arrêtent les recherchés qu'ils croisent. */
export function hourlyJustice(state: GameState): void {
  for (const c of aliveCharacters(state)) {
    if (c.jailedUntil && c.jailedUntil <= state.time) {
      c.jailedUntil = undefined;
      c.activity = { kind: 'idle', locationId: c.locationId, since: state.time, note: 'Sort de prison' };
    }
  }
  for (const w of state.wanted.slice()) {
    const c = state.characters[w.characterId];
    if (!c || !c.alive || isJailed(state, c) || c.isPlayer && state.encounter) continue;
    if (state.locations[c.locationId]?.kind === 'road') continue;
    const sid = settlementIdOf(state, c.locationId);
    if (houseOf(state, sid)?.id !== w.houseId) continue; // hors de la juridiction de la maison
    const law = charactersAt(state, c.locationId).filter(x => x.id !== c.id && isLawman(state, x));
    if (!law.length) continue;
    if (c.isPlayer) {
      if (state.observer) continue;
      state.encounter = {
        kind: 'arrest', enemies: law.slice(0, 2).map(x => x.id), hp: Object.fromEntries(law.slice(0, 2).map(x => [x.id, Math.round(x.health)])),
        demand: w.bounty, houseId: w.houseId, remainingMinutes: 0,
        log: [`${law.map(x => fullName(x)).slice(0, 2).join(' et ')} te barrent la route : « Au nom de ${state.orgs[w.houseId].name}, tu es en état d'arrestation (${w.reason}). »`], round: 0,
      };
      continue;
    }
    arrestNpc(state, c, law.slice(0, 2), sid);
  }
}

export function arrestNpc(state: GameState, c: Character, law: Character[], sid: string): boolean {
  const a = law.map(fighterOf), b = [fighterOf(c)];
  // un criminel nettement plus faible se rend
  if (strength(b) < strength(a) * 0.6 && !chance(state, 0.2)) { jail(state, c, sid, 7, 'arrêté sans résistance'); return true; }
  const r = autoBattle(state, a, b, 6);
  for (const id of applyWounds(state, [...a, ...b], 0.05)) killCharacter(state, state.characters[id], 'lors d’une arrestation');
  if (!c.alive) return true;
  if (r.winner === 'a') { jail(state, c, sid, 10, 'arrêté après une rixe'); return true; }
  const w = wantedFor(state, c.id);
  if (w) w.bounty += 15;
  logEvent(state, { type: 'arrest', actorId: c.id, locationId: c.locationId, importance: 2,
    text: `${fullName(c)} échappe aux gardes de ${state.settlements[sid].name} après une échauffourée.`, witnesses: charactersAt(state, c.locationId, true).map(x => x.id) });
  for (const l of law) modifyRelation(state, l.id, c.id, -10, -10);
  return false;
}

/** Chaque jour : le geôlier achète du pain pour les prisonniers affamés. */
export function feedPrisoners(state: GameState): void {
  for (const c of aliveCharacters(state)) {
    if (!isJailed(state, c) || c.needs.hunger < 50) continue;
    const sid = state.locations[c.locationId]?.kind === 'road' ? settlementIdOf(state, c.homeId) : settlementIdOf(state, c.locationId);
    // phase 6 : le prisonnier mange d'abord ce qu'il a sur lui
    if (qty(c.inventory, 'bread') + qty(c.inventory, 'grain') > 0) { eat(state, c); continue; }
    const manor = manorOf(state, sid);
    // pain, ou à défaut grain pour la bouillie (le moins cher des deux)
    const offers = (['bread', 'grain'] as const).flatMap(item => businessesIn(state, sid)
      .filter(b => b.sells.includes(item) && b.kind !== 'manor' && qty(b.stock, item) > 0)
      .map(b => ({ b, item, price: askPrice(state, b, item) })))
      .sort((x, y) => x.price - y.price || (x.b.id < y.b.id ? -1 : 1));
    const o = offers[0];
    if (!o) continue;
    // la ration est payée par l'intendance, sinon par la maison seigneuriale, sinon par le prisonnier
    const house = state.orgs[state.settlements[sid]?.lordHouseId ?? ''];
    const payer = manor.treasury >= o.price ? P.b(manor.id) : house && house.treasury >= o.price ? P.o(house.id) : c.money >= o.price ? P.c(c.id) : undefined;
    if (payer) {
      if (payer.t !== 'c') transferMoney(state, payer, P.c(c.id), o.price);
      if (trade(state, P.c(c.id), P.b(o.b.id), o.item, 1, o.price)) eat(state, c);
      continue;
    }
    // personne ne peut payer : un grenier qui déborde donne la ration (charité)
    const giver = offers.find(x => qty(x.b.stock, x.item) > (x.b.targets[x.item] ?? 0) * 1.2);
    if (giver && transferItem(state, P.b(giver.b.id), P.c(c.id), giver.item, 1)) eat(state, c);
  }
}

/** Prime versée par la maison qui l'a promise. */
export function payBounty(state: GameState, hunter: Character, criminal: Character): number {
  const w = wantedFor(state, criminal.id);
  if (!w) return 0;
  const house = state.orgs[w.houseId];
  const pay = Math.min(w.bounty, house.treasury);
  if (pay > 0) transferMoney(state, P.o(house.id), P.c(hunter.id), pay);
  state.wanted = state.wanted.filter(x => x !== w);
  if (house.leaderId) modifyRelation(state, house.leaderId, hunter.id, 6, 8);
  return pay;
}

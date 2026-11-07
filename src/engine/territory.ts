// ─────────────────────────────────────────────────────────────
// Territoires (phase 3) : prospérité des localités, relevés hebdomadaires, déménagements.
// ─────────────────────────────────────────────────────────────
import { isHiring } from './economy';
import { logEvent } from './events';
import { chance } from './rng';
import { toDate } from './time';
import { localPrices } from './sim';
import type { GameState, Settlement } from './types';
import { businessesIn, clamp, fullName, hasTrait, locationsIn, residents, roadPath } from './util';

/** Indice de prospérité (0..100) calculé à partir de l'état réel de la localité. */
export function computeProsperity(state: GameState, st: Settlement): number {
  const pop = residents(state, st.id);
  if (!pop.length) return 0;
  const employed = pop.filter(c => c.employerId).length / pop.length;
  const fed = 1 - pop.reduce((s, c) => s + c.needs.hunger, 0) / pop.length / 100;
  const wealth = Math.min(1, pop.reduce((s, c) => s + c.money, 0) / pop.length / 150);
  const biz = Math.min(1, businessesIn(state, st.id).filter(b => b.kind !== 'manor').reduce((s, b) => s + b.treasury, 0) / pop.length / 200);
  return Math.round(clamp(employed * 30 + fed * 25 + wealth * 20 + (st.infrastructure / 100) * 15 + biz * 10, 0, 100));
}

export function prosperityLabel(p: number): string {
  if (p >= 70) return 'Florissante';
  if (p >= 55) return 'Prospère';
  if (p >= 40) return 'Modeste';
  if (p >= 25) return 'En difficulté';
  return 'Misérable';
}

/** Chaque lundi : relevé de chaque localité, alertes, et départ des chômeurs vers les lieux qui embauchent. */
export function weeklyTerritories(state: GameState): void {
  const day = toDate(state.time).day;
  for (const sid of state.settlementOrder) {
    const st = state.settlements[sid];
    const before = st.history.length >= 4 ? st.history[st.history.length - 4].prosperity : undefined;
    st.prosperity = computeProsperity(state, st);
    const pop = residents(state, sid);
    st.history.push({ day, prosperity: st.prosperity, population: pop.length, employed: pop.filter(c => c.employerId).length, prices: localPrices(state, sid) });
    if (st.history.length > 52) st.history.shift();
    if (before !== undefined && Math.abs(st.prosperity - before) >= 12) {
      logEvent(state, {
        type: 'production', locationId: st.squareId, importance: 2,
        text: st.prosperity > before
          ? `${st.name} relève la tête : la prospérité passe de ${before} à ${st.prosperity} en un mois.`
          : `${st.name} s'appauvrit : la prospérité tombe de ${before} à ${st.prosperity} en un mois.`,
        witnesses: pop.map(c => c.id),
      });
    }
  }
  relocations(state);
}

/** Un chômeur qui n'a plus d'espoir sur place part tenter sa chance ailleurs. */
function relocations(state: GameState): void {
  for (const sid of state.settlementOrder) {
    const hiringHere = businessesIn(state, sid).some(b => isHiring(state, b));
    if (hiringHere) continue;
    for (const c of residents(state, sid)) {
      if (c.employerId || c.age >= 55 || c.money < 15 || hasTrait(c, 'loyal')) continue;
      if (Object.values(state.businesses).some(b => b.ownerId === c.id)) continue;
      if (c.activity.kind === 'travel') continue;
      const dest = state.settlementOrder
        .filter(o => o !== sid && businessesIn(state, o).some(b => isHiring(state, b)))
        .map(o => state.settlements[o])
        .sort((a, b) => b.prosperity - a.prosperity)[0];
      if (!dest || !chance(state, 0.5)) continue;
      const path = roadPath(state, sid, dest.id);
      if (!path) continue;
      const house = locationsIn(state, dest.id, 'houses')[0]?.id ?? dest.squareId;
      c.homeId = house;
      c.locationId = path.roads[0].locationId;
      c.activity = { kind: 'travel', locationId: c.locationId, since: state.time, until: state.time + path.hours * 60, targetId: dest.squareId, note: `Part s'installer à ${dest.name}` };
      c.goal = { kind: 'trouver_emploi' };
      logEvent(state, {
        type: 'move', actorId: c.id, locationId: state.settlements[sid].squareId, importance: 2,
        text: `${fullName(c)}, sans travail à ${state.settlements[sid].name}, part s'installer à ${dest.name} où l'on embauche.`,
        witnesses: residents(state, sid).map(x => x.id),
      });
      break; // un départ par localité et par semaine
    }
  }
}

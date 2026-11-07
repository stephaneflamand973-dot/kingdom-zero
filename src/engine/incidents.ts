// ─────────────────────────────────────────────────────────────
// Phase 6 — Aléas du monde : météo, épidémies, incendies, récoltes,
// foires. Chaque aléa a des effets mécaniques réels (rendements,
// maladies, stocks détruits, prix) et une durée ; rien n'est décoratif.
// ─────────────────────────────────────────────────────────────
import { ITEMS } from './data';
import { askPrice, P, trade, transferMoney } from './economy';
import { logEvent } from './events';
import { chance, pick, randInt } from './rng';
import { toDate } from './time';
import type { Business, GameState, Incident, IncidentKind, ItemId } from './types';
import { addItem, aliveCharacters, businessesIn, fullName, qty, residents, roadPath, settlementIdOf } from './util';

export const INCIDENT_NAMES: Record<IncidentKind, string> = {
  secheresse: 'Sécheresse', recolte: 'Récolte abondante', grand_froid: 'Grand froid',
  epidemie: 'Épidémie', incendie: 'Incendie', foire: 'Foire',
};
export const INCIDENT_EFFECTS: Record<IncidentKind, string> = {
  secheresse: 'rendement des fermes −45 %',
  recolte: 'rendement des fermes +40 %',
  grand_froid: 'un fagot par jour et par foyer, le froid blesse',
  epidemie: 'risque de maladie ×5',
  incendie: 'stocks partis en fumée',
  foire: 'prix de vente −10 %, affluence à la taverne',
};

export function activeIncidents(state: GameState, settlementId?: string): Incident[] {
  const day = toDate(state.time).day;
  return (state.incidents ?? []).filter(i => i.fromDay <= day && i.toDay >= day && (!settlementId || i.settlementId === settlementId));
}
export function hasIncident(state: GameState, settlementId: string, kind: IncidentKind): boolean {
  return activeIncidents(state, settlementId).some(i => i.kind === kind);
}

/** Multiplicateur de rendement des fermes dû aux aléas. */
export function incidentYield(state: GameState, b: Business): number {
  if (b.kind !== 'farm' || !state.incidents?.length) return 1;
  const sid = settlementIdOf(state, b.locationId);
  return hasIncident(state, sid, 'secheresse') ? 0.55 : hasIncident(state, sid, 'recolte') ? 1.4 : 1;
}
/** Multiplicateur de prix de vente (la foire fait jouer la concurrence). */
export function incidentPrice(state: GameState, b: Business): number {
  if (!state.incidents?.length) return 1;
  return hasIncident(state, settlementIdOf(state, b.locationId), 'foire') ? 0.9 : 1;
}
export function epidemicFactor(state: GameState, settlementId: string): number {
  return state.incidents?.length && hasIncident(state, settlementId, 'epidemie') ? 5 : 1;
}

function witnessesOf(state: GameState, sid: string): string[] {
  return aliveCharacters(state).filter(c => settlementIdOf(state, c.locationId) === sid || settlementIdOf(state, c.homeId) === sid).map(c => c.id);
}

function start(state: GameState, sid: string, kind: IncidentKind, days: number, text: string, businessId?: string): void {
  const day = toDate(state.time).day;
  state.incidents ??= [];
  state.idSeq += 1;
  state.incidents.push({ id: `inc${state.idSeq}`, kind, settlementId: sid, fromDay: day, toDay: day + days - 1, businessId });
  logEvent(state, { type: 'incident', importance: kind === 'incendie' || kind === 'epidemie' ? 3 : 2, locationId: state.settlements[sid].squareId,
    businessId, text, witnesses: witnessesOf(state, sid), data: { kind, settlementId: sid, days } });
}

/** Tirage quotidien des aléas, localité par localité. */
export function dailyIncidents(state: GameState): void {
  state.incidents ??= [];
  const d = toDate(state.time);
  state.incidents = state.incidents.filter(i => i.toDay >= d.day - 1);
  state.settlementOrder.forEach((sid, idx) => {
    const st = state.settlements[sid];
    const on = (k: IncidentKind) => hasIncident(state, sid, k);
    // Météo saisonnière
    if (d.season === 1 && d.dayOfSeason >= 3 && d.dayOfSeason <= 18 && !on('secheresse') && chance(state, 0.025)) {
      start(state, sid, 'secheresse', 12, `La sécheresse frappe ${st.name} : les blés jaunissent sur pied.`);
    }
    if (d.season === 2 && d.dayOfSeason <= 14 && !on('recolte') && !on('secheresse') && chance(state, 0.03)) {
      start(state, sid, 'recolte', 10, `Les moissons de ${st.name} sont exceptionnelles cette année.`);
    }
    if (d.season === 3 && !on('grand_froid') && chance(state, 0.035)) {
      start(state, sid, 'grand_froid', 6, `Un froid mordant s'abat sur ${st.name} : les puits gèlent.`);
    }
    // Épidémie : l'insalubrité et l'hiver la favorisent
    const pEpi = 0.0015 + (st.infrastructure < 40 ? 0.004 : 0) + (d.season === 3 ? 0.002 : 0);
    if (!on('epidemie') && chance(state, pEpi)) {
      start(state, sid, 'epidemie', 12, `Une fièvre maligne se répand à ${st.name}.`);
    }
    // Foire annuelle : chaque localité a la sienne, à une saison différente
    if (d.season === idx % 4 && d.dayOfSeason === 21 && !on('foire')) {
      start(state, sid, 'foire', 3, `La grande foire de ${st.name} s'ouvre pour trois jours : étals, jongleurs et bonnes affaires.`);
    }
    // Incendie : un atelier part en fumée (les stocks sont réellement détruits)
    if (chance(state, 0.0025)) {
      const targets = businessesIn(state, sid).filter(b => b.kind !== 'manor' && Object.keys(b.stock).length > 0);
      if (targets.length) burn(state, sid, pick(state, targets));
    }
  });
}

export function burn(state: GameState, sid: string, b: Business): number {
  let lost = 0;
  const parts: string[] = [];
  for (const it of Object.keys(b.stock) as ItemId[]) {
    const k = Math.floor(qty(b.stock, it) * randInt(state, 30, 60) / 100);
    if (k <= 0) continue;
    addItem(b.stock, it, -k);
    addItem(state.ledger.consumed, it, k);
    lost += k;
    parts.push(`${k} ${k > 1 ? ITEMS[it].plural : ITEMS[it].name}`);
  }
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  start(state, sid, 'incendie', 1,
    `Le feu prend à ${b.name}${owner ? ` (${fullName(owner)})` : ''}${parts.length ? ` : ${parts.join(', ')} partent en fumée` : ''}.`, b.id);
  return lost;
}

/**
 * Convoi de grain d'urgence : quand une localité n'a presque plus de vivres alors que des gens ont faim,
 * son marché (aidé au besoin par l'intendance) achète du grain dans la localité voisine la mieux pourvue.
 * L'argent et le grain changent réellement de mains ; le surcoût de transport est payé au vendeur.
 */
export function grainConvoy(state: GameState, sid: string): number {
  const day = toDate(state.time).day;
  const st = state.settlements[sid];
  if (st.convoyDay !== undefined && day - st.convoyDay < 5) return 0;
  const pop = residents(state, sid);
  const local = businessesIn(state, sid).reduce((a, b) => a + qty(b.stock, 'bread') + qty(b.stock, 'grain'), 0);
  const hungry = pop.filter(c => c.needs.hunger > 50 && qty(c.inventory, 'bread') + qty(c.inventory, 'grain') === 0).length;
  if (local >= pop.length * 3 || hungry < 2) return 0;
  const market = businessesIn(state, sid).find(b => b.kind === 'market');
  if (!market) return 0;
  const manor = state.businesses[st.manorId];
  let need = pop.length * 4 - local;
  let bought = 0;
  // on n'achète qu'à une localité elle-même bien pourvue, et seulement son vrai surplus (pas ses réserves d'hiver)
  const wellFed = (o: string) => businessesIn(state, o).reduce((a, b) => a + qty(b.stock, 'bread') + qty(b.stock, 'grain'), 0) >= residents(state, o).length * 8;
  const sources = state.settlementOrder.filter(o => o !== sid && roadPath(state, sid, o) && wellFed(o))
    .flatMap(o => businessesIn(state, o).filter(b => (b.kind === 'farm' || b.kind === 'market') && b.sells.includes('grain')))
    .map(b => ({ b, spare: qty(b.stock, 'grain') - (b.targets.grain ?? 0) }))
    .filter(x => x.spare > 0)
    .sort((x, y) => y.spare - x.spare || (x.b.id < y.b.id ? -1 : 1));
  const from: string[] = [];
  for (const { b, spare } of sources) {
    if (need <= 0) break;
    const price = askPrice(state, b, 'grain') + 2; // transport
    let n = Math.min(need, spare);
    // l'intendance avance l'argent si le marché n'a pas de quoi payer
    const lack = n * price - market.treasury;
    if (lack > 0) transferMoney(state, P.b(manor.id), P.b(market.id), Math.min(lack, Math.max(0, manor.treasury - 40)));
    n = Math.min(n, Math.floor(market.treasury / price));
    if (n <= 0 || !trade(state, P.b(market.id), P.b(b.id), 'grain', n, price)) continue;
    need -= n; bought += n;
    from.push(state.settlements[settlementIdOf(state, b.locationId)].name);
  }
  if (bought > 0) {
    st.convoyDay = day;
    logEvent(state, { type: 'help', importance: 2, locationId: st.squareId, businessId: market.id,
      text: `Un convoi d'urgence apporte ${bought} boisseaux de grain de ${[...new Set(from)].join(' et ')} au marché de ${st.name}, où ${hungry} personnes ont faim.`,
      witnesses: pop.map(c => c.id) });
  }
  return bought;
}

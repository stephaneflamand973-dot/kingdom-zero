// ─────────────────────────────────────────────────────────────
// Phase 6 — Aléas du monde : météo, épidémies, incendies, récoltes,
// foires. Chaque aléa a des effets mécaniques réels (rendements,
// maladies, stocks détruits, prix) et une durée ; rien n'est décoratif.
// ─────────────────────────────────────────────────────────────
import { ITEMS } from './data';
import { askPrice, P, trade, transferMoney } from './economy';
import { ownedBusinesses, transferBusiness } from './finance';
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
 * Commerce de grain (phase 6). Le marché d'une localité qui manque de vivres achète du grain à une localité
 * voisine qui a un vrai surplus : chaque lundi pour s'approvisionner, et à tout moment (tous les cinq jours
 * au plus) quand des gens ont faim — l'intendance avance alors l'argent si le marché n'a pas de quoi payer.
 * Le grain est payé au départ, retiré du grenier vendeur et voyage physiquement sur la route : il n'arrive
 * qu'au bout du trajet réel. Renvoie la quantité expédiée.
 */
export function grainConvoy(state: GameState, sid: string, routine = false): number {
  const d = toDate(state.time);
  const st = state.settlements[sid];
  const pop = residents(state, sid);
  if (!pop.length) return 0;
  const local = businessesIn(state, sid).reduce((a, b) => a + qty(b.stock, 'bread') + qty(b.stock, 'grain'), 0);
  const inTransit = (state.convoys ?? []).filter(c => c.to === sid).reduce((a, c) => a + qty(c.cargo, 'grain'), 0);
  const hungry = pop.filter(c => c.needs.hunger > 50 && qty(c.inventory, 'bread') + qty(c.inventory, 'grain') === 0).length;
  const urgent = !routine && hungry >= 2 && local + inTransit < pop.length * 3;
  if (urgent && st.convoyDay !== undefined && d.day - st.convoyDay < 5) return 0;
  if (!urgent && !(routine && local + inTransit < pop.length * 6)) return 0;
  const market = businessesIn(state, sid).find(b => b.kind === 'market');
  if (!market) return 0;
  const manor = state.businesses[st.manorId];
  let need = pop.length * (urgent ? 4 : 7) - local - inTransit;
  if (need <= 0) return 0;
  // on n'achète qu'à une localité elle-même bien pourvue, et seulement son vrai surplus (pas ses réserves d'hiver)
  const wellFed = (o: string) => businessesIn(state, o).reduce((a, b) => a + qty(b.stock, 'bread') + qty(b.stock, 'grain'), 0) >= residents(state, o).length * 8;
  const sources = state.settlementOrder.filter(o => o !== sid && roadPath(state, o, sid) && wellFed(o))
    .flatMap(o => businessesIn(state, o).filter(b => (b.kind === 'farm' || b.kind === 'market') && b.sells.includes('grain')))
    .map(b => ({ b, spare: qty(b.stock, 'grain') - (b.targets.grain ?? 0) }))
    .filter(x => x.spare > 0)
    .sort((x, y) => y.spare - x.spare || (x.b.id < y.b.id ? -1 : 1));
  let sent = 0;
  for (const { b, spare } of sources) {
    if (need <= 0) break;
    const price = askPrice(state, b, 'grain') + 2; // transport
    let n = Math.min(need, spare);
    if (urgent) {
      // l'intendance avance l'argent si le marché n'a pas de quoi payer
      const lack = n * price - market.treasury;
      if (lack > 0) transferMoney(state, P.b(manor.id), P.b(market.id), Math.min(lack, Math.max(0, manor.treasury - 20)));
      n = Math.min(n, Math.floor(market.treasury / price));
    } else {
      n = Math.min(n, Math.floor((market.treasury - 60) / price)); // un achat de routine garde une réserve
    }
    if (n <= 0 || !trade(state, P.b(market.id), P.b(b.id), 'grain', n, price)) continue;
    // le grain quitte l'étal du marché acheteur (où trade l'a déposé) pour voyager sur la route
    addItem(market.stock, 'grain', -n);
    const from = settlementIdOf(state, b.locationId);
    const hours = roadPath(state, from, sid)!.hours;
    state.convoys ??= [];
    state.idSeq += 1;
    state.convoys.push({ id: `cv${state.idSeq}`, from, to: sid, marketId: market.id, cargo: { grain: n }, departTime: state.time, arriveTime: state.time + hours * 60, urgent });
    logEvent(state, { type: 'caravan', importance: urgent ? 2 : 1, locationId: st.squareId, businessId: market.id,
      text: urgent
        ? `Un convoi d'urgence de ${n} boisseaux de grain part de ${state.settlements[from].name} pour ${st.name}, où ${hungry} personnes ont faim (${hours} h de route).`
        : `${market.name} fait venir ${n} boisseaux de grain de ${state.settlements[from].name} (${hours} h de route).`,
      witnesses: pop.map(c => c.id) });
    need -= n; sent += n;
  }
  if (sent > 0 && urgent) st.convoyDay = d.day;
  return sent;
}

/** Arrivée des convois : la cargaison rejoint l'étal du marché destinataire. */
export function processConvoys(state: GameState): void {
  if (!state.convoys?.length) return;
  const arrived = state.convoys.filter(c => c.arriveTime <= state.time);
  if (!arrived.length) return;
  state.convoys = state.convoys.filter(c => c.arriveTime > state.time);
  for (const c of arrived) {
    const market = state.businesses[c.marketId];
    const n = qty(c.cargo, 'grain');
    // la cargaison est transférée telle quelle (aucun objet créé ni perdu)
    for (const [k, v] of Object.entries(c.cargo)) addItem(market.stock, k as ItemId, v!);
    c.cargo = {};
    logEvent(state, { type: 'caravan', importance: c.urgent ? 2 : 1, locationId: market.locationId, businessId: market.id,
      text: `Le convoi de ${state.settlements[c.from].name} arrive : ${n} boisseaux de grain garnissent ${market.name}.`,
      witnesses: residents(state, c.to).map(x => x.id) });
  }
}

/**
 * Gérance (phase 6) : chaque lundi, l'intendance confie une affaire restée sans propriétaire au chômeur
 * le plus capable de la localité. L'affaire garde sa caisse ; le gérant la dirige et peut embaucher.
 */
export function weeklyStewardship(state: GameState): void {
  for (const id of state.businessOrder) {
    const b = state.businesses[id];
    if (b.ownerId || b.kind === 'manor') continue;
    const sid = settlementIdOf(state, b.locationId);
    const pick = residents(state, sid)
      .filter(c => !c.employerId && !c.masterId && c.age >= 18 && c.age < 60 && c.profession !== 'seigneur' && c.profession !== 'soldat'
        && (c.jailedUntil ?? 0) <= state.time && !ownedBusinesses(state, c).length)
      .sort((a, x) => x.skills.gestion - a.skills.gestion || (a.id < x.id ? -1 : 1))[0];
    if (!pick) continue;
    transferBusiness(state, b, pick);
    logEvent(state, { type: 'inheritance', actorId: pick.id, businessId: b.id, importance: 2, locationId: b.locationId,
      text: `L'intendance de ${state.settlements[sid].name} confie ${b.name} en gérance à ${fullName(pick)}.`, witnesses: residents(state, sid).map(c => c.id) });
  }
}

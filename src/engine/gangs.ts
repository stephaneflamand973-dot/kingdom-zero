// ─────────────────────────────────────────────────────────────
// Criminalité organisée (phase 4) : la bande recrute en secret, tend des embuscades
// sur les routes, rançonne les commerces et saccage ceux qui refusent.
// Les autorités n'en savent que ce que les victimes et les témoins rapportent.
// ─────────────────────────────────────────────────────────────
import { applyWounds, autoBattle, fighterOf } from './combat';
import { ITEMS, ITEM_IDS } from './data';
import { P, transferMoney } from './economy';
import { getEvent, logEvent } from './events';
import { addWanted } from './justice';
import { houseOf, isJailed, joinOrg, orgList } from './orgs';
import { chance, rand } from './rng';
import { killCharacter } from './sim';
import { modifyRelation, getRelation } from './social';
import { toDate } from './time';
import type { Character, GameState, Organization, Road } from './types';
import { addItem, businessesIn, charactersAt, fullName, hasTrait, qty, residents } from './util';

/** Membres libres d'une bande (ni en prison, ni en voyage, en état de se battre). */
export function freeMembers(state: GameState, g: Organization): Character[] {
  return g.members.map(id => state.characters[id])
    .filter(c => c && c.alive && !c.isPlayer && !isJailed(state, c) && c.activity.kind !== 'travel' && c.health > 35);
}

/** Bandes qui opèrent sur une route (le repaire est dans une localité reliée par cette route). */
export function gangsOnRoad(state: GameState, road: Road): Organization[] {
  return orgList(state, 'gang').filter(g => g.seatId === road.a || g.seatId === road.b);
}

export function lawOnRoad(state: GameState, road: Road): Character[] {
  return charactersAt(state, road.locationId).filter(c => c.activity.kind === 'patrol' && (c.profession === 'soldat' || c.profession === 'garde'));
}

/** Probabilité d'embuscade par heure de route. */
export function ambushRisk(state: GameState, road: Road): number {
  let p = 0;
  for (const g of gangsOnRoad(state, road)) {
    const n = freeMembers(state, g).length;
    if (n < 2 || g.heat >= 90) continue; // trop recherchée, la bande se terre
    p += 0.03 * Math.min(2, n / 2);
  }
  const patrol = lawOnRoad(state, road).length;
  return p * (patrol ? 0.25 : 1);
}

/** Le témoin reconnaît-il un des agresseurs ? (perception, et connaître la personne) */
function recognized(state: GameState, witness: Character, bandits: Character[]): Character | undefined {
  return bandits.find(b => witness.relations[b.id] !== undefined && chance(state, 0.25 + witness.attributes.perception * 0.05))
    ?? bandits.find(() => chance(state, 0.1));
}

/** Pendant le trajet d'une caravane, une heure de route peut tourner à l'embuscade. */
export function caravanAmbushes(state: GameState): void {
  for (const cv of state.caravans) {
    if (cv.status !== 'en_route' || cv.ambushed) continue;
    const m = state.characters[cv.merchantId];
    const road = state.roads.find(r => r.locationId === m.locationId);
    if (!road || !chance(state, ambushRisk(state, road))) continue;
    const gang = gangsOnRoad(state, road).find(g => freeMembers(state, g).length >= 2);
    if (!gang) continue;
    cv.ambushed = true;
    const bandits = freeMembers(state, gang).slice(0, 3);
    for (const b of bandits) { b.locationId = road.locationId; b.activity = { kind: 'ambush', locationId: road.locationId, since: state.time, note: 'Guette sur la route' }; }
    const defenders = [m, ...lawOnRoad(state, road)];
    const A = bandits.map(fighterOf), D = defenders.map(fighterOf);
    const r = autoBattle(state, A, D, 6);
    const dead = applyWounds(state, [...A, ...D], 0.15);
    const culprit = recognized(state, m, bandits);
    let text: string;
    if (r.winner === 'a') {
      const loot: string[] = [];
      for (const it of ITEM_IDS) {
        const n = Math.floor(qty(cv.cargo, it) / 2);
        if (n > 0) { addItem(cv.cargo, it, -n); addItem(gang.stash, it, n); loot.push(`${n} ${ITEMS[it].plural}`); }
      }
      const cash = Math.floor(m.money / 2);
      if (cash > 0) transferMoney(state, P.c(m.id), P.o(gang.id), cash);
      gang.heat += 20;
      text = `Des brigands attaquent la caravane de ${fullName(m)} sur ${state.locations[road.locationId].name} et emportent ${[...loot, cash ? `${cash} d` : ''].filter(Boolean).join(', ') || 'presque rien'}.`;
    } else {
      gang.heat += 10;
      text = `La caravane de ${fullName(m)} repousse des brigands sur ${state.locations[road.locationId].name}.`;
    }
    const ev = logEvent(state, {
      type: 'ambush', actorId: culprit?.id, targetId: m.id, locationId: road.locationId, importance: 3,
      text: culprit ? `${text} ${fullName(m)} a reconnu ${fullName(culprit)}.` : text,
      witnesses: defenders.map(d => d.id).concat(bandits.map(b => b.id)), data: { gang: gang.id },
    });
    for (const id of dead) killCharacter(state, state.characters[id], 'dans une embuscade');
    // les bandits regagnent leurs foyers
    for (const b of bandits) if (b.alive) { b.locationId = b.homeId; b.activity = { kind: 'idle', locationId: b.homeId, since: state.time, note: 'Rentre discrètement' }; }
    // la victime portera plainte en arrivant ; si elle a reconnu quelqu'un, il sera recherché
    if (culprit && m.alive) addWanted(state, culprit.id, cv.to, 'brigandage', 60);
    const house = houseOf(state, cv.to);
    if (house) { if (!house.patrolRoads.includes(road.locationId)) house.patrolRoads.push(road.locationId); house.heat += 15; }
    void ev; // l'événement reste dans la chronique (témoins : marchand, soldiers, bandits)
  }
}

/** Hebdomadaire : recrutement, racket, partage du butin, discrétion. */
export function weeklyGangs(state: GameState): void {
  for (const g of orgList(state, 'gang')) {
    g.heat = Math.max(0, g.heat - 15);
    const leader = g.leaderId ? state.characters[g.leaderId] : undefined;
    if (!leader || !leader.alive) continue;
    recruit(state, g);
    if (!isJailed(state, leader) && g.heat < 70) racket(state, g, leader);
    sellLoot(state, g);
    // partage : la moitié du trésor aux membres libres (le chef garde double part)
    const free = freeMembers(state, g);
    const pot = Math.floor(g.treasury / 2);
    if (pot >= free.length + 1 && free.length) {
      const shares = free.length + (free.includes(leader) ? 1 : 0);
      const each = Math.floor(pot / shares);
      for (const c of free) transferMoney(state, P.o(g.id), P.c(c.id), each * (c.id === leader.id ? 2 : 1));
    }
  }
}

function recruit(state: GameState, g: Organization): void {
  const members = new Set(g.members);
  const candidates = residents(state, g.seatId).concat(...state.settlementOrder.filter(s => s !== g.seatId).map(s => residents(state, s)))
    .filter(c => !members.has(c.id) && !c.employerId && !hasTrait(c, 'honnete') && !isJailed(state, c) && c.age >= 16 && c.age < 50)
    .filter(c => hasTrait(c, 'malhonnete') || (c.money < 5 && c.needs.hunger > 60))
    .filter(c => [...members].some(m => getRelation(state, c.id, m).affinity >= 0))
    .filter(c => !orgList(state, 'house').some(h => h.members.includes(c.id)));
  const c = candidates[0];
  if (!c || !chance(state, 0.5)) return;
  joinOrg(state, g, c, 'membre');
  // un secret : seuls les membres le savent
  logEvent(state, { type: 'recruit', actorId: c.id, targetId: g.leaderId ?? undefined, importance: 2,
    text: `${fullName(c)} rejoint en secret ${g.name}.`, witnesses: g.members.slice() });
}

/** Rançonner un commerce : payer, ou subir un saccage. Le chef se montre en personne. */
function racket(state: GameState, g: Organization, leader: Character): void {
  const free = freeMembers(state, g);
  if (free.length < 2) return;
  const targets = businessesIn(state, g.seatId).filter(b => b.kind !== 'manor' && b.ownerId && !g.members.includes(b.ownerId) && b.treasury > 40);
  const b = targets[Math.floor(rand(state) * targets.length)];
  if (!b) return;
  const owner = state.characters[b.ownerId!];
  const demand = 10 + 5 * free.length;
  const lawmen = residents(state, g.seatId).filter(c => c.profession === 'garde' || c.profession === 'soldat').length;
  const afraid = lawmen < free.length || hasTrait(owner, 'timide') || hasTrait(owner, 'prudent');
  if (afraid && b.treasury >= demand) {
    transferMoney(state, P.b(b.id), P.o(g.id), demand);
    modifyRelation(state, owner.id, leader.id, -10, -15);
    logEvent(state, { type: 'racket', actorId: leader.id, targetId: owner.id, businessId: b.id, importance: 2,
      text: `${fullName(leader)} exige ${demand} d de ${fullName(owner)} pour « protéger » ${b.name} ; ${owner.firstName} paie, la peur au ventre.`,
      witnesses: [owner.id, leader.id] });
    return;
  }
  // Refus : saccage nocturne d'une partie du stock (biens détruits), et plainte contre le chef
  const it = ITEM_IDS.filter(i => qty(b.stock, i) > 0).sort((x, y) => qty(b.stock, y) * ITEMS[y].base - qty(b.stock, x) * ITEMS[x].base)[0];
  const n = it ? Math.max(1, Math.floor(qty(b.stock, it) / 4)) : 0;
  if (it && n) { addItem(b.stock, it, -n); addItem(state.ledger.consumed, it, n); }
  g.heat += 15;
  logEvent(state, { type: 'vandalism', targetId: owner.id, businessId: b.id, locationId: b.locationId, importance: 2,
    text: `${fullName(owner)} a refusé de payer ${fullName(leader)} : la nuit suivante, ${b.name} est saccagé${it ? ` (${n} ${ITEMS[it].plural} détruits)` : ''}.`,
    witnesses: [owner.id], data: { gang: g.id } });
  modifyRelation(state, owner.id, leader.id, -25, -40);
  addWanted(state, leader.id, g.seatId, 'racket et saccage', 50);
}

/** La bande écoule son butin auprès d'un receleur (le marché d'une autre localité). */
function sellLoot(state: GameState, g: Organization): void {
  const other = state.settlementOrder.find(s => s !== g.seatId);
  const fence = other ? businessesIn(state, other).find(b => b.kind === 'market') : undefined;
  if (!fence) return;
  for (const it of ITEM_IDS) {
    const n = Math.min(qty(g.stash, it), Math.floor(fence.treasury / Math.max(1, Math.round(ITEMS[it].base * 0.5))));
    if (n <= 0) continue;
    const price = Math.max(1, Math.round(ITEMS[it].base * 0.5)); // recel : moitié prix
    transferMoney(state, P.b(fence.id), P.o(g.id), n * price);
    addItem(g.stash, it, -n);
    addItem(fence.stock, it, n);
  }
}

/** La rumeur d'une embuscade connue d'un seigneur ou d'un intendant déclenche des patrouilles. */
export function lordKnowsAmbushes(state: GameState, house: Organization): string[] {
  const lord = house.leaderId ? state.characters[house.leaderId] : undefined;
  if (!lord) return [];
  const day = toDate(state.time).day;
  return lord.knownEvents.map(id => getEvent(state, id)).filter(e => e && e.type === 'ambush' && toDate(e.time).day >= day - 21)
    .map(e => e!.locationId!).filter(Boolean);
}


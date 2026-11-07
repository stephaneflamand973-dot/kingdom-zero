// ─────────────────────────────────────────────────────────────
// Simulation temporelle.
// Le temps avance en minutes ; le monde est résolu à chaque frontière d'heure
// franchie (résolution horaire), puis à chaque frontière de jour.
// `processedHours` garantit qu'une heure n'est jamais simulée deux fois.
// ─────────────────────────────────────────────────────────────
import { RECIPES, WORK_ENERGY_COST, WORK_SKILL, WORK_ATTR, FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES } from './data';
import { askPrice, isHiring, laborMultiplier, manageBusiness, P, payWage, runProduction, transferItem, transferMoney, weeklyWageReview, totalMoney, referencePrice, fireEmployee } from './economy';
import { logEvent, pruneEvents } from './events';
import { maxWorkHours, npcDecide } from './npc';
import { chance, pick, randInt } from './rng';
import { gainXp } from './skills';
import { modifyRelation, socialHour } from './social';
import { MIN_PER_DAY, MIN_PER_HOUR, START_OFFSET_MIN, toDate, DAYS_PER_YEAR } from './time';
import type { Character, GameState, Inventory, ItemId } from './types';
import { addItem, aliveCharacters, allBusinesses, businessesIn, businessSettlement, clamp, fullName, hasTrait, hereSettlement, homeSettlement, locationsIn, manorOf, newId, npcs, qty, residents, settlementIdOf } from './util';
import { merchantsPlanTrips, processCaravans } from './trade';
import { collectRents } from './property';
import { weeklyTerritories } from './territory';
import { onDeathOrgs, orgsOf } from './orgs';
import { feedPrisoners, hourlyJustice } from './justice';
import { caravanAmbushes, weeklyGangs } from './gangs';
import { monthlyIntrigues, weeklyGovernance } from './nobility';
import { birthdays, dailyFamily, dailyServants, feedChildren, settleEstate, successionCandidates, weeklyCourtship } from './family';
import { npcBorrowing, ownedBusinesses, processLoans } from './finance';
import { merchantFulfils, postOrder, processOrders, weeklyContractReview } from './contracts';
import { festivalTonight, initialAmbition, jobHopping, processAmbitions, startFestivals, trySlander } from './society';
import { ITEM_IDS } from './data';

export const HUNGER_PER_HOUR = 4;
export const HEAD_TAX = 3;

export function absoluteHour(time: number): number {
  return Math.floor((time + START_OFFSET_MIN) / MIN_PER_HOUR);
}

/** Avance le temps de `minutes` et simule chaque heure franchie une seule fois. */
export function advanceTime(state: GameState, minutes: number): number {
  if (minutes < 0) throw new Error('Le temps ne recule pas');
  const end = state.time + minutes;
  let ticks = 0;
  while (!state.gameOver && !state.pendingSuccession) {
    const nextBoundary = (state.processedHours + 1) * MIN_PER_HOUR - START_OFFSET_MIN;
    if (nextBoundary > end) break;
    state.time = nextBoundary;
    state.processedHours += 1;
    hourTick(state);
    ticks++;
  }
  if (!state.gameOver && !state.pendingSuccession) state.time = end;
  return ticks;
}

// ── Besoins physiologiques ──────────────────────────────────

export function applyHourlyNeeds(state: GameState, c: Character): void {
  const a = c.activity;
  const n = c.needs;
  const sleeping = a.kind === 'sleep' || a.kind === 'jailed';
  const childFactor = c.age < 14 ? 0.7 : 1; // un enfant mange moins
  n.hunger = clamp(n.hunger + (sleeping ? HUNGER_PER_HOUR * 0.6 : HUNGER_PER_HOUR) * childFactor, 0, 100);
  if (sleeping) {
    const q = a.quality ?? 1;
    n.energy = clamp(n.energy + 12 * q * (c.sick > 0 ? 0.7 : 1), 0, 100);
    n.social = clamp(n.social - 0.5, 0, 100);
  } else if (a.kind === 'work') {
    const b = a.targetId ? state.businesses[a.targetId] : undefined;
    const cost = b ? WORK_ENERGY_COST[b.kind] : 6;
    n.energy = clamp(n.energy - cost * (1.25 - c.attributes.endurance * 0.05), 0, 100);
    n.social = clamp(n.social - 1, 0, 100);
  } else if (a.kind === 'train') {
    n.energy = clamp(n.energy - 9, 0, 100);
    n.social = clamp(n.social - 1.5, 0, 100);
  } else {
    n.energy = clamp(n.energy - 2.5, 0, 100);
    n.social = clamp(n.social - (a.kind === 'socialize' || a.kind === 'talk' ? -4 : 2), 0, 100);
  }
  // Santé
  let dh = 0;
  if (n.hunger >= 100) dh -= 0.7; // une famine tue en quelques jours, pas en quelques heures
  else if (n.hunger >= 85) dh -= 0.4;
  if (n.energy <= 0) dh -= 1;
  if (c.sick > 0) { dh -= 0.5; c.sick -= 1; }
  if (dh === 0 && n.hunger < 70 && n.energy > 20) dh += 0.35;
  c.health = clamp(c.health + dh, 0, 100);
}

// ── Heure ────────────────────────────────────────────────────

export function hourTick(state: GameState): void {
  const d = toDate(state.time);
  state.stats.ticks += 1;
  const people = aliveCharacters(state);

  // 1. Conséquences de l'heure écoulée (activité en cours)
  for (const c of people) if (!(c.isPlayer && state.observer)) applyHourlyNeeds(state, c);

  // 2. Travail effectué pendant l'heure écoulée (et heures de service des soldats)
  for (const c of people) {
    if (c.alive && c.activity.kind === 'patrol') {
      for (const h of orgsOf(state, c.id, 'house')) if (h.roles[c.id] === 'soldat') h.service[c.id] = (h.service[c.id] ?? 0) + 1;
      continue;
    }
    if (c.alive && c.activity.kind === 'forage') {
      c.forageProgress += (0.45 + c.skills.agriculture / 160 + c.attributes.endurance * 0.02) * (c.sick > 0 ? 0.5 : 1);
      while (c.forageProgress >= 1) {
        c.forageProgress -= 1;
        addItem(c.inventory, 'wood', 1);
        addItem(state.ledger.produced, 'wood', 1);
      }
      gainXp(state, c, 'agriculture', 0.4);
      continue;
    }
    if (!c.alive || c.activity.kind !== 'work' || !c.activity.targetId) continue;
    const b = state.businesses[c.activity.targetId];
    if (!b) continue;
    const skill = WORK_SKILL[b.kind];
    const productivity = (0.6 + c.skills[skill] / 125 + c.attributes[WORK_ATTR[b.kind]] * 0.03)
      * (c.sick > 0 ? 0.5 : 1) * (c.needs.energy < 15 ? 0.6 : 1) * laborMultiplier(b);
    if (b.kind === 'manor') {
      const st = businessSettlement(state, b);
      if (c.profession === 'journalier' || c.isPlayer) st.infrastructure = clamp(st.infrastructure + 0.12 * productivity, 0, 100);
    } else if (RECIPES[b.kind]) {
      b.laborPool += productivity;
    }
    c.hoursWorkedToday += 1;
    if (c.isPlayer) {
      const k = state.contracts.find(x => x.status === 'active' && x.workerId === c.id && x.businessId === b.id);
      if (k) k.hoursThisWeek += 1;
    }
    gainXp(state, c, skill, 1);
    const contractWage = c.isPlayer ? state.contracts.find(k => k.status === 'active' && k.workerId === c.id && k.businessId === b.id)?.wage : undefined;
    if (b.ownerId !== c.id) payWage(state, b, c, c.isPlayer ? c.activity.wage ?? contractWage ?? b.wage : b.wage);
  }

  // 3. Production ; une pénurie d'intrant fait afficher une commande au tableau
  for (const b of allBusinesses(state)) {
    runProduction(state, b);
    for (const [item, day] of Object.entries(b.lastShortageDay)) {
      if (day === d.day && (ITEM_IDS as string[]).includes(item) && b.buys.includes(item as ItemId)) postOrder(state, b, item as ItemId);
    }
  }

  // 4. Décès éventuels
  for (const c of people) if (c.alive && c.health <= 0) killCharacter(state, c, c.needs.hunger >= 100 ? 'de faim' : c.sick > 0 ? 'de maladie' : c.needs.energy <= 0 ? "d'épuisement" : 'de privations');
  if (state.gameOver) return;

  // 5. Gestion du matin : mobilité (lundi), emprunts de survie, puis gestion
  if (d.hour === 7) {
    if (d.weekday === 0 && d.day > 0) jobHopping(state);
    npcBorrowing(state);
  }
  if (d.hour === 7 || d.hour === 13) for (const b of allBusinesses(state)) manageBusiness(state, b, d.hour === 13);
  if (d.hour === 13) merchantFulfils(state);
  if (d.hour === 17 && d.dayOfSeason === 1) startFestivals(state);
  // Phase 3 : caravanes en route et départs des marchands ; phase 4 : brigands et justice
  caravanAmbushes(state);
  processCaravans(state);
  hourlyJustice(state);
  if (d.hour === 7) merchantsPlanTrips(state);

  // 6. Démissions pour salaires impayés
  for (const c of npcs(state)) {
    const b = c.employerId ? state.businesses[c.employerId] : undefined;
    if (b && b.ownerId !== c.id && c.unpaidWages >= b.wage * (hasTrait(c, 'loyal') ? 32 : 16)) {
      fireEmployee(state, b, c, `${c.unpaidWages} d de salaires impayés`, true);
    }
  }

  // 7. Décisions des PNJ pour l'heure qui commence (et du joueur s'il vit au jour le jour)
  if (d.hour === 7 || d.hour === 18) feedChildren(state);
  for (const c of npcs(state)) npcDecide(state, c, d.hour, d.weekday);
  const me = state.characters[state.playerId];
  if (state.autopilotUntil && state.autopilotUntil > state.time && me.alive && !state.encounter) npcDecide(state, me, d.hour, d.weekday, true);

  // 8. Vie sociale : regroupement par lieu
  const groups: Record<string, Character[]> = {};
  for (const c of aliveCharacters(state)) {
    if (c.activity.kind === 'socialize') (groups[c.locationId] ??= []).push(c);
  }
  for (const id of Object.keys(groups).sort()) socialHour(state, groups[id], (a, b) => { trySlander(state, a, b); }, festivalTonight(state, id) ? 2 : 0);

  // Le joueur relève les prix de la localité où il se trouve
  const pl = state.characters[state.playerId];
  if (pl.alive && !state.observer && state.locations[pl.locationId]?.kind !== 'road') recordPrices(state, settlementIdOf(state, pl.locationId));

  if (d.hour === 0) dayTick(state);
}

export function localPrices(state: GameState, settlementId: string): Partial<Record<ItemId, number>> {
  const prices: Partial<Record<ItemId, number>> = {};
  for (const it of ITEM_IDS) { const p = referencePrice(state, it, settlementId); if (p !== undefined) prices[it] = p; }
  return prices;
}

export function recordPrices(state: GameState, settlementId: string): void {
  state.priceBook[settlementId] = { day: toDate(state.time).day, prices: localPrices(state, settlementId) };
}

// ── Jour ─────────────────────────────────────────────────────

export function dayTick(state: GameState): void {
  const d = toDate(state.time);

  for (const c of aliveCharacters(state)) {
    c.hoursWorkedToday = 0;
    // Le temps apaise les rancunes et use les amitiés non entretenues
    for (const r of Object.values(c.relations)) {
      if (r.affinity > 0 && state.time - r.lastInteraction > MIN_PER_DAY * 7) r.affinity -= 1;
      else if (r.affinity < 0 && chance(state, hasTrait(c, 'rancunier') ? 0.1 : 0.5)) r.affinity += 1;
      if (r.trust < 0 && chance(state, 0.35)) r.trust += 1;
    }
  }

  for (const b of allBusinesses(state)) {
    if (b.treasury < b.lastTreasury) b.daysInDeficit += 1;
    b.lastTreasury = b.treasury;
  }

  // Les denrées s'abîment (pain rassis, grain charançonné)
  const spoil = (inv: Inventory): number => {
    let lost = 0;
    const bread = qty(inv, 'bread'), grain = qty(inv, 'grain');
    if (bread >= 12) { const k = Math.floor(bread * 0.06); addItem(inv, 'bread', -k); addItem(state.ledger.consumed, 'bread', k); lost += k; }
    if (grain >= 40) { const k = Math.floor(grain * 0.02); addItem(inv, 'grain', -k); addItem(state.ledger.consumed, 'grain', k); }
    return lost;
  };
  for (const b of allBusinesses(state)) {
    const lost = spoil(b.stock);
    if (lost >= 4) logEvent(state, { type: 'spoilage', businessId: b.id, importance: 1, text: `${lost} miches invendues rassissent à ${b.name}.` });
  }
  for (const c of aliveCharacters(state)) spoil(c.inventory);

  // Chauffage et cuisine : un fagot tous les trois jours par personne (tous les deux en hiver)
  if (d.day % (d.season === 3 ? 2 : 3) === 0) {
    for (const c of npcs(state)) {
      if (qty(c.inventory, 'wood') > 0) { addItem(c.inventory, 'wood', -1); addItem(state.ledger.consumed, 'wood', 1); }
      else if (d.season === 3) {
        c.health = clamp(c.health - 5, 0, 100);
        logEvent(state, { type: 'cold', actorId: c.id, importance: 1, text: `${fullName(c)} grelotte sans feu dans l'âtre.` });
      }
    }
  }

  // Routes et bâtiments s'usent
  for (const sid of state.settlementOrder) {
    const st = state.settlements[sid];
    st.infrastructure = clamp(st.infrastructure - 0.3, 0, 100);
  }

  // Maladies (l'insalubrité et la faim augmentent le risque)
  for (const c of aliveCharacters(state)) {
    if (c.sick > 0) continue;
    let p = 0.006 + (hereSettlement(state, c).infrastructure < 40 ? 0.008 : 0) + (c.needs.hunger > 70 ? 0.01 : 0) + (c.age > 55 ? 0.006 : 0);
    if (d.season === 3) p *= 1.6;
    if (chance(state, p)) {
      c.sick = randInt(state, 18, 60);
      logEvent(state, { type: 'sickness', actorId: c.id, importance: c.isPlayer ? 3 : 2, locationId: c.locationId,
        text: c.isPlayer ? 'Tu te réveilles fiévreux : tu es tombé malade.' : `${fullName(c)} est tombé malade.`,
        witnesses: [] });
    }
    // Grand âge
    if (c.age >= 60 && chance(state, (c.age - 58) * 0.0004)) {
      c.health = 0;
      killCharacter(state, c, 'de vieillesse');
      if (state.gameOver) return;
    }
  }

  // Anniversaires, grossesses et naissances (phase 5)
  birthdays(state);
  dailyFamily(state);
  dailyServants(state);

  // Hebdomadaire (chaque lundi) : impôts, salaires, migrations
  if (d.weekday === 0 && d.day > 0) {
    const inRevolt = (sid: string) => (state.settlements[sid].revoltUntilDay ?? -1) >= d.day;
    for (const b of allBusinesses(state)) {
      if (b.kind === 'manor') continue;
      const st = businessSettlement(state, b);
      if (inRevolt(st.id)) { weeklyWageReview(state, b); continue; }
      const tax = Math.floor(Math.max(0, b.treasury) * st.taxRate);
      if (tax > 0 && transferMoney(state, P.b(b.id), P.b(st.manorId), tax)) {
        lordShare(state, st.id, tax);
        logEvent(state, { type: 'tax', businessId: b.id, importance: 1, text: `L'intendance de ${st.name} perçoit ${tax} d d'impôt sur ${b.name}.` });
      }
      weeklyWageReview(state, b);
    }
    // Taxe par foyer : chaque adulte verse sa part à l'intendance de sa localité
    for (const c of npcs(state)) {
      if (c.age < 16 || inRevolt(homeSettlement(state, c).id)) continue;
      const due = Math.min(c.money, HEAD_TAX);
      if (due > 0 && transferMoney(state, P.c(c.id), P.b(homeSettlement(state, c).manorId), due)) lordShare(state, homeSettlement(state, c).id, due);
    }
    const pl = state.characters[state.playerId];
    if (pl.alive && !state.observer && pl.money > 0) {
      const due = Math.min(pl.money, HEAD_TAX);
      const st = hereSettlement(state, pl);
      transferMoney(state, P.c(pl.id), P.b(st.manorId), due);
      logEvent(state, { type: 'tax', actorId: pl.id, importance: 1, text: `Le collecteur de ${st.name} te réclame ${due} d de taxe de foyer.` });
    }
    for (const sid of state.settlementOrder) {
      weeklyWageReview(state, manorOf(state, sid));
      almsgiving(state, sid);
      migration(state, sid);
    }
    collectRents(state);
    weeklyTerritories(state);
    weeklyGovernance(state);
    weeklyGangs(state);
    weeklyCourtship(state);
  }

  for (const sid of state.settlementOrder) soupKitchen(state, sid);
  feedPrisoners(state);
  if (d.dayOfSeason === 14) monthlyIntrigues(state);

  // Phase 2 : dettes, commandes, ambitions, contrats
  processLoans(state);
  processOrders(state);
  processAmbitions(state);
  if (d.weekday === 0 && d.day > 0) weeklyContractReview(state);
  state.festivals = state.festivals.filter(f => f.day >= d.day);

  snapshot(state);
  pruneEvents(state);
}

function snapshot(state: GameState): void {
  const d = toDate(state.time);
  const prices: Partial<Record<ItemId, number>> = {};
  for (const it of ITEM_IDS) { const p = referencePrice(state, it); if (p !== undefined) prices[it] = p; }
  const pop = npcs(state);
  state.history.push({
    day: d.day, prices, totalMoney: totalMoney(state), population: pop.length,
    employed: pop.filter(c => c.employerId).length,
    avgHunger: Math.round(pop.reduce((s, c) => s + c.needs.hunger, 0) / Math.max(1, pop.length)),
    villageTreasury: state.settlementOrder.reduce((s, id) => s + manorOf(state, id).treasury, 0),
  });
  if (state.history.length > 240) state.history.shift();
}

// ── Mort et succession ──────────────────────────────────────

export function killCharacter(state: GameState, c: Character, cause: string): void {
  if (!c.alive) return;
  c.alive = false;
  c.health = 0;
  c.deathTime = state.time;
  const manor = manorOf(state, homeSettlement(state, c).id);
  const death = logEvent(state, {
    type: 'death', actorId: c.id, locationId: c.locationId, importance: 3,
    text: c.isPlayer ? `Tu meurs ${cause}, à ${c.age} ans.` : `${fullName(c)} est mort ${cause}, à ${c.age} ans.`,
    witnesses: aliveCharacters(state).map(x => x.id), // nouvelle publique
  });
  // Emploi
  if (c.employerId) {
    const b = state.businesses[c.employerId];
    if (b) b.employees = b.employees.filter(id => id !== c.id);
    c.employerId = undefined;
  }
  c.activity = { kind: 'dead', locationId: c.locationId, since: state.time, note: `Mort ${cause}` };
  // Succession (phase 5) : dettes, partage, biens, entreprises, tutelle ; sans famille, l'intendance hérite
  const inherited = settleEstate(state, c);
  // Biens : sans famille, l'héritage revient à l'intendance du village
  for (const owned of inherited ? [] : ownedBusinesses(state, c)) {
    const heir = owned.employees.map(id => state.characters[id]).filter(e => e.alive && !e.isPlayer)
      .sort((a, b) => b.skills.gestion - a.skills.gestion || (a.id < b.id ? -1 : 1))[0];
    if (heir) {
      owned.employees = owned.employees.filter(id => id !== heir.id);
      owned.ownerId = heir.id;
      heir.employerId = owned.id;
      heir.goal = { kind: 'prosperer' };
      heir.ambition = { kind: 'faire_fortune', since: state.time };
    } else {
      owned.ownerId = null;
    }
    logEvent(state, { type: 'inheritance', actorId: heir?.id, businessId: owned.id, importance: 3, causeIds: [death.id],
      text: heir ? `${fullName(heir)} reprend ${owned.name} après la mort de ${fullName(c)}.` : `${owned.name} passe sous la tutelle de l'intendance.`,
      witnesses: aliveCharacters(state).map(x => x.id) });
  }
  if (!inherited && c.money > 0) transferMoney(state, P.c(c.id), P.b(manor.id), c.money);
  for (const [k, v] of inherited ? [] : Object.entries(c.inventory)) {
    addItem(manor.stock, k as ItemId, v!);
    delete c.inventory[k as ItemId];
  }
  onDeathOrgs(state, c);
  if (c.isPlayer) {
    const candidates = successionCandidates(state, c);
    if (candidates.length) state.pendingSuccession = { deceasedId: c.id, candidates, cause: death.text };
    else state.gameOver = death.text;
  }
}

/** L'intendance redistribue une part de ses réserves aux plus démunis (filet de sécurité). */
function almsgiving(state: GameState, settlementId: string): void {
  const manor = manorOf(state, settlementId);
  if (manor.treasury < 700) return;
  const poor = residents(state, settlementId).filter(c => c.money < 15 && c.age >= 14);
  if (!poor.length) return;
  const each = Math.min(15, Math.floor((manor.treasury - 600) / poor.length));
  if (each <= 0) return;
  for (const c of poor) transferMoney(state, P.b(manor.id), P.c(c.id), each);
  logEvent(state, { type: 'help', importance: 2, locationId: state.settlements[settlementId].squareId,
    text: `L'intendance de ${state.settlements[settlementId].name} distribue une aumône de ${each} d à ${poor.length} habitant${poor.length > 1 ? 's' : ''} dans le besoin.`,
    witnesses: poor.map(c => c.id) });
}

/** Part seigneuriale : 40 % de chaque impôt perçu par une intendance remonte à la maison qui tient la localité. */
function lordShare(state: GameState, settlementId: string, amount: number): void {
  const houseId = state.settlements[settlementId].lordHouseId;
  const share = Math.floor(amount * 0.4);
  if (houseId && state.orgs[houseId] && share > 0) transferMoney(state, P.b(state.settlements[settlementId].manorId), P.o(houseId), share);
}

/** Soupe populaire : l'intendance achète du pain pour les affamés sans le sou (si sa caisse le permet). */
export function soupKitchen(state: GameState, settlementId: string): void {
  const manor = manorOf(state, settlementId);
  const hungry = residents(state, settlementId).filter(c => c.money < 5 && c.needs.hunger > 55 && qty(c.inventory, 'bread') === 0);
  if (!hungry.length || manor.treasury < 60) return;
  const bakery = businessesIn(state, settlementId).filter(b => b.sells.includes('bread') && b.kind !== 'manor' && qty(b.stock, 'bread') > 0)
    .sort((a, b) => askPrice(state, a, 'bread') - askPrice(state, b, 'bread'))[0];
  if (!bakery) return;
  const price = askPrice(state, bakery, 'bread');
  let served = 0;
  for (const c of hungry) {
    const n = Math.min(3, qty(bakery.stock, 'bread'));
    if (n <= 0 || manor.treasury - n * price < 40) break;
    transferMoney(state, P.b(manor.id), P.b(bakery.id), n * price);
    transferItem(state, P.b(bakery.id), P.c(c.id), 'bread', n);
    served++;
  }
  if (served) logEvent(state, { type: 'help', importance: 1, locationId: state.settlements[settlementId].squareId,
    text: `L'intendance de ${state.settlements[settlementId].name} fait distribuer du pain à ${served} affamé${served > 1 ? 's' : ''}.` });
}

/** Des étrangers s'installent quand une localité se dépeuple (entrée externe tracée). */
function migration(state: GameState, settlementId: string): void {
  const st = state.settlements[settlementId];
  const pop = residents(state, settlementId).length;
  if (pop >= st.popCap) return;
  // la nouvelle d'une famine décourage les candidats à l'installation
  const recentFamine = state.events.filter(e => e.type === 'death' && e.text.includes('de faim') && e.time > state.time - 56 * MIN_PER_DAY
    && e.actorId && settlementIdOf(state, state.characters[e.actorId].homeId) === settlementId).length;
  if (recentFamine >= 2) return;
  // Une localité qui se vide attire un jeune ménage (terres et maisons libres)
  if (pop < st.popCap * 0.8 && chance(state, 0.5)) {
    const a = migrant(state, settlementId, 'M', [18, 30]);
    const b = migrant(state, settlementId, 'F', [17, 28]);
    b.lastName = a.lastName;
    a.spouseId = b.id; b.spouseId = a.id;
    modifyRelation(state, a.id, b.id, 50, 50); modifyRelation(state, b.id, a.id, 50, 50);
    logEvent(state, { type: 'arrival', actorId: a.id, targetId: b.id, importance: 2, locationId: st.squareId,
      text: `Un jeune ménage, ${fullName(a)} et ${fullName(b)}, s'installe à ${st.name} sur une terre délaissée.`, witnesses: residents(state, settlementId).map(x => x.id) });
    return;
  }
  // sinon, on ne vient s'installer que là où l'on entend dire qu'il y a du travail
  if (!businessesIn(state, settlementId).some(b => isHiring(state, b))) return;
  if (residents(state, settlementId).some(c => !c.employerId && c.age < 60)) return; // des chômeurs attendent déjà
  const c = migrant(state, settlementId, chance(state, 0.5) ? 'M' : 'F', [17, 40]);
  logEvent(state, { type: 'arrival', actorId: c.id, importance: 2, locationId: c.locationId,
    text: `${fullName(c)}, venu d'au-delà des collines, s'installe à ${st.name} pour chercher du travail.`,
    witnesses: residents(state, settlementId).map(x => x.id) });
}

/** Crée un migrant (argent et pain apportés de l'extérieur : comptabilisés). */
function migrant(state: GameState, settlementId: string, sex: 'M' | 'F', ages: [number, number]): Character {
  const st = state.settlements[settlementId];
  const id = newId(state, 'c');
  const money = 25;
  const house = locationsIn(state, settlementId, 'houses')[0]?.id ?? st.squareId;
  const c: Character = {
    id, firstName: pick(state, sex === 'M' ? FIRST_NAMES_M : FIRST_NAMES_F), lastName: pick(state, LAST_NAMES),
    age: randInt(state, ages[0], ages[1]), sex, isPlayer: false, alive: true, profession: 'sans_emploi', homeId: house,
    locationId: st.squareId, money, inventory: { bread: 2 }, health: 90, sick: 0,
    needs: { hunger: 30, energy: 70, social: 40 },
    attributes: { force: randInt(state, 3, 7), endurance: randInt(state, 3, 7), agilite: randInt(state, 3, 7), intelligence: randInt(state, 3, 7), charisme: randInt(state, 3, 7), perception: randInt(state, 3, 7), volonte: randInt(state, 3, 7) },
    skills: { agriculture: randInt(state, 5, 30), artisanat: randInt(state, 5, 25), commerce: randInt(state, 0, 15), combat: randInt(state, 0, 15), diplomatie: randInt(state, 0, 15), discretion: randInt(state, 0, 15), gestion: randInt(state, 0, 10), commandement: 0 },
    skillXp: {}, traits: [pick(state, ['travailleur', 'sociable', 'timide', 'honnete', 'malhonnete', 'paresseux'] as const), pick(state, ['ambitieux', 'loyal', 'bavard', 'prudent', 'rancunier', 'genereux'] as const)],
    goal: { kind: 'trouver_emploi' }, relations: {}, knownEvents: [],
    activity: { kind: 'idle', locationId: st.squareId, since: state.time, note: 'Vient d’arriver' },
    unpaidWages: 0, hoursWorkedToday: 0, lastMealTime: state.time, forageProgress: 0,
    ambition: { kind: 'vie_paisible', since: state.time },
    birthDay: 0, parentIds: [], childIds: [],
  };
  c.birthDay = toDate(state.time).day - c.age * DAYS_PER_YEAR - randInt(state, 0, DAYS_PER_YEAR - 1);
  c.ambition = initialAmbition(state, c);
  state.characters[id] = c;
  state.characterOrder.push(id);
  state.ledger.externalMoneyIn += money;
  addItem(state.ledger.externalItemsIn, 'bread', 2);
  return c;
}

export { maxWorkHours };

// ─────────────────────────────────────────────────────────────
// Simulation temporelle.
// Le temps avance en minutes ; le monde est résolu à chaque frontière d'heure
// franchie (résolution horaire), puis à chaque frontière de jour.
// `processedHours` garantit qu'une heure n'est jamais simulée deux fois.
// ─────────────────────────────────────────────────────────────
import { RECIPES, WORK_ENERGY_COST, WORK_SKILL, WORK_ATTR, FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES } from './data';
import { laborMultiplier, manageBusiness, P, payWage, runProduction, transferMoney, weeklyWageReview, totalMoney, referencePrice, fireEmployee } from './economy';
import { logEvent, pruneEvents } from './events';
import { maxWorkHours, npcDecide } from './npc';
import { chance, pick, randInt } from './rng';
import { gainXp } from './skills';
import { socialHour } from './social';
import { MIN_PER_DAY, MIN_PER_HOUR, START_OFFSET_MIN, toDate, DAYS_PER_YEAR } from './time';
import type { Character, GameState, Inventory, ItemId } from './types';
import { addItem, aliveCharacters, allBusinesses, clamp, fullName, newId, npcs, ownedBusiness, qty } from './util';
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
  while (!state.gameOver) {
    const nextBoundary = (state.processedHours + 1) * MIN_PER_HOUR - START_OFFSET_MIN;
    if (nextBoundary > end) break;
    state.time = nextBoundary;
    state.processedHours += 1;
    hourTick(state);
    ticks++;
  }
  if (!state.gameOver) state.time = end;
  return ticks;
}

// ── Besoins physiologiques ──────────────────────────────────

export function applyHourlyNeeds(state: GameState, c: Character): void {
  const a = c.activity;
  const n = c.needs;
  const sleeping = a.kind === 'sleep';
  n.hunger = clamp(n.hunger + (sleeping ? HUNGER_PER_HOUR * 0.6 : HUNGER_PER_HOUR), 0, 100);
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
  if (n.hunger >= 100) dh -= 1.6;
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

  // 2. Travail effectué pendant l'heure écoulée
  for (const c of people) {
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
      if (c.profession === 'journalier' || c.isPlayer) state.village.infrastructure = clamp(state.village.infrastructure + 0.12 * productivity, 0, 100);
    } else if (RECIPES[b.kind]) {
      b.laborPool += productivity;
    }
    c.hoursWorkedToday += 1;
    gainXp(state, c, skill, 1);
    payWage(state, b, c, c.isPlayer ? c.activity.wage ?? b.wage : b.wage);
  }

  // 3. Production
  for (const b of allBusinesses(state)) runProduction(state, b);

  // 4. Décès éventuels
  for (const c of people) if (c.alive && c.health <= 0) killCharacter(state, c, c.needs.hunger >= 100 ? 'de faim' : c.sick > 0 ? 'de maladie' : c.needs.energy <= 0 ? "d'épuisement" : 'de privations');
  if (state.gameOver) return;

  // 5. Gestion du matin
  if (d.hour === 7 || d.hour === 13) for (const b of allBusinesses(state)) manageBusiness(state, b, d.hour === 13);

  // 6. Démissions pour salaires impayés
  for (const c of npcs(state)) {
    const b = c.employerId ? state.businesses[c.employerId] : undefined;
    if (b && b.ownerId !== c.id && c.unpaidWages >= b.wage * 16) {
      fireEmployee(state, b, c, `${c.unpaidWages} d de salaires impayés`, true);
    }
  }

  // 7. Décisions des PNJ pour l'heure qui commence
  for (const c of npcs(state)) npcDecide(state, c, d.hour, d.weekday);

  // 8. Vie sociale : regroupement par lieu
  const groups: Record<string, Character[]> = {};
  for (const c of aliveCharacters(state)) {
    if (c.activity.kind === 'socialize') (groups[c.locationId] ??= []).push(c);
  }
  for (const id of Object.keys(groups).sort()) socialHour(state, groups[id]);

  if (d.hour === 0) dayTick(state);
}

// ── Jour ─────────────────────────────────────────────────────

export function dayTick(state: GameState): void {
  const d = toDate(state.time);
  const manor = state.businesses[state.village.manorId];

  for (const c of aliveCharacters(state)) {
    c.hoursWorkedToday = 0;
    // Le temps apaise les rancunes et use les amitiés non entretenues
    for (const r of Object.values(c.relations)) {
      if (r.affinity > 0 && state.time - r.lastInteraction > MIN_PER_DAY * 7) r.affinity -= 1;
      else if (r.affinity < 0 && chance(state, 0.5)) r.affinity += 1;
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
  state.village.infrastructure = clamp(state.village.infrastructure - 0.6, 0, 100);

  // Maladies (l'insalubrité et la faim augmentent le risque)
  for (const c of aliveCharacters(state)) {
    if (c.sick > 0) continue;
    let p = 0.006 + (state.village.infrastructure < 40 ? 0.008 : 0) + (c.needs.hunger > 70 ? 0.01 : 0) + (c.age > 55 ? 0.006 : 0);
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

  // Anniversaire collectif au nouvel an
  if (d.day > 0 && d.day % DAYS_PER_YEAR === 0) for (const c of aliveCharacters(state)) c.age += 1;

  // Hebdomadaire (chaque lundi) : impôts, salaires, migrations
  if (d.weekday === 0 && d.day > 0) {
    for (const b of allBusinesses(state)) {
      if (b.id === manor.id) continue;
      const tax = Math.floor(Math.max(0, b.treasury) * state.village.taxRate);
      if (tax > 0 && transferMoney(state, P.b(b.id), P.b(manor.id), tax)) {
        logEvent(state, { type: 'tax', businessId: b.id, importance: 1, text: `L'intendance perçoit ${tax} d d'impôt sur ${b.name}.` });
      }
      weeklyWageReview(state, b);
    }
    // Taxe par foyer : chaque adulte verse sa part à l'intendance
    let head = 0;
    for (const c of npcs(state)) {
      if (c.age < 16) continue;
      const due = Math.min(c.money, HEAD_TAX);
      if (due > 0 && transferMoney(state, P.c(c.id), P.b(manor.id), due)) head += due;
    }
    const pl = state.characters[state.playerId];
    if (pl.alive && !state.observer && pl.money > 0) {
      const due = Math.min(pl.money, HEAD_TAX);
      transferMoney(state, P.c(pl.id), P.b(manor.id), due);
      head += due;
      logEvent(state, { type: 'tax', actorId: pl.id, importance: 1, text: `Le collecteur de l'intendance te réclame ${due} d de taxe de foyer.` });
    }
    if (head) logEvent(state, { type: 'tax', importance: 1, text: `La taxe de foyer rapporte ${head} d à l'intendance.` });
    weeklyWageReview(state, manor);
    almsgiving(state);
    migration(state);
  }

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
    villageTreasury: state.businesses[state.village.manorId].treasury,
  });
  if (state.history.length > 240) state.history.shift();
}

// ── Mort et succession ──────────────────────────────────────

export function killCharacter(state: GameState, c: Character, cause: string): void {
  if (!c.alive) return;
  c.alive = false;
  c.health = 0;
  c.deathTime = state.time;
  const manor = state.businesses[state.village.manorId];
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
  // Biens : sans famille, l'héritage revient à l'intendance du village
  const owned = ownedBusiness(state, c);
  if (owned) {
    const heir = owned.employees.map(id => state.characters[id]).filter(e => e.alive && !e.isPlayer)
      .sort((a, b) => b.skills.gestion - a.skills.gestion || (a.id < b.id ? -1 : 1))[0];
    if (heir) {
      owned.employees = owned.employees.filter(id => id !== heir.id);
      owned.ownerId = heir.id;
      heir.employerId = owned.id;
      heir.goal = { kind: 'prosperer' };
    } else {
      owned.ownerId = null;
    }
    logEvent(state, { type: 'inheritance', actorId: heir?.id, businessId: owned.id, importance: 3, causeIds: [death.id],
      text: heir ? `${fullName(heir)} reprend ${owned.name} après la mort de ${fullName(c)}.` : `${owned.name} passe sous la tutelle de l'intendance.`,
      witnesses: aliveCharacters(state).map(x => x.id) });
  }
  if (c.money > 0) transferMoney(state, P.c(c.id), P.b(manor.id), c.money);
  for (const [k, v] of Object.entries(c.inventory)) {
    addItem(manor.stock, k as ItemId, v!);
    delete c.inventory[k as ItemId];
  }
  if (c.isPlayer) state.gameOver = death.text;
}

/** L'intendance redistribue une part de ses réserves aux plus démunis (filet de sécurité). */
function almsgiving(state: GameState): void {
  const manor = state.businesses[state.village.manorId];
  if (manor.treasury < 700) return;
  const poor = npcs(state).filter(c => c.money < 15 && c.age >= 14);
  if (!poor.length) return;
  const each = Math.min(15, Math.floor((manor.treasury - 600) / poor.length));
  if (each <= 0) return;
  for (const c of poor) transferMoney(state, P.b(manor.id), P.c(c.id), each);
  logEvent(state, { type: 'help', importance: 2, locationId: 'square',
    text: `L'intendance distribue une aumône de ${each} d à ${poor.length} habitant${poor.length > 1 ? 's' : ''} dans le besoin.`,
    witnesses: poor.map(c => c.id) });
}

/** Des étrangers s'installent quand le village se dépeuple (entrée externe tracée). */
function migration(state: GameState): void {
  const pop = npcs(state).length;
  if (pop >= 18) return;
  const sex = chance(state, 0.5) ? 'M' : 'F';
  const id = newId(state, 'c');
  const money = 25;
  const house = state.locationOrder.find(l => state.locations[l].kind === 'houses')!;
  const c: Character = {
    id, firstName: pick(state, sex === 'M' ? FIRST_NAMES_M : FIRST_NAMES_F), lastName: pick(state, LAST_NAMES),
    age: randInt(state, 17, 40), sex, isPlayer: false, alive: true, profession: 'sans_emploi', homeId: house,
    locationId: state.locationOrder[0], money, inventory: { bread: 2 }, health: 90, sick: 0,
    needs: { hunger: 30, energy: 70, social: 40 },
    attributes: { force: randInt(state, 3, 7), endurance: randInt(state, 3, 7), agilite: randInt(state, 3, 7), intelligence: randInt(state, 3, 7), charisme: randInt(state, 3, 7), perception: randInt(state, 3, 7), volonte: randInt(state, 3, 7) },
    skills: { agriculture: randInt(state, 5, 30), artisanat: randInt(state, 5, 25), commerce: randInt(state, 0, 15), combat: randInt(state, 0, 15), diplomatie: randInt(state, 0, 15), discretion: randInt(state, 0, 15), gestion: randInt(state, 0, 10), commandement: 0 },
    skillXp: {}, traits: [pick(state, ['travailleur', 'sociable', 'timide', 'honnete', 'malhonnete', 'paresseux'] as const)],
    goal: { kind: 'trouver_emploi' }, relations: {}, knownEvents: [],
    activity: { kind: 'idle', locationId: state.locationOrder[0], since: state.time, note: 'Vient d’arriver au village' },
    unpaidWages: 0, hoursWorkedToday: 0, lastMealTime: state.time, forageProgress: 0,
  };
  state.characters[id] = c;
  state.characterOrder.push(id);
  state.ledger.externalMoneyIn += money;
  addItem(state.ledger.externalItemsIn, 'bread', 2);
  logEvent(state, { type: 'arrival', actorId: id, importance: 2, locationId: c.locationId,
    text: `${fullName(c)}, venu d'un village voisin, s'installe à ${state.village.name} pour chercher du travail.`,
    witnesses: aliveCharacters(state).map(x => x.id) });
}

export { maxWorkHours };

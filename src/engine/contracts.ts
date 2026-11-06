// ─────────────────────────────────────────────────────────────
// Contrats : place salariée du joueur et commandes d'approvisionnement.
// ─────────────────────────────────────────────────────────────
import { ITEMS, MIN_SKILL_FOR_DAYWORK, PROFESSION_BY_BUSINESS, SKILL_NAMES, WORK_SKILL } from './data';
import { askPrice, fireEmployee, P, reserveFor, trade, transferItem, transferMoney } from './economy';
import { recordIOU } from './finance';
import { getEvent, logEvent } from './events';
import { fem, refusalText } from './narrative';
import { getRelation, modifyRelation } from './social';
import { toDate } from './time';
import type { ActionResult, Business, Character, GameState, ItemId, JobContract, SupplyOrder } from './types';
import { allBusinesses, fullName, newId, player, qty } from './util';

export const CONTRACT_HOURS = 24;

export function activeContract(state: GameState, workerId: string): JobContract | undefined {
  return state.contracts.find(c => c.status === 'active' && c.workerId === workerId);
}

export function contractWage(_state: GameState, b: Business, p: Character): number {
  const skill = p.skills[WORK_SKILL[b.kind]];
  return Math.max(2, Math.round(b.wage * (0.85 + skill / 100)));
}

export interface Offer { ok: boolean; reason?: string; wage: number; hours: number }

/** Le propriétaire offrirait-il une place au joueur ? */
export function jobOffer(state: GameState, b: Business, p: Character): Offer {
  const wage = contractWage(state, b, p);
  const no = (reason: string): Offer => ({ ok: false, reason, wage, hours: CONTRACT_HOURS });
  if (activeContract(state, p.id)) return no('Tu as déjà une place. Démissionne d’abord.');
  if (b.kind === 'market') return no('Le marchand ne prend pas de commis.');
  const owner = b.ownerId ? state.characters[b.ownerId] : state.characters['odon'];
  const skill = WORK_SKILL[b.kind];
  if (p.skills[skill] < MIN_SKILL_FOR_DAYWORK[b.kind] + 5) return no(`${owner?.firstName ?? 'On'} exige plus d’expérience (${SKILL_NAMES[skill]} ${p.skills[skill]}/${MIN_SKILL_FOR_DAYWORK[b.kind] + 5}).`);
  if (owner && owner.alive) {
    const r = getRelation(state, owner.id, p.id);
    const thief = owner.knownEvents.some(id => { const e = getEvent(state, id); return e?.type === 'theft_caught' && e.actorId === p.id; });
    if (thief || r.trust < 0 || r.affinity < 0) return no(refusalText(state, owner, "t'engager"));
    if (r.trust < 8 && r.affinity < 8) return no(fem(owner, `${owner.firstName} ne te connaît pas assez : travaille d’abord quelques journées pour lui.`));
  }
  if (b.employees.length >= b.maxWorkers) return no(`${b.name} a déjà tout son personnel.`);
  if (b.treasury < reserveFor(b)) return no(`${b.name} n’a pas les moyens d’embaucher.`);
  return { ok: true, wage, hours: CONTRACT_HOURS };
}

export function signContract(state: GameState, businessId: string): ActionResult {
  const p = player(state);
  const b = state.businesses[businessId];
  if (!b) return { ok: false, message: 'Établissement inconnu.', minutes: 0 };
  if (p.locationId !== b.locationId) return { ok: false, message: "Il faut te présenter sur place.", minutes: 0 };
  const o = jobOffer(state, b, p);
  if (!o.ok) return { ok: false, message: o.reason!, minutes: 0 };
  const day = toDate(state.time).day;
  const c: JobContract = {
    id: newId(state, 'k'), businessId: b.id, workerId: p.id, wage: o.wage, hoursPerWeek: o.hours, startDay: day,
    hoursThisWeek: 0, goodWeeks: 0, strikes: 0, status: 'active',
  };
  state.contracts.push(c);
  b.employees.push(p.id);
  p.employerId = b.id;
  p.profession = b.kind === 'manor' ? 'journalier' : PROFESSION_BY_BUSINESS[b.kind];
  p.goal = { kind: 'epargner' };
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  if (owner) modifyRelation(state, owner.id, p.id, 3, 3);
  const ev = logEvent(state, {
    type: 'contract', actorId: p.id, targetId: owner?.id, businessId: b.id, locationId: b.locationId, importance: 2,
    text: `${fullName(p)} est engagé à ${b.name} : ${o.wage} d de l'heure, ${o.hours} h par semaine au minimum.`,
    witnesses: owner ? [owner.id] : [],
  });
  return { ok: true, message: `Te voilà engagé à ${b.name} : ${o.wage} d de l’heure, au moins ${o.hours} h par semaine. Tes heures ne dépendent plus du bon vouloir du patron.`, minutes: 0, eventIds: [ev.id] };
}

export function endContract(_state: GameState, c: JobContract, reason: string): void {
  if (c.status !== 'active') return;
  c.status = 'ended';
  c.endReason = reason;
}

export function resign(state: GameState): ActionResult {
  const p = player(state);
  const c = activeContract(state, p.id);
  if (!c) return { ok: false, message: "Tu n'as pas de place à quitter.", minutes: 0 };
  const b = state.businesses[c.businessId];
  fireEmployee(state, b, p, 'il rend son tablier', true);
  return { ok: true, message: `Tu quittes ta place à ${b.name}.`, minutes: 0 };
}

/** Bilan hebdomadaire du contrat (chaque lundi). */
export function weeklyContractReview(state: GameState): void {
  const day = toDate(state.time).day;
  for (const c of state.contracts) {
    if (c.status !== 'active') continue;
    const b = state.businesses[c.businessId];
    const w = state.characters[c.workerId];
    const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
    const daysIn = Math.min(7, day - c.startDay);
    const required = Math.floor(c.hoursPerWeek * daysIn / 7);
    if (c.hoursThisWeek < required) {
      c.strikes += 1;
      if (owner) modifyRelation(state, owner.id, w.id, -4, -10);
      if (c.strikes >= 2) {
        fireEmployee(state, b, w, `seulement ${c.hoursThisWeek} h travaillées sur ${required} exigées`);
      } else {
        logEvent(state, {
          type: 'contract_warning', actorId: owner?.id, targetId: w.id, businessId: b.id, importance: 2,
          text: `${owner ? fullName(owner) : "L'intendance"} avertit ${fullName(w)} : ${c.hoursThisWeek} h travaillées sur ${required} exigées cette semaine.`,
          witnesses: owner ? [owner.id] : [],
        });
      }
    } else if (required > 0) {
      c.goodWeeks += 1;
      c.strikes = 0;
      if (owner) modifyRelation(state, owner.id, w.id, 2, 5);
      logEvent(state, {
        type: 'work_praise', actorId: w.id, targetId: owner?.id, businessId: b.id, importance: 2,
        text: `${owner ? fullName(owner) : "L'intendance"} se dit satisfait du travail de ${fullName(w)} à ${b.name}.`,
        witnesses: owner ? [owner.id] : [],
      });
      const fair = contractWage(state, b, w);
      if (fair > c.wage) {
        c.wage = fair;
        logEvent(state, { type: 'contract', actorId: w.id, businessId: b.id, importance: 1, text: `Ton salaire à ${b.name} passe à ${fair} d de l'heure.` });
      }
    }
    c.hoursThisWeek = 0;
  }
}

// ── Commandes d'approvisionnement ─────────────────────────────

export const ORDER_DAYS = 3;

export function openOrders(state: GameState): SupplyOrder[] {
  return state.orders.filter(o => o.status === 'open');
}

/** Une entreprise en pénurie affiche une commande au tableau de la place. */
export function postOrder(state: GameState, b: Business, item: ItemId): SupplyOrder | undefined {
  if (state.orders.some(o => o.businessId === b.id && o.item === item && (o.status === 'open' || o.status === 'taken'))) return undefined;
  const qtyNeeded = Math.max(3, (b.targets[item] ?? 6) - qty(b.stock, item));
  const unitPrice = Math.round(ITEMS[item].base * 1.35);
  if (b.treasury < unitPrice * Math.min(qtyNeeded, 3)) return undefined;
  const day = toDate(state.time).day;
  const o: SupplyOrder = { id: newId(state, 'o'), businessId: b.id, item, qty: qtyNeeded, delivered: 0, unitPrice, postedDay: day, deadlineDay: day + ORDER_DAYS, status: 'open' };
  state.orders.push(o);
  logEvent(state, { type: 'order_posted', businessId: b.id, locationId: 'square', importance: 1,
    text: `${b.name} affiche une commande : ${qtyNeeded} ${ITEMS[item].plural} à ${unitPrice} d pièce.` });
  return o;
}

export function acceptOrder(state: GameState, orderId: string): ActionResult {
  const p = player(state);
  const o = state.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'open') return { ok: false, message: 'Cette commande n’est plus disponible.', minutes: 0 };
  if (state.locations[p.locationId].kind !== 'square') return { ok: false, message: 'Le tableau des commandes est sur la Place du Puits.', minutes: 0 };
  if (state.orders.filter(x => x.takerId === p.id && x.status === 'taken').length >= 2) return { ok: false, message: 'Tu as déjà deux commandes en cours.', minutes: 0 };
  o.status = 'taken';
  o.takerId = p.id;
  o.deadlineDay = toDate(state.time).day + ORDER_DAYS;
  const b = state.businesses[o.businessId];
  return { ok: true, message: `Tu t'engages à livrer ${o.qty} ${ITEMS[o.item].plural} à ${b.name} d'ici ${ORDER_DAYS} jours (${o.unitPrice} d pièce).`, minutes: 5 };
}

/** Livraison (totale ou partielle). Une caisse insuffisante transforme le reste en créance. */
export function deliverOrder(state: GameState, orderId: string): ActionResult {
  const p = player(state);
  const o = state.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'taken' || o.takerId !== p.id) return { ok: false, message: 'Tu n’as pas cette commande.', minutes: 0 };
  const b = state.businesses[o.businessId];
  if (p.locationId !== b.locationId) return { ok: false, message: `Il faut livrer sur place, à ${b.name}.`, minutes: 0 };
  const n = Math.min(o.qty - o.delivered, qty(p.inventory, o.item));
  if (n <= 0) return { ok: false, message: `Tu n'as pas de ${ITEMS[o.item].plural} à livrer.`, minutes: 0 };
  transferItem(state, P.c(p.id), P.b(b.id), o.item, n);
  const due = n * o.unitPrice;
  const cash = Math.min(due, b.treasury);
  transferMoney(state, P.b(b.id), P.c(p.id), cash);
  o.delivered += n;
  let note = `${cash} d reçus`;
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  if (cash < due && owner) {
    // Le propriétaire signe une reconnaissance de dette au joueur, sans intérêt
    const rest = due - cash;
    const fromPurse = Math.min(owner.money, rest);
    transferMoney(state, P.c(owner.id), P.c(p.id), fromPurse);
    if (fromPurse) note += `, ${fromPurse} d payés par ${owner.firstName} de sa poche`;
    const still = rest - fromPurse;
    if (still > 0) {
      recordIOU(state, p, owner, still, `pour la commande de ${ITEMS[o.item].plural}`);
      note += `, ${still} d reconnus en dette par ${owner.firstName}`;
    }
  }
  if (o.delivered >= o.qty) {
    o.status = 'done';
    if (owner) modifyRelation(state, owner.id, p.id, 4, 6);
    logEvent(state, { type: 'order_done', actorId: p.id, targetId: owner?.id, businessId: b.id, importance: 2,
      text: `${fullName(p)} livre la commande de ${o.qty} ${ITEMS[o.item].plural} à ${b.name}.`, witnesses: owner ? [owner.id] : [] });
  }
  return { ok: true, message: `Tu livres ${n} ${n > 1 ? ITEMS[o.item].plural : ITEMS[o.item].name} à ${b.name} : ${note}.${o.status === 'done' ? ' Commande honorée.' : ` Reste ${o.qty - o.delivered}.`}`, minutes: 10 };
}

/** Le marchand honore lui-même les commandes qu'il peut servir depuis sa halle. */
export function merchantFulfils(state: GameState): void {
  const market = allBusinesses(state).find(b => b.kind === 'market' && b.ownerId);
  if (!market) return;
  for (const o of openOrders(state)) {
    const b = state.businesses[o.businessId];
    const n = o.qty - o.delivered;
    if (qty(market.stock, o.item) < n) continue;
    const price = Math.min(o.unitPrice, askPrice(state, market, o.item));
    if (trade(state, P.b(b.id), P.b(market.id), o.item, n, price)) {
      o.delivered = o.qty;
      o.status = 'done';
      o.takerId = market.ownerId!;
      logEvent(state, { type: 'order_done', actorId: market.ownerId!, businessId: b.id, importance: 1,
        text: `${market.name} livre ${n} ${ITEMS[o.item].plural} à ${b.name} (${price} d pièce).` });
    }
  }
}

/** Échéances des commandes (quotidien). */
export function processOrders(state: GameState): void {
  const day = toDate(state.time).day;
  for (const o of state.orders) {
    if (o.status === 'open' && day > o.deadlineDay + 2) o.status = 'expired';
    if (o.status === 'taken' && day > o.deadlineDay) {
      o.status = 'failed';
      const b = state.businesses[o.businessId];
      const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
      const taker = state.characters[o.takerId!];
      if (owner) modifyRelation(state, owner.id, taker.id, -6, -14);
      logEvent(state, { type: 'order_failed', actorId: taker.id, targetId: owner?.id, businessId: b.id, importance: 2,
        text: `${fullName(taker)} n'a pas livré les ${o.qty} ${ITEMS[o.item].plural} promis à ${b.name}.`, witnesses: owner ? [owner.id] : [] });
    }
  }
  if (state.orders.length > 50) state.orders = state.orders.filter((o, i) => o.status === 'open' || o.status === 'taken' || i >= state.orders.length - 30);
}

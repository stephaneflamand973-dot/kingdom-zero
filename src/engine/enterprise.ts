// ─────────────────────────────────────────────────────────────
// Entreprises (phase 3) : rachat et gestion par le joueur, fondation de nouveaux établissements.
// ─────────────────────────────────────────────────────────────
import { PROFESSION_BY_BUSINESS } from './data';
import { askPrice, P, transferMoney } from './economy';
import { logEvent } from './events';
import { businessValue, transferBusiness } from './finance';
import { getRelation } from './social';
import { businessesForSale } from './society';
import { toDate } from './time';
import type { ActionResult, Business, BusinessKind, Character, GameState, ItemId } from './types';
import { aliveCharacters, businessesIn, fullName, hasTrait, locationsIn, newId, player, qty, settlementIdOf } from './util';
import { ITEMS } from './data';

const no = (message: string): ActionResult => ({ ok: false, message, minutes: 0 });

// ── Rachat ───────────────────────────────────────────────────

export interface PurchaseOffer { ok: boolean; reason?: string; price: number; seller: string | null }

/** À quel prix le joueur peut-il racheter cette affaire ? */
export function purchaseOffer(state: GameState, b: Business, buyer: Character): PurchaseOffer {
  if (b.kind === 'manor') return { ok: false, reason: 'L’intendance n’est pas à vendre.', price: 0, seller: null };
  if (b.ownerId === buyer.id) return { ok: false, reason: 'Elle est déjà à toi.', price: 0, seller: buyer.id };
  const listed = businessesForSale(state, buyer).find(x => x.b.id === b.id);
  if (listed) return { ok: true, price: listed.price, seller: listed.seller };
  // Le propriétaire ne vend pas, mais peut céder à un prix qui le tente
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  const price = Math.round(businessValue(state, b) * 1.4);
  if (!owner) return { ok: true, price, seller: null };
  const r = getRelation(state, owner.id, buyer.id);
  if (hasTrait(owner, 'ambitieux') && !hasTrait(owner, 'avare')) return { ok: false, reason: `${owner.firstName} ne vendra pas : c’est l’œuvre de sa vie.`, price, seller: owner.id };
  if (r.affinity < 10 || r.trust < 10) return { ok: false, reason: `${owner.firstName} ne traite pas d’une telle affaire avec un inconnu.`, price, seller: owner.id };
  return { ok: true, price, seller: owner.id };
}

export function buyBusinessAsPlayer(state: GameState, businessId: string): ActionResult {
  const p = player(state);
  const b = state.businesses[businessId];
  if (!b) return no('Établissement inconnu.');
  if (p.locationId !== b.locationId) return no('Une telle affaire se conclut sur place.');
  const o = purchaseOffer(state, b, p);
  if (!o.ok) return no(o.reason!);
  if (p.money < o.price) return no(`Il te faut ${o.price} d (tu as ${p.money} d).`);
  const seller = o.seller ? state.characters[o.seller] : undefined;
  const to = seller ? P.c(seller.id) : P.b(state.settlements[settlementIdOf(state, b.locationId)].manorId);
  transferMoney(state, P.c(p.id), to, o.price);
  transferBusiness(state, b, p, seller);
  logEvent(state, {
    type: 'sale', actorId: p.id, targetId: seller?.id, businessId: b.id, locationId: b.locationId, importance: 3,
    text: seller ? `${fullName(seller)} vend ${b.name} à ${fullName(p)} pour ${o.price} d.` : `${fullName(p)} rachète ${b.name} à l'intendance pour ${o.price} d.`,
    witnesses: aliveCharacters(state).filter(c => settlementIdOf(state, c.homeId) === settlementIdOf(state, b.locationId)).map(c => c.id),
  });
  return { ok: true, message: `${b.name} t'appartient désormais (${o.price} d). Un contremaître s'occupe des achats et de l'embauche ; à toi de fixer la caisse, les salaires et les objectifs.`, minutes: 30 };
}

// ── Gestion par le propriétaire joueur ───────────────────────

export type OwnerOrder =
  | { kind: 'withdraw'; amount: number } | { kind: 'deposit'; amount: number }
  | { kind: 'wage'; delta: number } | { kind: 'workers'; delta: number } | { kind: 'target'; item: ItemId; factor: number };

export function maxWorkersFor(kind: BusinessKind): number {
  return kind === 'farm' || kind === 'mine' ? 5 : kind === 'market' ? 0 : 3;
}

export function manage(state: GameState, businessId: string, order: OwnerOrder): ActionResult {
  const p = player(state);
  const b = state.businesses[businessId];
  if (!b || b.ownerId !== p.id) return no('Cette affaire ne t’appartient pas.');
  switch (order.kind) {
    case 'withdraw': {
      if (p.locationId !== b.locationId) return no('Il faut être sur place pour vider la caisse.');
      const n = Math.min(order.amount, b.treasury);
      if (n <= 0) return no('La caisse est vide.');
      transferMoney(state, P.b(b.id), P.c(p.id), n);
      return { ok: true, message: `Tu retires ${n} d de la caisse de ${b.name}.`, minutes: 5 };
    }
    case 'deposit': {
      if (p.locationId !== b.locationId) return no('Il faut être sur place pour remplir la caisse.');
      const n = Math.min(order.amount, p.money);
      if (n <= 0) return no('Tu n’as rien à déposer.');
      transferMoney(state, P.c(p.id), P.b(b.id), n);
      return { ok: true, message: `Tu déposes ${n} d dans la caisse de ${b.name}.`, minutes: 5 };
    }
    case 'wage': {
      const w = Math.max(2, Math.min(12, b.wage + order.delta));
      if (w === b.wage) return no('Salaire inchangé.');
      b.wage = w;
      logEvent(state, { type: 'production', actorId: p.id, businessId: b.id, importance: 2, text: `${fullName(p)} fixe le salaire de ${b.name} à ${w} d de l'heure.`, witnesses: b.employees.slice() });
      return { ok: true, message: `Salaire horaire de ${b.name} : ${w} d.`, minutes: 0 };
    }
    case 'workers': {
      const m = Math.max(0, Math.min(maxWorkersFor(b.kind), b.maxWorkers + order.delta));
      if (m === b.maxWorkers) return no('Effectif maximal inchangé.');
      b.maxWorkers = m;
      return { ok: true, message: `Effectif maximal de ${b.name} : ${m} ouvrier${m > 1 ? 's' : ''}.`, minutes: 0 };
    }
    case 'target': {
      const cur = b.targets[order.item] ?? 0;
      const t = Math.max(2, Math.min(200, Math.round(cur * order.factor)));
      b.targets[order.item] = t;
      return { ok: true, message: `Stock visé en ${ITEMS[order.item].plural} : ${t}. Plus de stock visé = plus d’achats ou de production, et des prix plus bas.`, minutes: 0 };
    }
  }
}

// ── Fondation ────────────────────────────────────────────────

export const FOUNDABLE: BusinessKind[] = ['market', 'bakery', 'tavern', 'forge'];
export const FOUNDING_COST: Partial<Record<BusinessKind, number>> = { market: 220, bakery: 280, tavern: 300, forge: 320 };
const KIND_NAME: Partial<Record<BusinessKind, string>> = { market: 'Comptoir', bakery: 'Boulangerie', tavern: 'Cabaret', forge: 'Atelier de forge' };

const TEMPLATE: Partial<Record<BusinessKind, Pick<Business, 'sells' | 'buys' | 'targets' | 'openFrom' | 'openTo' | 'maxWorkers' | 'wage'>>> = {
  market: { sells: ['bread', 'grain', 'wood', 'iron', 'tools'], buys: ['bread', 'grain', 'wood', 'iron', 'tools'], targets: { bread: 8, grain: 12, wood: 6, iron: 4, tools: 2 }, openFrom: 7, openTo: 19, maxWorkers: 0, wage: 4 },
  bakery: { sells: ['bread'], buys: ['grain', 'wood'], targets: { bread: 20, grain: 10, wood: 5 }, openFrom: 6, openTo: 19, maxWorkers: 2, wage: 4 },
  tavern: { sells: ['ale', 'bread'], buys: ['grain', 'bread'], targets: { ale: 15, grain: 5, bread: 5 }, openFrom: 10, openTo: 23, maxWorkers: 1, wage: 4 },
  forge: { sells: ['tools'], buys: ['iron', 'wood'], targets: { tools: 4, iron: 6, wood: 4 }, openFrom: 7, openTo: 18, maxWorkers: 1, wage: 5 },
};

/** Fonde un établissement : le coût de construction va à l'intendance, le capital à la caisse. */
export function foundBusiness(state: GameState, founder: Character, kind: BusinessKind, settlementId: string, capital: number): Business | undefined {
  const cost = FOUNDING_COST[kind];
  const tpl = TEMPLATE[kind];
  if (!cost || !tpl || founder.money < cost + capital) return undefined;
  const st = state.settlements[settlementId];
  const locationId = locationsIn(state, settlementId, kind === 'market' ? 'market' : kind)[0]?.id ?? st.squareId;
  transferMoney(state, P.c(founder.id), P.b(st.manorId), cost);
  const b: Business = {
    id: newId(state, 'b_'), name: `${KIND_NAME[kind]} ${founder.lastName.startsWith('de ') ? founder.lastName : `de ${founder.firstName}`}`,
    kind, locationId, ownerId: founder.id, treasury: 0, stock: {}, laborPool: 0, toolWear: 0,
    maxWorkers: tpl.maxWorkers, wage: tpl.wage, employees: [], openFrom: tpl.openFrom, openTo: tpl.openTo,
    sells: tpl.sells.slice(), buys: tpl.buys.slice(), targets: { ...tpl.targets }, produced: {},
    daysInDeficit: 0, lastTreasury: capital, lastStaffChangeDay: -99, lastShortageDay: {}, founded: toDate(state.time).day,
  };
  state.businesses[b.id] = b;
  state.businessOrder.push(b.id);
  transferMoney(state, P.c(founder.id), P.b(b.id), capital);
  if (!founder.employerId) {
    founder.employerId = b.id;
    if (!founder.isPlayer) founder.profession = kind === 'market' ? 'marchand' : PROFESSION_BY_BUSINESS[kind];
  }
  if (!founder.isPlayer) founder.ambition = { kind: 'faire_fortune', since: state.time };
  logEvent(state, {
    type: 'founding', actorId: founder.id, businessId: b.id, locationId, importance: 3,
    text: `${fullName(founder)} ouvre ${b.name} à ${st.name} (${cost} d de travaux, ${capital} d de fonds de roulement).`,
    witnesses: aliveCharacters(state).filter(c => settlementIdOf(state, c.homeId) === settlementId).map(c => c.id),
  });
  return b;
}

export function foundAsPlayer(state: GameState, kind: BusinessKind, capital: number): ActionResult {
  const p = player(state);
  const loc = state.locations[p.locationId];
  if (loc.kind !== 'square') return no('On achète un terrain à bâtir auprès de l’intendance, depuis la place.');
  if (!FOUNDABLE.includes(kind)) return no('Ce genre d’établissement ne se fonde pas ainsi.');
  const cost = FOUNDING_COST[kind]!;
  if (p.money < cost + capital) return no(`Il te faut ${cost} d de travaux et ${capital} d de fonds de roulement (${cost + capital} d).`);
  const b = foundBusiness(state, p, kind, loc.settlementId, capital);
  if (!b) return no('La fondation a échoué.');
  return { ok: true, message: `Tu fondes ${b.name}. Il ouvrira demain matin : ton contremaître achètera ses premières marchandises avec les ${capital} d de la caisse.`, minutes: 120 };
}

/** Intérêt d'ouvrir tel établissement dans une localité : rareté locale de ce qu'il vend. */
export function foundingOpportunity(state: GameState, kind: BusinessKind, settlementId: string): number {
  const tpl = TEMPLATE[kind];
  if (!tpl) return 0;
  const out = tpl.sells[0] as ItemId;
  const local = businessesIn(state, settlementId);
  const same = local.filter(b => b.kind === kind).length;
  const prices = local.filter(b => b.sells.includes(out) && qty(b.stock, out) > 0).map(b => askPrice(state, b, out));
  const ratio = prices.length ? Math.min(...prices) / ITEMS[out].base : 2;
  return ratio - same * 0.4;
}

/** PNJ ambitieux sans affaire à racheter : il fonde là où l'offre manque. */
export function npcFounding(state: GameState, c: Character): Business | undefined {
  if (c.ambition.kind !== 'ouvrir_commerce') return undefined;
  const sid = settlementIdOf(state, c.homeId);
  const best = FOUNDABLE
    .map(k => ({ k, score: foundingOpportunity(state, k, sid) }))
    .filter(x => x.score >= 1.3 && c.money >= (FOUNDING_COST[x.k] ?? 999) + 60)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) return undefined;
  const capital = Math.min(150, c.money - FOUNDING_COST[best.k]! - 20);
  if (capital < 40) return undefined;
  // quitte son emploi actuel
  if (c.employerId) {
    const prev = state.businesses[c.employerId];
    if (prev && prev.ownerId !== c.id) prev.employees = prev.employees.filter(id => id !== c.id);
    c.employerId = undefined;
  }
  return foundBusiness(state, c, best.k, sid, capital);
}

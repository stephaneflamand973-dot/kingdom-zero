// ─────────────────────────────────────────────────────────────
// Entreprises (phase 3) : rachat et gestion par le joueur, fondation de nouveaux établissements.
// ─────────────────────────────────────────────────────────────
import { PROFESSION_BY_BUSINESS, RECIPES, WORK_SKILL } from './data';
import { askPrice, outputCap, P, reserveFor, transferMoney } from './economy';
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

/** Coût des travaux : un maître du métier (compétence 45) bâtit son atelier un quart moins cher. */
export function foundingCost(founder: Character, kind: BusinessKind): number | undefined {
  const base = FOUNDING_COST[kind];
  if (!base) return undefined;
  return founder.skills[WORK_SKILL[kind]] >= 45 ? Math.round(base * 0.75) : base;
}

/** Fonde un établissement : le coût de construction va à l'intendance, le capital à la caisse. */
export function foundBusiness(state: GameState, founder: Character, kind: BusinessKind, settlementId: string, capital: number): Business | undefined {
  const cost = foundingCost(founder, kind);
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
    startup: true,
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
  const cost = foundingCost(p, kind)!;
  if (p.money < cost + capital) return no(`Il te faut ${cost} d de travaux et ${capital} d de fonds de roulement (${cost + capital} d).`);
  const b = foundBusiness(state, p, kind, loc.settlementId, capital);
  if (!b) return no('La fondation a échoué.');
  return { ok: true, message: `Tu fondes ${b.name}, à ${state.locations[b.locationId].name}. Dès demain matin, l’affaire achète ses marchandises avec les ${capital} d de sa caisse${b.maxWorkers > 0 ? ' et embauche si elle peut payer une journée de gages' : ''}. Va sur place pour la diriger (gages, effectifs, caisse)${b.kind !== 'market' ? ' ou y travailler toi-même' : ''} ; elle figure dans l’onglet Affaires.`, minutes: 120 };
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

/** Demande locale lisible pour le joueur, avant de fonder. */
export function opportunityLabel(state: GameState, kind: BusinessKind, settlementId: string): { level: 'forte' | 'moyenne' | 'faible'; why: string } {
  const tpl = TEMPLATE[kind];
  const out = tpl?.sells[0] as ItemId;
  const rivals = businessesIn(state, settlementId).filter(b => b.kind === kind);
  const stock = rivals.reduce((a, b) => a + qty(b.stock, out), 0);
  const target = rivals.reduce((a, b) => a + (b.targets[out] ?? 0), 0);
  // pain et bière se consomment chaque jour : la clientèle se partage entre enseignes ;
  // outils et négoce ne trouvent preneur que si le concurrent en place vient à manquer
  const daily = kind === 'bakery' || kind === 'tavern';
  const level = rivals.length === 0 ? 'forte' : daily ? 'moyenne' : 'faible';
  const n = `${rivals.length} concurrent${rivals.length > 1 ? 's' : ''}`;
  const why = kind === 'market' && rivals.length ? `${n} déjà installé${rivals.length > 1 ? 's' : ''} : un second comptoir sert surtout à entreposer et revendre ce que tu rapportes d’ailleurs`
    : rivals.length === 0 ? 'aucun concurrent ici : toute la clientèle est à prendre'
    : daily ? `clientèle à partager avec ${n} (${stock} ${ITEMS[out].plural} en réserve en face)`
    : `${n} déjà installé${rivals.length > 1 ? 's' : ''}, avec ${stock} ${ITEMS[out].plural} à vendre${stock > target ? ' : difficile de s’y faire une place' : ''}`;
  return { level, why };
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

/** Fonds de roulement conseillé : de quoi garnir l'atelier en matières premières et payer trois jours de gages. */
export function recommendedCapital(kind: BusinessKind): number {
  const tpl = TEMPLATE[kind];
  if (!tpl) return 100;
  const inputs = tpl.buys.reduce((a, it) => a + (tpl.targets[it] ?? 0) * ITEMS[it].base, 0);
  const wages = tpl.maxWorkers > 0 ? tpl.wage * 8 * 3 : 0;
  return Math.ceil((inputs * (kind === 'market' ? 0.6 : 1) + wages + 40) / 25) * 25;
}

/** Somme qu'une affaire sans personnel doit avoir en caisse pour embaucher son premier ouvrier. */
export function hiringThreshold(b: Business): number { return Math.ceil(reserveFor(b) * 1.2) + 1; }

export interface Diagnosis { ok: boolean; text: string; advice?: string; need?: number }

/** Pourquoi une affaire du joueur tourne ou reste à l'arrêt, et quoi faire. */
export function businessDiagnosis(_state: GameState, b: Business): Diagnosis {
  const r = RECIPES[b.kind];
  const outputs = r ? (Object.keys(r.outputs) as ItemId[]) : [];
  const missing = r ? (Object.keys(r.inputs) as ItemId[]).find(it => qty(b.stock, it) < (r.inputs[it] ?? 0)) : undefined;
  const full = outputs.length > 0 && outputs.every(it => qty(b.stock, it) >= outputCap(b, it));
  if (b.kind === 'market') {
    return b.treasury < 20
      ? { ok: false, text: 'Caisse presque vide : le comptoir ne peut plus rien acheter.', advice: 'Dépose de l’argent, ou vends-y toi-même des marchandises rapportées d’ailleurs.', need: 60 - b.treasury }
      : { ok: true, text: 'Le comptoir achète quand les prix sont bas et revend avec une marge.' };
  }
  if (b.maxWorkers === 0) return { ok: false, text: 'Effectif maximal réglé à zéro : personne ne peut être embauché.', advice: 'Augmente le nombre d’ouvriers (bouton +).' };
  if (b.employees.length === 0) {
    const need = hiringThreshold(b);
    if (full) return { ok: false, text: 'Les réserves sont pleines : inutile d’embaucher tant que rien ne se vend.', advice: 'Baisse le stock visé pour faire baisser tes prix, ou attends les clients.' };
    if (b.treasury < need) return { ok: false, text: `Caisse trop maigre pour embaucher : il faut ${need} d pour garantir une journée de gages (il y a ${b.treasury} d).`,
      advice: `Dépose au moins ${need - b.treasury} d dans la caisse (sur place), ou travaille-y toi-même : ton travail produit sans coûter de gages.`, need: need - b.treasury };
    return { ok: true, text: 'La caisse permet d’embaucher : un ouvrier sera pris au prochain matin, s’il y a un candidat sans emploi.' };
  }
  if (missing) return { ok: false, text: `Il manque des ${ITEMS[missing].plural} : la production est à l’arrêt.`, advice: b.treasury < 20 ? 'La caisse ne permet plus d’en acheter : dépose de l’argent.' : 'L’affaire en rachètera au prochain matin si un vendeur en a.' };
  if (full) return { ok: true, text: 'Les réserves sont pleines : la production attend les ventes.', advice: 'Si cela dure, baisse le stock visé ou réduis l’effectif.' };
  return { ok: true, text: `L’affaire tourne avec ${b.employees.length} ouvrier${b.employees.length > 1 ? 's' : ''}.` };
}

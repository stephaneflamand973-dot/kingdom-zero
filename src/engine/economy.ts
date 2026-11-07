// ─────────────────────────────────────────────────────────────
// Économie : prix, transactions atomiques, production, gestion.
// Invariant : l'argent et les objets ne sont jamais créés lors d'un échange ;
// seule la production (recettes) crée des biens et seule la consommation en détruit.
// ─────────────────────────────────────────────────────────────
import { incidentPrice, incidentYield } from './incidents';
import { ITEMS, RECIPES, TOOL_WEAR_PER_TOOL, PROFESSION_BY_BUSINESS, WORK_SKILL } from './data';
import { logEvent } from './events';
import { SEASON_YIELD, toDate } from './time';
import type { Business, Character, GameState, Inventory, ItemId } from './types';
import { addItem, allBusinesses, clamp, fullName, hasTrait, isOpen, ownerName, qty , businessesIn, businessSettlement, hereSettlement, settlementIdOf } from './util';
import { getRelation, modifyRelation } from './social';

export type Party = { t: 'c' | 'b' | 'o'; id: string };
export const P = {
  c: (id: string): Party => ({ t: 'c', id }),
  b: (id: string): Party => ({ t: 'b', id }),
  o: (id: string): Party => ({ t: 'o', id }), // organisation (phase 4)
};

function holder(state: GameState, p: Party): { money: number; inv: Inventory; set: (m: number) => void } {
  if (p.t === 'c') {
    const c = state.characters[p.id];
    return { money: c.money, inv: c.inventory, set: m => { c.money = m; } };
  }
  if (p.t === 'o') {
    const o = state.orgs[p.id];
    return { money: o.treasury, inv: o.stash, set: m => { o.treasury = m; } };
  }
  const b = state.businesses[p.id];
  return { money: b.treasury, inv: b.stock, set: m => { b.treasury = m; } };
}

export function moneyOf(state: GameState, p: Party): number { return holder(state, p).money; }

/** Transfert d'argent strict : échoue (sans effet) si les fonds sont insuffisants. */
export function transferMoney(state: GameState, from: Party, to: Party, amount: number): boolean {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`Montant invalide ${amount}`);
  if (amount === 0) return true;
  const a = holder(state, from), b = holder(state, to);
  if (a.money < amount) return false;
  // transfert vers soi-même : sans effet (sinon la seconde écriture, faite sur une valeur périmée, créerait de l'argent)
  if (from.t === to.t && from.id === to.id) return true;
  a.set(a.money - amount);
  b.set(b.money + amount);
  return true;
}

export function transferItem(state: GameState, from: Party, to: Party, item: ItemId, n: number): boolean {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Quantité invalide ${n}`);
  const a = holder(state, from), b = holder(state, to);
  if (qty(a.inv, item) < n) return false;
  addItem(a.inv, item, -n);
  addItem(b.inv, item, n);
  return true;
}

/** Échange atomique : tout ou rien. */
export function trade(state: GameState, buyer: Party, seller: Party, item: ItemId, n: number, unitPrice: number): boolean {
  const total = n * unitPrice;
  if (moneyOf(state, buyer) < total) return false;
  if (qty(holder(state, seller).inv, item) < n) return false;
  transferMoney(state, buyer, seller, total);
  transferItem(state, seller, buyer, item, n);
  state.stats.trades += 1;
  return true;
}

// ── Prix ──────────────────────────────────────────────────────

function pressure(b: Business, item: ItemId): number {
  const target = b.targets[item] ?? 6;
  return (target + 2) / (qty(b.stock, item) + 2);
}

/** Prix demandé par l'établissement (offre/demande locale via le stock). */
export function askPrice(state: GameState, b: Business, item: ItemId): number {
  const base = ITEMS[item].base;
  let p = base * clamp(Math.sqrt(pressure(b, item)), 0.6, 2.6);
  if (b.kind === 'market') p *= 1.15;                   // marge du revendeur
  if (b.kind === 'tavern' && item === 'bread') p *= 1.3; // repas servi
  p *= incidentPrice(state, b);                          // foire (phase 6)
  return Math.max(1, Math.round(p));
}

/** Prix offert par l'établissement pour racheter un bien. */
export function bidPrice(_state: GameState, b: Business, item: ItemId): number {
  const base = ITEMS[item].base;
  const p = base * clamp(Math.sqrt(pressure(b, item)), 0.4, 1.5) * 0.75;
  return Math.max(1, Math.round(p));
}

/** Modificateur personnel : la relation avec le propriétaire et l'habileté commerciale. */
export function personalFactor(state: GameState, b: Business, c: Character, side: 'buy' | 'sell'): number {
  let f = 1;
  if (b.ownerId && b.ownerId !== c.id) {
    const rel = getRelation(state, b.ownerId, c.id);
    f -= clamp(rel.affinity, -100, 100) / 600; // ±16 %
  }
  f -= c.skills.commerce / 1000; // jusqu'à -10 %
  // Achat : facteur < 1 = remise. Vente : facteur > 1 = meilleure offre.
  return side === 'buy' ? clamp(f, 0.75, 1.3) : clamp(2 - f, 0.75, 1.2);
}

export function priceForCharacter(state: GameState, b: Business, c: Character, item: ItemId, side: 'buy' | 'sell'): number {
  const raw = side === 'buy' ? askPrice(state, b, item) : bidPrice(state, b, item);
  const f = personalFactor(state, b, c, side);
  return Math.max(1, Math.round(raw * f));
}

/** Le propriétaire accepte-t-il de traiter avec ce personnage ? */
export function tradeRefusal(state: GameState, b: Business, c: Character): string | null {
  if (!b.ownerId || b.ownerId === c.id) return null;
  const rel = getRelation(state, b.ownerId, c.id);
  if ((rel.trust <= -40 && rel.affinity <= -15) || rel.affinity <= -60) return b.ownerId;
  return null;
}

/** Établissements ouverts vendant un bien, triés par prix croissant pour l'acheteur. */
export function sellersOf(state: GameState, item: ItemId, hour: number, buyer: Character, ignoreHours = false): { b: Business; price: number }[] {
  const out: { b: Business; price: number }[] = [];
  // On n'achète que dans la localité où l'on se trouve
  for (const b of businessesIn(state, hereSettlement(state, buyer).id)) {
    if (!b.sells.includes(item) || qty(b.stock, item) < 1) continue;
    if (!ignoreHours && !isOpen(b, hour)) continue;
    if (tradeRefusal(state, b, buyer)) continue;
    out.push({ b, price: priceForCharacter(state, b, buyer, item, 'buy') });
  }
  out.sort((x, y) => x.price - y.price || (x.b.id < y.b.id ? -1 : 1));
  return out;
}

// ── Production ───────────────────────────────────────────────

export function laborMultiplier(b: Business): number {
  const r = RECIPES[b.kind];
  if (r?.usesTools && qty(b.stock, 'tools') === 0) return 0.5; // sans outils : moitié moins efficace
  return 1;
}

export function outputCap(b: Business, item: ItemId): number { return (b.targets[item] ?? 10) * 3; }

/** Convertit le travail accumulé en biens selon la recette. Renvoie les lots produits. */
export function runProduction(state: GameState, b: Business): number {
  const r = RECIPES[b.kind];
  if (!r) return 0;
  const d = toDate(state.time);
  // Saison (pour les cultures) et spécialisation de la localité (terres, filons)
  const mult = (r.seasonal ? SEASON_YIELD[d.season] : 1) * (businessSettlement(state, b).yields[b.kind] ?? 1) * incidentYield(state, b);
  const effLabor = r.labor / mult;
  let batches = 0;
  while (b.laborPool >= effLabor) {
    const full = (Object.keys(r.outputs) as ItemId[]).every(it => qty(b.stock, it) >= outputCap(b, it));
    if (full) break;
    const missing = (Object.keys(r.inputs) as ItemId[]).find(it => qty(b.stock, it) < (r.inputs[it] ?? 0));
    if (missing) {
      if (b.lastShortageDay[missing] !== d.day) {
        b.lastShortageDay[missing] = d.day;
        logEvent(state, {
          type: 'shortage', businessId: b.id, locationId: b.locationId, importance: 2,
          actorId: b.ownerId ?? undefined,
          text: `${b.name} manque de ${ITEMS[missing].plural} : la production est à l'arrêt.`,
          witnesses: b.employees.slice(), data: { item: missing },
        });
      }
      break;
    }
    for (const it of Object.keys(r.inputs) as ItemId[]) {
      const n = r.inputs[it]!;
      addItem(b.stock, it, -n);
      addItem(state.ledger.consumed, it, n);
    }
    for (const it of Object.keys(r.outputs) as ItemId[]) {
      const n = r.outputs[it]!;
      addItem(b.stock, it, n);
      addItem(b.produced, it, n);
      addItem(state.ledger.produced, it, n);
    }
    b.laborPool -= effLabor;
    batches++;
    if (r.usesTools) {
      b.toolWear += r.labor;
      while (b.toolWear >= TOOL_WEAR_PER_TOOL && qty(b.stock, 'tools') > 0) {
        b.toolWear -= TOOL_WEAR_PER_TOOL;
        addItem(b.stock, 'tools', -1);
        addItem(state.ledger.consumed, 'tools', 1);
      }
      b.toolWear = Math.min(b.toolWear, TOOL_WEAR_PER_TOOL);
    }
  }
  b.laborPool = Math.min(b.laborPool, effLabor * 2); // le travail ne se stocke pas indéfiniment
  return batches;
}

// ── Salaires ─────────────────────────────────────────────────

/** Paie une heure de travail. Si la caisse est vide, la dette salariale s'accumule. */
export function payWage(state: GameState, b: Business, worker: Character, amount: number): boolean {
  if (b.ownerId === worker.id) return true;
  if (transferMoney(state, { t: 'b', id: b.id }, { t: 'c', id: worker.id }, amount)) return true;
  worker.unpaidWages += amount;
  const day = toDate(state.time).day;
  const key = `unpaid_${worker.id}`;
  if (b.lastShortageDay[key as ItemId] !== day) {
    (b.lastShortageDay as Record<string, number>)[key] = day;
    if (b.ownerId) modifyRelation(state, worker.id, b.ownerId, -4, -10);
    logEvent(state, {
      type: 'unpaid', actorId: b.ownerId ?? undefined, targetId: worker.id, businessId: b.id,
      locationId: b.locationId, importance: 2,
      text: `${b.name} ne peut plus payer ${fullName(worker)} : la caisse est vide (${worker.unpaidWages} d dus).`,
      witnesses: [worker.id],
    });
  }
  return false;
}

export function reserveFor(b: Business): number {
  return b.wage * 8 * Math.max(1, b.employees.length) * 3 + 60;
}

// ── Gestion quotidienne par le propriétaire (ou l'intendance) ─

export function manageBusiness(state: GameState, b: Business, procurementOnly = false): void {
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  const reserve = reserveFor(b);

  // 1. Rembourser les salaires impayés en priorité
  for (const eid of b.employees) {
    const e = state.characters[eid];
    if (e.unpaidWages > 0) {
      const pay = Math.min(e.unpaidWages, b.treasury);
      if (pay > 0 && transferMoney(state, P.b(b.id), P.c(e.id), pay)) {
        e.unpaidWages -= pay;
        if (owner) modifyRelation(state, e.id, owner.id, 1, 4);
      }
    }
  }

  // 2. Approvisionnement en intrants (et achats de revente pour le marché)
  for (const item of b.buys) {
    const target = b.targets[item] ?? 0;
    let need = target - qty(b.stock, item);
    if (need <= 0) continue;
    // L'approvisionnement est local : l'inter-localité passe par les caravanes
    const sellers = businessesIn(state, settlementIdOf(state, b.locationId))
      .filter(s => s.id !== b.id && s.sells.includes(item) && qty(s.stock, item) > 0)
      .filter(s => !(b.kind !== 'market' && s.kind === 'market' && s.ownerId === null))
      .map(s => ({ s, price: askPrice(state, s, item) }))
      .sort((x, y) => x.price - y.price || (x.s.id < y.s.id ? -1 : 1));
    for (const { s, price } of sellers) {
      if (need <= 0) break;
      // Le marché n'achète que pour revendre avec profit
      if (b.kind === 'market' && price > ITEMS[item].base) continue;
      // Les autres n'achètent au marché que s'ils sont en pénurie sévère
      if (b.kind !== 'market' && s.kind === 'market' && qty(b.stock, item) > target / 3) continue;
      const budget = b.treasury - Math.floor(reserve / 2);
      const keep = s.kind === 'market' ? 0 : Math.floor((s.targets[item] ?? 0) / 4); // le vendeur garde un peu pour ses clients
      const affordable = Math.floor(budget / price);
      const n = Math.min(need, qty(s.stock, item) - keep, affordable);
      if (n <= 0) continue;
      if (trade(state, P.b(b.id), P.b(s.id), item, n, price)) {
        need -= n;
        logEvent(state, {
          type: 'trade', businessId: b.id, locationId: b.locationId, importance: 1,
          text: `${b.name} achète ${n} ${n > 1 ? ITEMS[item].plural : ITEMS[item].name} à ${s.name} (${price} d l'unité).`,
          data: { item, n, price, seller: s.id },
        });
      }
    }
  }

  if (procurementOnly) return;

  // 3. Rémunération du propriétaire : subsistance si nécessaire, dividende raisonnable sinon
  //    (un propriétaire joueur gère lui-même la caisse)
  if (owner && !owner.isPlayer) {
    const comfort = hasTrait(owner, 'avare') || hasTrait(owner, 'ambitieux') ? 400 : 220;
    if (owner.money < 30 && b.treasury > 20) {
      const draw = Math.min(40, Math.floor(b.treasury / 4));
      transferMoney(state, P.b(b.id), P.c(owner.id), draw);
    } else if (b.treasury > reserve * 1.6 && owner.money < comfort) {
      const take = Math.min(comfort - owner.money, Math.floor((b.treasury - reserve) * 0.4));
      if (take > 0 && transferMoney(state, P.b(b.id), P.c(owner.id), take)) {
        logEvent(state, {
          type: 'dividend', actorId: owner.id, businessId: b.id, importance: 1,
          text: `${fullName(owner)} prélève ${take} d sur les bénéfices de ${b.name}.`,
        });
      }
    } else if (b.treasury > reserve * 3 && (b.employees.length >= b.maxWorkers || !isHiring(state, b))) {
      // phase 6 : une caisse qui déborde sans pouvoir embaucher verse un dividende (l'argent ne dort pas)
      const take = Math.floor((b.treasury - reserve * 2) * 0.5);
      if (take > 0 && transferMoney(state, P.b(b.id), P.c(owner.id), take)) {
        logEvent(state, { type: 'dividend', actorId: owner.id, businessId: b.id, importance: 1,
          text: `${fullName(owner)} retire ${take} d de la caisse pleine de ${b.name}.` });
      }
    } else if (owner.money > comfort * 1.5 && b.treasury < reserve) {
      // Le propriétaire renfloue son affaire avec ses deniers personnels
      const inject = Math.min(owner.money - comfort, reserve - b.treasury);
      if (inject > 0) transferMoney(state, P.c(owner.id), P.b(b.id), inject);
    }
  } else if (!owner && b.kind !== 'manor' && b.treasury > reserve * 1.5) {
    // Affaire sous tutelle (phase 6) : les bénéfices remontent aux caisses publiques au lieu de dormir
    // (sans quoi l'argent du village s'y accumule et la population s'appauvrit jusqu'à la famine)
    const manorId = businessSettlement(state, b).manorId;
    const surplus = Math.floor(b.treasury - reserve * 1.2);
    if (surplus > 0 && manorId !== b.id && transferMoney(state, P.b(b.id), P.b(manorId), surplus)) {
      logEvent(state, { type: 'tax', businessId: b.id, importance: 1, text: `L'intendance verse au trésor public ${surplus} d de bénéfices de ${b.name}, sous sa tutelle.` });
    }
  }

  // 4. Embauche / licenciement selon la trésorerie et la demande
  const isManor = b.kind === 'manor';
  const day = toDate(state.time).day;
  const settled = day - b.lastStaffChangeDay >= 4;
  if (isManor) {
    // La garde est prioritaire : l'intendance maintient deux gardes tant qu'elle le peut
    const guards = b.employees.filter(id => state.characters[id].profession === 'garde').length;
    if (guards < 2 && b.treasury > 150) {
      const g = hireBest(state, b, undefined, 'garde');
      if (g) { b.lastStaffChangeDay = day; return; }
    }
  }
  // Moissons (phase 6) : l'été et l'automne, une ferme aisée prend des journaliers saisonniers
  if (b.kind === 'farm') {
    const season = toDate(state.time).season;
    const harvest = season === 1 || season === 2;
    b.seasonal = (b.seasonal ?? []).filter(id => b.employees.includes(id));
    if (!harvest && b.seasonal.length) {
      for (const id of b.seasonal) {
        const w = state.characters[id];
        fireEmployee(state, b, w, 'les moissons sont finies');
        if (b.ownerId) modifyRelation(state, w.id, b.ownerId, 12, 6); // départ prévu, sans rancune
      }
      b.seasonal = [];
      b.lastStaffChangeDay = day;
      return;
    }
    if (harvest && b.seasonal.length < 2 && b.treasury > reserve * 1.3 && settled) {
      const h = hireBest(state, b);
      if (h) { b.seasonal.push(h.id); b.lastStaffChangeDay = day; return; }
    }
  }
  const outputs = b.sells.filter(i => RECIPES[b.kind]?.outputs[i]);
  const overproducing = outputs.length > 0 && outputs.every(i => qty(b.stock, i) > (b.targets[i] ?? 0) * 2.5);
  const cannotPay = isManor
    ? b.treasury < (businessSettlement(state, b).infrastructure < 45 ? 70 : 140) && b.employees.some(id => state.characters[id].profession === 'journalier')
    : b.treasury < b.wage * 8 * b.employees.length;
  if (isHiring(state, b)) {
    if (hireBest(state, b)) b.lastStaffChangeDay = day;
  } else if (b.employees.length > 0 && (cannotPay || (overproducing && b.treasury < reserve * 1.2 && settled))) {
    const candidates = b.employees.map(id => state.characters[id]).filter(e => !(isManor && e.profession !== 'journalier'));
    const fired = candidates[candidates.length - 1];
    if (fired) {
      fireEmployee(state, b, fired, cannotPay ? 'la caisse ne permet plus de payer' : 'les réserves débordent, le travail manque');
      b.lastStaffChangeDay = day;
    }
  }
}

/** Règle unique d'embauche, utilisée par le propriétaire comme par les candidats. */
export function isHiring(state: GameState, b: Business): boolean {
  if (b.employees.length >= b.maxWorkers) return false;
  const day = toDate(state.time).day;
  if (day - b.lastStaffChangeDay < 2) return false;
  if (b.kind === 'manor') {
    // phase 6 : des chemins en mauvais état font embaucher des journaliers plus tôt
    const roadsBad = businessSettlement(state, b).infrastructure < 45;
    return b.treasury > (roadsBad ? 150 : 260) + b.employees.length * (roadsBad ? 50 : 60);
  }
  const outputs = b.sells.filter(i => RECIPES[b.kind]?.outputs[i]);
  const underproducing = outputs.some(i => qty(b.stock, i) < (b.targets[i] ?? 0));
  // une caisse qui déborde fait travailler du monde, même sans pénurie (phase 5 : éviter la spirale déflationniste)
  return (underproducing && b.treasury > reserveFor(b) * 1.2) || b.treasury > reserveFor(b) * 3;
}

export function hireBest(state: GameState, b: Business, candidates?: Character[], role?: 'garde'): Character | undefined {
  const skill = role === 'garde' ? 'combat' : WORK_SKILL[b.kind];
  const here = settlementIdOf(state, b.locationId);
  const pool = (candidates ?? state.characterOrder.map(id => state.characters[id]))
    .filter(c => settlementIdOf(state, c.homeId) === here && c.profession !== 'seigneur' && c.profession !== 'soldat')
    .filter(c => c.alive && !c.isPlayer && !c.employerId && c.age >= 14 && c.age < 70 && !state.businessOrder.some(id => state.businesses[id].ownerId === c.id));
  if (pool.length === 0) return undefined;
  const scored = pool
    .map(c => ({ c, rel: b.ownerId ? getRelation(state, b.ownerId, c.id) : { affinity: 0, trust: 0 } }))
    .filter(x => x.rel.affinity > -25 && x.rel.trust > -30)
    .map(x => ({ c: x.c, score: x.c.skills[skill] + x.rel.affinity / 3 + x.rel.trust / 4 }))
    .sort((x, y) => y.score - x.score || (x.c.id < y.c.id ? -1 : 1));
  if (!scored.length) return undefined;
  const hired = scored[0].c;
  hired.employerId = b.id;
  hired.jobSince = toDate(state.time).day;
  // les arriérés d'un ancien employeur ne concernent pas le nouveau (sinon : démission immédiate en boucle)
  hired.unpaidWages = 0;
  hired.profession = role ?? (b.kind === 'manor' ? 'journalier' : PROFESSION_BY_BUSINESS[b.kind]);
  hired.goal = { kind: 'epargner', target: hired.money + 150 };
  b.employees.push(hired.id);
  if (b.ownerId) modifyRelation(state, hired.id, b.ownerId, 6, 5);
  logEvent(state, {
    type: 'hire', actorId: b.ownerId ?? undefined, targetId: hired.id, businessId: b.id, locationId: b.locationId,
    importance: 2, text: `${ownerName(state, b)} embauche ${fullName(hired)} à ${b.name} (${b.wage} d de l'heure).`,
    witnesses: [hired.id],
  });
  return hired;
}

export function fireEmployee(state: GameState, b: Business, e: Character, reason: string, quit = false): void {
  // Un contrat de travail en cours prend fin avec le départ
  for (const k of state.contracts ?? []) if (k.status === 'active' && k.workerId === e.id && k.businessId === b.id) { k.status = 'ended'; k.endReason = reason; }
  b.employees = b.employees.filter(id => id !== e.id);
  e.employerId = undefined;
  e.profession = 'sans_emploi';
  e.unpaidWages = 0; // l'arriéré est perdu : personne ne le réclamera plus (simple compteur, aucun denier en jeu)
  e.goal = { kind: 'trouver_emploi' };
  if (b.ownerId) modifyRelation(state, e.id, b.ownerId, quit ? -6 : -12, quit ? -10 : -6);
  logEvent(state, {
    type: quit ? 'quit' : 'fire', actorId: quit ? e.id : b.ownerId ?? undefined, targetId: quit ? b.ownerId ?? undefined : e.id,
    businessId: b.id, locationId: b.locationId, importance: 2,
    text: quit
      ? `${fullName(e)} quitte ${b.name} : ${reason}.`
      : `${ownerName(state, b)} renvoie ${fullName(e)} de ${b.name} : ${reason}.`,
    witnesses: [e.id],
  });
}

/** Ajustement hebdomadaire des salaires selon la santé financière. */
export function weeklyWageReview(state: GameState, b: Business): void {
  const reserve = reserveFor(b);
  if (b.daysInDeficit >= 4 && b.wage > 2) {
    b.wage -= 1;
    logEvent(state, { type: 'production', businessId: b.id, importance: 2, witnesses: b.employees.slice(),
      text: `${b.name} réduit ses salaires à ${b.wage} d de l'heure après une semaine difficile.` });
  } else if (b.treasury > reserve * 3 && b.wage < 9) {
    b.wage += 1;
    logEvent(state, { type: 'production', businessId: b.id, importance: 2, witnesses: b.employees.slice(),
      text: `${b.name} augmente ses salaires à ${b.wage} d de l'heure.` });
  }
  b.daysInDeficit = 0;
}

export function totalMoney(state: GameState): number {
  let t = 0;
  for (const id of state.characterOrder) t += state.characters[id].money;
  for (const id of state.businessOrder) t += state.businesses[id].treasury;
  for (const id of state.orgOrder ?? []) t += state.orgs[id].treasury;
  return t;
}

export function totalItems(state: GameState): Inventory {
  const out: Inventory = {};
  for (const id of state.characterOrder) for (const [k, v] of Object.entries(state.characters[id].inventory)) addItem(out, k as ItemId, v!);
  for (const id of state.businessOrder) for (const [k, v] of Object.entries(state.businesses[id].stock)) addItem(out, k as ItemId, v!);
  for (const cv of state.caravans) if (cv.status === 'en_route') for (const [k, v] of Object.entries(cv.cargo)) addItem(out, k as ItemId, v!);
  for (const cv of state.convoys ?? []) for (const [k, v] of Object.entries(cv.cargo)) addItem(out, k as ItemId, v!);
  for (const pr of state.properties) for (const [k, v] of Object.entries(pr.storage)) addItem(out, k as ItemId, v!);
  for (const id of state.orgOrder ?? []) for (const [k, v] of Object.entries(state.orgs[id].stash)) addItem(out, k as ItemId, v!);
  return out;
}

/** Prix de référence du village pour un bien (le moins cher disponible, tous horaires). */
export function referencePrice(state: GameState, item: ItemId, settlementId?: string): number | undefined {
  const pool = settlementId ? businessesIn(state, settlementId) : allBusinesses(state);
  const prices = pool.filter(b => b.sells.includes(item) && qty(b.stock, item) > 0).map(b => askPrice(state, b, item));
  return prices.length ? Math.min(...prices) : undefined;
}

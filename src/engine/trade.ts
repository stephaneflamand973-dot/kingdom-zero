// ─────────────────────────────────────────────────────────────
// Commerce régional (phase 3) : caravanes marchandes entre localités.
// Les marchands n'achètent que s'ils espèrent une marge, d'après les derniers prix
// connus de la destination (relevés hebdomadaires : l'information a du retard).
// La cargaison existe physiquement pendant le trajet et figure dans le bilan matière.
// ─────────────────────────────────────────────────────────────
import { CARAVAN_CAPACITY, ITEMS, ITEM_IDS, TRANSPORT_COST, WEIGHT } from './data';
import { askPrice, bidPrice, outputCap, P, reserveFor, trade, transferMoney } from './economy';
import { logEvent } from './events';
import type { Business, Caravan, Character, GameState, Inventory, ItemId } from './types';
import { addItem, businessesIn, fullName, newId, npcs, qty, residents, roadPath, settlementIdOf } from './util';

export function weightOf(inv: Inventory): number {
  let w = 0;
  for (const it of ITEM_IDS) w += qty(inv, it) * WEIGHT[it];
  return w;
}

export function carryCapacity(c: Character): number {
  return 40 + c.attributes.force * 4;
}

/** Prix connus d'une localité : dernier relevé hebdomadaire, à défaut l'état du jour (début de partie). */
export function knownPrices(state: GameState, settlementId: string): Partial<Record<ItemId, number>> {
  const h = state.settlements[settlementId].history;
  if (h.length) return h[h.length - 1].prices;
  const out: Partial<Record<ItemId, number>> = {};
  for (const it of ITEM_IDS) {
    const prices = businessesIn(state, settlementId).filter(b => b.sells.includes(it) && qty(b.stock, it) > 0).map(b => askPrice(state, b, it));
    if (prices.length) out[it] = Math.min(...prices);
  }
  return out;
}

export function marketOf(state: GameState, merchant: Character): Business | undefined {
  return businessesIn(state, settlementIdOf(state, merchant.homeId)).find(b => b.kind === 'market' && b.ownerId === merchant.id)
    ?? Object.values(state.businesses).find(b => b.kind === 'market' && b.ownerId === merchant.id);
}

interface Lot { source: Business; item: ItemId; n: number; price: number }

/** Ce qu'une localité peut absorber d'un bien, d'après ce que l'on sait de ses établissements. */
export function demandEstimate(state: GameState, settlementId: string, item: ItemId): number {
  let d = 0;
  for (const b of businessesIn(state, settlementId)) {
    if (!b.buys.includes(item)) continue;
    d += Math.round((b.targets[item] ?? 0) * (b.kind === 'market' ? 2 : 1));
  }
  return d;
}

/** Prix de vente espéré : l'expérience du marchand d'abord, sinon le prix connu décoté, sinon le prix de base. */
function expectedSale(state: GameState, to: string, item: ItemId, merchantId?: string): number {
  const mem = merchantId ? state.tradeMemory[`${merchantId}:${to}:${item}`] : undefined;
  if (mem !== undefined) return mem;
  const k = knownPrices(state, to)[item];
  return Math.round(k ? k * 0.68 : ITEMS[item].base * 0.9); // on revend au prix d'achat des établissements, sous leur prix affiché
}

/** Choisit et achète une cargaison rentable dans la localité `from` à destination de `to`. */
function loadCargo(state: GameState, fund: Business, from: string, to: string, hours: number): { cargo: Inventory; cost: number; lots: Lot[] } {
  const merchantId = fund.ownerId ?? undefined;
  const cands: { item: ItemId; source: Business; price: number; marginPerWeight: number; avail: number }[] = [];
  for (const it of ITEM_IDS) {
    if (demandEstimate(state, to, it) <= 0) continue; // personne n'en achète là-bas
    const sale = expectedSale(state, to, it, merchantId);
    for (const s of businessesIn(state, from)) {
      if (!s.sells.includes(it)) continue;
      const keep = s.id === fund.id ? Math.ceil((s.targets[it] ?? 0) / 3) : Math.ceil((s.targets[it] ?? 0) / 2);
      const avail = qty(s.stock, it) - keep;
      if (avail <= 0) continue;
      const price = askPrice(state, s, it);
      const margin = sale - price - TRANSPORT_COST * hours * WEIGHT[it];
      if (margin >= 1.5) cands.push({ item: it, source: s, price, marginPerWeight: margin / WEIGHT[it], avail });
    }
  }
  cands.sort((a, b) => b.marginPerWeight - a.marginPerWeight || (a.source.id < b.source.id ? -1 : 1));
  const cargo: Inventory = {};
  const lots: Lot[] = [];
  let cost = 0, weight = 0;
  for (const c of cands) {
    const budget = fund.treasury - Math.floor(reserveFor(fund) / 2);
    const room = Math.ceil(demandEstimate(state, to, c.item) * 0.6) - qty(cargo, c.item);
    const n = Math.min(c.avail, room, Math.floor(budget / c.price), Math.floor((CARAVAN_CAPACITY - weight) / WEIGHT[c.item]), 40);
    if (n <= 0) continue;
    // achat : l'argent va au vendeur (sa propre halle : la marchandise est prise sur le stock, comptée à son prix)
    if (c.source.id !== fund.id && !transferMoney(state, P.b(fund.id), P.b(c.source.id), n * c.price)) continue;
    cost += n * c.price;
    addItem(c.source.stock, c.item, -n);
    addItem(cargo, c.item, n);
    weight += n * WEIGHT[c.item];
    lots.push({ source: c.source, item: c.item, n, price: c.price });
    state.stats.trades += 1;
  }
  return { cargo, cost, lots };
}

/** Chaque matin, les marchands disponibles décident d'un voyage (lundi et jeudi). */
export function merchantsPlanTrips(state: GameState): void {
  for (const m of npcs(state)) {
    if (m.profession !== 'marchand' || m.sick > 0) continue;
    if (state.caravans.some(c => c.status === 'en_route' && c.merchantId === m.id)) continue;
    const market = marketOf(state, m);
    if (!market) continue;
    const home = settlementIdOf(state, market.locationId);
    if (settlementIdOf(state, m.locationId) !== home) continue;
    // le marchand engage ses deniers personnels dans l'expédition (au-delà de sa réserve)
    if (m.money > 80) transferMoney(state, P.c(m.id), P.b(market.id), m.money - 80);
    // destination la plus prometteuse : on essaie chaque localité et on garde la meilleure cargaison simulée
    let best: { to: string; hours: number; value: number } | undefined;
    for (const to of state.settlementOrder) {
      if (to === home) continue;
      const path = roadPath(state, home, to);
      if (!path) continue;
      let value = 0;
      for (const it of ITEM_IDS) {
        if (demandEstimate(state, to, it) <= 0) continue;
        const local = businessesIn(state, home).filter(b => b.sells.includes(it) && qty(b.stock, it) > 0).map(b => askPrice(state, b, it));
        if (!local.length) continue;
        const gain = expectedSale(state, to, it, m.id) - Math.min(...local) - TRANSPORT_COST * path.hours * WEIGHT[it];
        if (gain > 0) value += gain / WEIGHT[it];
      }
      if (value > 0 && (!best || value > best.value)) best = { to, hours: path.hours, value };
    }
    if (!best) continue;
    const { cargo, cost } = loadCargo(state, market, home, best.to, best.hours);
    if (weightOf(cargo) < 10) { // pas assez pour justifier le voyage : on remet en rayon
      for (const it of ITEM_IDS) if (qty(cargo, it)) addItem(market.stock, it, qty(cargo, it));
      continue;
    }
    depart(state, m, home, best.to, best.hours, cargo, cost, false);
  }
}

/** Provisions de route : environ une miche par demi-journée de marche. */
function buyProvisions(state: GameState, m: Character, settlementId: string, hours: number): void {
  const need = Math.ceil(hours / 10) + 1 - qty(m.inventory, 'bread') - qty(m.inventory, 'grain');
  if (need <= 0) return;
  const seller = businessesIn(state, settlementId).filter(b => b.sells.includes('bread') && qty(b.stock, 'bread') >= need)
    .sort((a, b) => askPrice(state, a, 'bread') - askPrice(state, b, 'bread'))[0];
  if (seller) trade(state, P.c(m.id), P.b(seller.id), 'bread', need, askPrice(state, seller, 'bread'));
}

function depart(state: GameState, m: Character, from: string, to: string, hours: number, cargo: Inventory, cost: number, returning: boolean): Caravan {
  const path = roadPath(state, from, to)!;
  buyProvisions(state, m, from, hours);
  const cv: Caravan = {
    id: newId(state, 'v'), merchantId: m.id, from, to, cargo, cost, departTime: state.time,
    arriveTime: state.time + hours * 60, status: 'en_route', returning,
  };
  state.caravans.push(cv);
  m.locationId = path.roads[0].locationId;
  m.activity = { kind: 'travel', locationId: m.locationId, since: state.time, until: cv.arriveTime, targetId: state.settlements[to].squareId,
    note: `Mène une caravane vers ${state.settlements[to].name}` };
  const desc = ITEM_IDS.filter(it => qty(cargo, it)).map(it => `${qty(cargo, it)} ${ITEMS[it].plural}`).join(', ');
  logEvent(state, {
    type: 'caravan', actorId: m.id, locationId: state.settlements[from].squareId, importance: returning ? 1 : 2,
    text: returning
      ? `${fullName(m)} reprend la route de ${state.settlements[to].name}${desc ? ` avec ${desc}` : ' à vide'}.`
      : `${fullName(m)} part pour ${state.settlements[to].name} avec une caravane : ${desc}.`,
    witnesses: residents(state, from).filter(c => c.locationId === state.settlements[from].squareId).map(c => c.id),
    data: { caravan: cv.id },
  });
  return cv;
}

/** Vend une cargaison dans une localité : producteurs qui en manquent d'abord, puis le marché. */
function sellCargo(state: GameState, cv: Caravan, settlementId: string, payTo: Business): number {
  let revenue = 0;
  for (const it of ITEM_IDS) {
    let left = qty(cv.cargo, it);
    if (!left) continue;
    const start = left, rev0 = revenue;
    const buyers = businessesIn(state, settlementId)
      .filter(b => b.id !== payTo.id && b.buys.includes(it))
      .sort((a, b) => Number(a.kind === 'market') - Number(b.kind === 'market') || bidPrice(state, b, it) - bidPrice(state, a, it));
    for (const b of buyers) {
      if (left <= 0) break;
      const price = bidPrice(state, b, it);
      const room = (b.kind === 'market' ? outputCap(b, it) : (b.targets[it] ?? 0) * 2) - qty(b.stock, it);
      const n = Math.min(left, room, Math.floor(b.treasury / price));
      if (n <= 0) continue;
      transferMoney(state, P.b(b.id), P.b(payTo.id), n * price);
      addItem(cv.cargo, it, -n);
      addItem(b.stock, it, n);
      left -= n;
      revenue += n * price;
      state.stats.trades += 1;
    }
    // le marchand retient ce qu'il a réellement obtenu (les invendus comptent pour rien)
    state.tradeMemory[`${cv.merchantId}:${settlementId}:${it}`] = Math.floor((revenue - rev0) / start);
  }
  return revenue;
}

/** Chaque heure : arrivées des caravanes et des voyageurs. */
export function processCaravans(state: GameState): void {
  for (const cv of state.caravans) {
    if (cv.status !== 'en_route' || cv.arriveTime > state.time) continue;
    const m = state.characters[cv.merchantId];
    const dest = state.settlements[cv.to];
    const market = m.alive ? marketOf(state, m) : undefined;
    cv.status = 'arrived';
    if (!m.alive || !market) {
      // marchand mort en route : la cargaison échoit à l'intendance du lieu d'arrivée
      for (const it of ITEM_IDS) if (qty(cv.cargo, it)) { addItem(state.businesses[dest.manorId].stock, it, qty(cv.cargo, it)); delete cv.cargo[it]; }
      continue;
    }
    m.locationId = dest.squareId;
    m.activity = { kind: 'idle', locationId: dest.squareId, since: state.time, note: `Vient d’arriver de ${state.settlements[cv.from].name}` };
    if (cv.returning) {
      // retour au pays : la marchandise rejoint la halle
      for (const it of ITEM_IDS) if (qty(cv.cargo, it)) { addItem(market.stock, it, qty(cv.cargo, it)); delete cv.cargo[it]; }
      logEvent(state, { type: 'caravan', actorId: m.id, locationId: dest.squareId, importance: 1, text: `${fullName(m)} rentre à ${dest.name} et décharge sa caravane à ${market.name}.` });
      continue;
    }
    const revenue = sellCargo(state, cv, cv.to, market);
    const profit = revenue - cv.cost;
    logEvent(state, {
      type: 'caravan', actorId: m.id, locationId: dest.squareId, importance: 2,
      text: `La caravane de ${fullName(m)} arrive à ${dest.name} : ${revenue} d de ventes pour ${cv.cost} d d'achats (${profit >= 0 ? 'bénéfice' : 'perte'} de ${Math.abs(profit)} d).`,
      witnesses: residents(state, cv.to).filter(c => c.locationId === dest.squareId).map(c => c.id), data: { revenue, profit },
    });
    // Retour : invendus + marchandise achetée ici pour le pays
    const path = roadPath(state, cv.to, cv.from)!;
    const back = loadCargo(state, market, cv.to, cv.from, path.hours);
    for (const it of ITEM_IDS) if (qty(cv.cargo, it)) { addItem(back.cargo, it, qty(cv.cargo, it)); delete cv.cargo[it]; }
    depart(state, m, cv.to, cv.from, path.hours, back.cargo, back.cost, true);
  }
  // Voyageurs isolés (déménagements) : arrivée à destination
  for (const id of state.characterOrder) {
    const c = state.characters[id];
    if (!c.alive || c.isPlayer || c.activity.kind !== 'travel' || !c.activity.until || c.activity.until > state.time) continue;
    if ((c.jailedUntil ?? 0) > state.time) continue;
    if (state.caravans.some(v => v.status === 'en_route' && v.merchantId === c.id)) continue;
    const to = c.activity.targetId ?? c.homeId;
    c.locationId = to;
    c.activity = { kind: 'idle', locationId: to, since: state.time, note: 'Arrive de voyage' };
  }
  if (state.caravans.length > 40) state.caravans = state.caravans.filter((v, i) => v.status === 'en_route' || i >= state.caravans.length - 20);
}

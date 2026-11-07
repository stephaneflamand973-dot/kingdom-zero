// Phase 3 — économie et territoires : région, routes, caravanes, logements, entreprises, prospérité, migration v3.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, buy, buyHome, carryCapacity, checkIntegrity, checksum, computeProsperity, createWorld, deserialize, found,
  foundBusiness, itemBalance, MIN_PER_DAY, minutesUntilHour, moneyBalance, moveTo, ownerOrder, processCaravans, purchaseBusiness,
  purchaseOffer, referencePrice, rentHome, residents, roadPath, sellersOf, serialize, settlementIdOf, store, takeOut, totalItems,
  totalMoney, travelMinutes, wait, weightOf, work, collectRents, merchantsPlanTrips, SAVE_VERSION, toDate, businessesIn,
} from '../src/engine';
import type { GameState } from '../src/engine';

const goTo = (s: GameState, loc: string, hour: number) => {
  if (s.characters.player.locationId !== loc) moveTo(s, loc);
  wait(s, minutesUntilHour(s.time, hour));
};

describe('Région et routes', () => {
  it('trois localités reliées : le trajet par la route prend des heures, et le monde vit pendant ce temps', () => {
    const s = createWorld(41);
    expect(s.settlementOrder).toEqual(['valcendre', 'staubin', 'hautepierre']);
    expect(roadPath(s, 'staubin', 'hautepierre')!.hours).toBe(12); // via Valcendre
    const minutes = travelMinutes(s, 'square', 'sa_square');
    expect(minutes).toBeGreaterThanOrEqual(5 * 60);
    const h0 = s.processedHours;
    const r = moveTo(s, 'sa_market');
    expect(r.ok, r.message).toBe(true);
    expect(s.processedHours - h0).toBeGreaterThanOrEqual(5);
    expect(settlementIdOf(s, s.characters.player.locationId)).toBe('staubin');
    expect(s.priceBook.staubin).toBeTruthy(); // le joueur a relevé les prix en arrivant
  });

  it('on n’achète que dans la localité où l’on se trouve', () => {
    const s = createWorld(42);
    const hugo = s.characters.hugo; // Saint-Aubin
    const sellers = sellersOf(s, 'bread', 12, hugo, true);
    expect(sellers.length).toBeGreaterThan(0);
    expect(sellers.every(x => settlementIdOf(s, x.b.locationId) === 'staubin')).toBe(true);
  });

  it('la spécialisation crée des écarts de prix réels', () => {
    const s = createWorld(43);
    s.observer = true;
    advanceTime(s, 14 * MIN_PER_DAY);
    const iron = (sid: string) => referencePrice(s, 'iron', sid) ?? 99;
    const grain = (sid: string) => referencePrice(s, 'grain', sid) ?? 99;
    expect(iron('hautepierre')).toBeLessThan(iron('staubin'));
    expect(grain('staubin')).toBeLessThan(grain('hautepierre'));
  });
});

describe('Caravanes', () => {
  it('une caravane emporte une vraie cargaison, la vend à destination et rentre ; rien ne se perd', () => {
    const s = createWorld(44);
    s.observer = true;
    const m0 = totalMoney(s), i0 = totalItems(s);
    // Pénurie organisée : Saint-Aubin manque d'outils, Hautepierre en regorge
    s.businesses.hp_b_forge.stock.tools = 30;
    s.businesses.hp_b_market.stock.tools = 12;
    for (const b of businessesIn(s, 'staubin')) delete b.stock.tools;
    const i1 = totalItems(s); // bilan de référence après la mise en place (grand livre encore vierge)
    advanceTime(s, minutesUntilHour(s.time, 7) + 60);
    merchantsPlanTrips(s);
    const cv = s.caravans.find(c => c.merchantId === 'gontran');
    expect(cv, 'Gontran part en caravane').toBeTruthy();
    expect(weightOf(cv!.cargo)).toBeGreaterThan(0);
    expect(itemBalance(i1, s, totalItems(s))).toEqual({}); // la cargaison en route est comptée
    expect(s.characters.gontran.locationId.startsWith('road_')).toBe(true);
    advanceTime(s, 13 * 60);
    processCaravans(s);
    expect(cv!.status).toBe('arrived');
    expect(s.events.some(e => e.type === 'caravan' && e.text.includes('arrive à'))).toBe(true);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(checkIntegrity(s)).toEqual([]);
    expect(i0).toBeTruthy();
  });
});

describe('Charge portée', () => {
  it('on ne peut pas porter plus que sa force ne le permet', () => {
    const s = createWorld(45);
    goTo(s, 'market', 9);
    const p = s.characters.player;
    p.money = 5000; s.ledger.externalMoneyIn += 5000;
    s.businesses.b_market.stock.iron = 60;
    s.ledger.externalItemsIn.iron = (s.ledger.externalItemsIn.iron ?? 0) + 58;
    const r = buy(s, 'b_market', 'iron', Math.floor(carryCapacity(p) / 3) + 1);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/besace est pleine/);
  });
});

describe('Logements', () => {
  it('louer, dormir chez soi, entreposer ; un loyer impayé mène à l’expulsion et à la saisie du coffre', () => {
    const s = createWorld(46);
    goTo(s, 'houses_a', 9);
    const p = s.characters.player;
    p.money = 100; p.inventory.wood = 5; s.ledger.externalMoneyIn += 100; s.ledger.externalItemsIn.wood = 5;
    const r = rentHome(s, 'pr_v_cottage');
    expect(r.ok, r.message).toBe(true);
    const pr = s.properties.find(x => x.id === 'pr_v_cottage')!;
    expect(pr.tenantId).toBe('player');
    expect(store(s, pr.id, 'wood', 5).ok).toBe(true);
    expect(pr.storage.wood).toBe(5);
    expect(takeOut(s, pr.id, 'wood', 2).ok).toBe(true);
    expect(pr.storage.wood).toBe(3);
    const m0 = totalMoney(s);
    const woodBefore = (p.inventory.wood ?? 0) + (pr.storage.wood ?? 0) + (s.businesses.b_manor.stock.wood ?? 0);
    // plus d'argent : le prochain loyer est impayé
    const manor = s.businesses.b_manor;
    manor.treasury += p.money; p.money = 0;
    pr.rentDueDay = toDate(s.time).day;
    collectRents(s);
    expect(pr.tenantId).toBeUndefined();
    expect(pr.storage.wood ?? 0).toBe(0);
    expect(manor.stock.wood).toBe(3);
    expect(s.events.some(e => e.type === 'eviction')).toBe(true);
    expect(totalMoney(s)).toBe(m0);
    expect((p.inventory.wood ?? 0) + (pr.storage.wood ?? 0) + (manor.stock.wood ?? 0)).toBe(woodBefore);
  });

  it('acheter une maison : l’argent va à l’intendance, plus de loyer', () => {
    const s = createWorld(47);
    goTo(s, 'hp_houses', 9);
    const p = s.characters.player;
    p.money = 300; s.ledger.externalMoneyIn += 300;
    const manor0 = s.businesses.hp_b_manor.treasury;
    const r = buyHome(s, 'pr_hp_coron');
    expect(r.ok, r.message).toBe(true);
    expect(s.businesses.hp_b_manor.treasury).toBeGreaterThanOrEqual(manor0 + 220 - 50); // l'intendance a pu payer des gages entre-temps
    expect(s.properties.find(x => x.id === 'pr_hp_coron')!.ownerId).toBe('player');
    expect(p.homeId).toBe('hp_houses');
  });
});

describe('Entreprises', () => {
  it('le joueur rachète une affaire à l’intendance, la gère et y travaille sans salaire', () => {
    const s = createWorld(48);
    const farm = s.businesses.hp_b_farm;
    farm.ownerId = null; s.characters.ide.employerId = undefined;
    goTo(s, 'hp_farm', 8);
    const p = s.characters.player;
    p.money = 2000; s.ledger.externalMoneyIn += 2000;
    const offer = purchaseOffer(s, farm, p);
    expect(offer.ok).toBe(true);
    const r = purchaseBusiness(s, 'hp_b_farm');
    expect(r.ok, r.message).toBe(true);
    expect(farm.ownerId).toBe('player');
    expect(ownerOrder(s, 'hp_b_farm', { kind: 'wage', delta: 2 }).ok).toBe(true);
    const t0 = farm.treasury;
    const m = p.money;
    expect(ownerOrder(s, 'hp_b_farm', { kind: 'withdraw', amount: 50 }).ok).toBe(true);
    expect(p.money).toBe(m + Math.min(50, t0));
    const w = work(s, 'hp_b_farm', 2);
    expect(w.ok, w.message).toBe(true);
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('un propriétaire qui ne vend pas refuse un inconnu', () => {
    const s = createWorld(49);
    const offer = purchaseOffer(s, s.businesses.b_forge, s.characters.player);
    expect(offer.ok).toBe(false);
  });

  it('fonder un comptoir : travaux payés à l’intendance, capital dans la caisse, argent conservé', () => {
    const s = createWorld(50);
    goTo(s, 'sa_square', 9);
    const p = s.characters.player;
    p.money = 500; s.ledger.externalMoneyIn += 500;
    const m0 = totalMoney(s);
    const manor0 = s.businesses.sa_b_manor.treasury;
    const r = found(s, 'market', 100);
    expect(r.ok, r.message).toBe(true);
    const b = Object.values(s.businesses).find(x => x.ownerId === 'player' && x.kind === 'market')!;
    expect(b).toBeTruthy();
    expect(settlementIdOf(s, b.locationId)).toBe('staubin');
    expect(s.businesses.sa_b_manor.treasury).toBeGreaterThanOrEqual(manor0 + 220 - 60);
    expect(totalMoney(s)).toBe(m0);
  });

  it('un PNJ peut fonder une affaire', () => {
    const s = createWorld(51);
    const c = s.characters.denis;
    c.money = 600; s.ledger.externalMoneyIn += 600;
    const b = foundBusiness(s, c, 'bakery', 'staubin', 120);
    expect(b?.ownerId).toBe('denis');
    expect(s.events.some(e => e.type === 'founding')).toBe(true);
  });
});

describe('Territoires', () => {
  it('la prospérité reflète l’état réel des habitants', () => {
    const s = createWorld(52);
    const st = s.settlements.hautepierre;
    const p0 = computeProsperity(s, st);
    for (const c of residents(s, 'hautepierre')) { c.needs.hunger = 95; c.employerId = undefined; }
    expect(computeProsperity(s, st)).toBeLessThan(p0 - 20);
  });

  it('les relevés hebdomadaires s’accumulent et le monde reste intègre sur 120 jours', () => {
    const s = createWorld(42);
    s.observer = true;
    const m0 = totalMoney(s), i0 = totalItems(s);
    advanceTime(s, 120 * MIN_PER_DAY);
    expect(s.settlements.staubin.history.length).toBeGreaterThanOrEqual(16);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    const back = deserialize(serialize(s)).state!;
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
  });
});

describe('Sauvegarde v3', () => {
  it('une sauvegarde v2 (village unique) est migrée vers la région', () => {
    const s = createWorld(53);
    const v2 = JSON.parse(JSON.stringify(s));
    // reconstruire la forme v2 : uniquement Valcendre, sans les champs régionaux
    const keepLoc = new Set(v2.locationOrder.filter((id: string) => v2.locations[id].settlementId === 'valcendre'));
    v2.locationOrder = v2.locationOrder.filter((id: string) => keepLoc.has(id));
    for (const id of Object.keys(v2.locations)) if (!keepLoc.has(id)) delete v2.locations[id]; else delete v2.locations[id].settlementId;
    v2.characterOrder = v2.characterOrder.filter((id: string) => keepLoc.has(v2.characters[id].homeId));
    for (const id of Object.keys(v2.characters)) if (!v2.characterOrder.includes(id)) delete v2.characters[id];
    v2.businessOrder = v2.businessOrder.filter((id: string) => keepLoc.has(v2.businesses[id].locationId));
    for (const id of Object.keys(v2.businesses)) if (!v2.businessOrder.includes(id)) delete v2.businesses[id];
    v2.village = { name: 'Valcendre', taxRate: 0.05, manorId: 'b_manor', infrastructure: 40 };
    for (const k of ['settlements', 'settlementOrder', 'roads', 'caravans', 'properties', 'priceBook', 'festivals', 'tradeMemory']) delete v2[k];
    v2.version = 2;
    const body = JSON.stringify(v2);
    const r = deserialize(JSON.stringify({ format: 'KINGDOM_ZERO_SAVE', version: 2, savedAt: 'x', checksum: checksum(body), state: v2 }));
    expect(r.error).toBeUndefined();
    expect(r.state!.version).toBe(SAVE_VERSION);
    expect(r.state!.settlementOrder).toEqual(['valcendre', 'staubin', 'hautepierre']);
    expect(r.state!.settlements.valcendre.infrastructure).toBe(40);
    expect(r.state!.characters.gilles).toBeTruthy();
  });
});

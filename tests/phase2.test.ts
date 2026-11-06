// Phase 2 — profondeur sociale : dettes, contrats, commandes, ambitions, vengeance, fêtes, migration.
import { describe, expect, it } from 'vitest';
import {
  acceptOrder, activeContract, advanceTime, applyForJob, askLoan, businessesForSale, checkIntegrity, checksum, createWorld,
  deliver, deserialize, getRelation, itemBalance, jobHopping, lendMoney, MIN_PER_DAY, minutesUntilHour, moneyBalance,
  moveTo, processAmbitions, processLoans, repayLoan, reputationTags, runProduction, serialize, startFestival, takeOrder,
  totalItems, totalMoney, trySlander, wait, work, weeklyContractReview, toDate, SAVE_VERSION,
} from '../src/engine';
import type { GameState } from '../src/engine';

const befriend = (s: GameState, npc: string, aff = 30, trust = 30) => {
  s.characters[npc].relations.player = { affinity: aff, trust, lastInteraction: 0 };
};
const goTo = (s: GameState, loc: string, hour: number) => {
  if (s.characters.player.locationId !== loc) moveTo(s, loc);
  wait(s, minutesUntilHour(s.time, hour));
};

describe('Dettes', () => {
  it('emprunter, rembourser par échéances, et gagner une réputation de bon payeur', () => {
    const s = createWorld(21);
    s.observer = false;
    const p = s.characters.player;
    goTo(s, 'market', 9);
    befriend(s, 'bertrand', 25, 25);
    s.characters.bertrand.money = 400;
    const m0 = totalMoney(s);
    const r = askLoan(s, 'bertrand', 40);
    expect(r.ok, r.message).toBe(true);
    expect(p.money).toBe(40);
    const loan = s.loans.find(l => l.borrowerId === 'player')!;
    expect(loan.totalDue).toBeGreaterThan(40);
    expect(totalMoney(s)).toBe(m0); // l'argent a changé de poche, rien n'a été créé
    // le joueur gagne de quoi payer, puis l'échéance hebdomadaire est prélevée
    const before = p.money;
    loan.nextDueDay = toDate(s.time).day; // échéance aujourd'hui
    processLoans(s);
    expect(p.money).toBe(before - loan.installment);
    p.money += 30; // gages d'une journée de travail (injectés par le test)
    const rr = repayLoan(s, loan.id);
    expect(rr.ok, rr.message).toBe(true);
    expect(loan.status).toBe('repaid');
    expect(totalMoney(s)).toBe(m0 + 30);
    expect(reputationTags(s, 'player').some(t => t.tag === 'Bon payeur')).toBe(true);
  });

  it('un inconnu ne prête pas une grosse somme, et un mauvais payeur connu est refusé', () => {
    const s = createWorld(22);
    goTo(s, 'market', 9);
    s.characters.bertrand.money = 400;
    const r = askLoan(s, 'bertrand', 100);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/connaît pas assez/);
    expect(s.loans.filter(l => l.borrowerId === 'player')).toHaveLength(0);
  });

  it('un défaut entraîne la saisie des biens puis de l’entreprise du débiteur', () => {
    const s = createWorld(23);
    s.observer = true;
    const mine = s.businesses.b_mine;
    const thibault = s.characters.thibault;
    const loan = s.loans.find(l => l.borrowerId === 'gautier')!;
    // On rattache la vieille dette au mineur ruiné pour le scénario
    loan.borrowerId = 'thibault';
    thibault.money = 0;
    mine.treasury = 0;
    loan.missed = 1;
    loan.nextDueDay = toDate(s.time).day;
    const m0 = totalMoney(s), i0 = totalItems(s);
    processLoans(s);
    expect(loan.status).toBe('defaulted');
    expect(mine.ownerId).toBe('bertrand');
    const seizure = s.events.find(e => e.type === 'seizure');
    expect(seizure?.causeIds?.length).toBe(1);
    expect(getRelation(s, 'thibault', 'bertrand').affinity).toBeLessThan(-30);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
  });

  it('le joueur peut prêter à un PNJ dans le besoin, qui rembourse ensuite', () => {
    const s = createWorld(24);
    goTo(s, 'houses_a', 7);
    const isabeau = s.characters.isabeau;
    if (isabeau.locationId !== 'houses_a') isabeau.locationId = 'houses_a';
    isabeau.activity = { kind: 'idle', locationId: 'houses_a', since: s.time };
    isabeau.money = 5;
    s.characters.player.money = 60;
    const r = lendMoney(s, 'isabeau', 20);
    expect(r.ok, r.message).toBe(true);
    const loan = s.loans.find(l => l.lenderId === 'player')!;
    expect(loan.remaining).toBe(24);
    isabeau.money = 100;
    loan.nextDueDay = toDate(s.time).day;
    const pm = s.characters.player.money;
    processLoans(s);
    expect(s.characters.player.money).toBe(pm + loan.installment);
  });
});

describe('Contrats de travail', () => {
  it('une place garantit le salaire convenu, et les heures manquées mènent au renvoi', () => {
    const s = createWorld(25);
    goTo(s, 'farm', 8);
    const r0 = applyForJob(s, 'b_farm');
    expect(r0.ok).toBe(false); // Gautier ne connaît pas encore le joueur
    befriend(s, 'gautier', 15, 15);
    const r = applyForJob(s, 'b_farm');
    expect(r.ok, r.message).toBe(true);
    const k = activeContract(s, 'player')!;
    expect(s.businesses.b_farm.employees).toContain('player');
    const p = s.characters.player;
    const m = p.money;
    const w = work(s, 'b_farm', 3);
    expect(w.ok, w.message).toBe(true);
    expect(p.money - m).toBe(3 * k.wage);
    expect(k.hoursThisWeek).toBe(3);
    // Deux semaines sans assez d'heures : avertissement puis renvoi
    k.startDay -= 14;
    weeklyContractReview(s);
    expect(k.strikes).toBe(1);
    expect(s.events.some(e => e.type === 'contract_warning')).toBe(true);
    weeklyContractReview(s);
    expect(k.status).toBe('ended');
    expect(s.businesses.b_farm.employees).not.toContain('player');
    expect(p.employerId).toBeUndefined();
    expect(checkIntegrity(s)).toEqual([]);
  });
});

describe('Commandes', () => {
  it('une pénurie affiche une commande ; la livrer paie le joueur et remplit le stock', () => {
    const s = createWorld(26);
    const bakery = s.businesses.b_bakery;
    bakery.stock = { grain: 10 };
    bakery.laborPool = 4;
    runProduction(s, bakery); // manque de bois → pénurie
    advanceTime(s, 60);       // la commande est affichée au tick suivant
    const order = s.orders.find(o => o.businessId === 'b_bakery' && o.item === 'wood');
    expect(order, 'commande affichée').toBeTruthy();
    goTo(s, 'square', 8);
    if (order!.status !== 'open') return; // le marchand peut l'avoir honorée entre-temps : comportement valide
    expect(takeOrder(s, order!.id).ok).toBe(true);
    const p = s.characters.player;
    p.inventory.wood = order!.qty; // bois ramassé au préalable
    s.ledger.externalItemsIn.wood = (s.ledger.externalItemsIn.wood ?? 0) + order!.qty;
    moveTo(s, 'bakery');
    const money = p.money, till = bakery.treasury, stock = bakery.stock.wood ?? 0;
    const r = deliver(s, order!.id);
    expect(r.ok, r.message).toBe(true);
    expect(order!.status).toBe('done');
    expect(p.money - money + (till - bakery.treasury)).toBeGreaterThanOrEqual(0);
    expect((bakery.stock.wood ?? 0)).toBeGreaterThanOrEqual(stock);
  });

  it('une commande acceptée et non livrée échoue et coûte la confiance du client', () => {
    const s = createWorld(27);
    s.orders.push({ id: 'oX', businessId: 'b_forge', item: 'iron', qty: 4, delivered: 0, unitPrice: 19, postedDay: 0, deadlineDay: 3, status: 'open' });
    goTo(s, 'square', 8);
    expect(acceptOrder(s, 'oX').ok).toBe(true);
    const t0 = getRelation(s, 'aldric', 'player').trust;
    s.observer = true;
    advanceTime(s, 5 * MIN_PER_DAY);
    expect(s.orders.find(o => o.id === 'oX')!.status).toBe('failed');
    expect(getRelation(s, 'aldric', 'player').trust).toBeLessThan(t0);
  });
});

describe('Ambitions et mobilité', () => {
  it('un PNJ ambitieux rachète une entreprise à vendre ; le vendeur est payé', () => {
    const s = createWorld(28);
    const m0 = totalMoney(s);
    const farm = s.businesses.b_farm;
    farm.ownerId = null; // affaire sous tutelle de l'intendance
    s.characters.gautier.employerId = undefined;
    const isabeau = s.characters.isabeau;
    isabeau.money = 2000;
    isabeau.ambition = { kind: 'ouvrir_commerce', target: 400, since: 0 };
    const offer = businessesForSale(s, isabeau).find(o => o.b.id === 'b_farm')!;
    const manor0 = s.businesses.b_manor.treasury;
    processAmbitions(s);
    expect(farm.ownerId).toBe('isabeau');
    expect(s.businesses.b_manor.treasury).toBe(manor0 + offer.price);
    expect(isabeau.ambition.kind).toBe('faire_fortune');
    expect(s.events.some(e => e.type === 'sale')).toBe(true);
    expect(totalMoney(s)).toBe(m0 + 2000 - 18); // seul l'argent injecté par le test change la masse
  });

  it('un ouvrier part pour un meilleur salaire', () => {
    const s = createWorld(29);
    const martin = s.characters.martin;
    martin.jobSince = -99;
    martin.traits = martin.traits.filter(t => t !== 'loyal');
    const forge = s.businesses.b_forge;
    forge.wage = 9; forge.treasury = 2000; forge.stock = { tools: 0 }; forge.lastStaffChangeDay = -99; forge.employees = [];
    s.characters.guillaume.employerId = undefined;
    s.businesses.b_farm.wage = 3;
    s.characters.agnes.traits.push('loyal');
    for (let i = 0; i < 15 && martin.employerId === 'b_farm'; i++) jobHopping(s);
    expect(martin.employerId).toBe('b_forge');
    expect(s.events.some(e => e.type === 'quit' && e.actorId === 'martin')).toBe(true);
  });
});

describe('Vengeance, rumeurs et fêtes', () => {
  it('un rancunier calomnie sa cible : l’auditeur perd confiance en elle', () => {
    const s = createWorld(30);
    const raoul = s.characters.raoul, clement = s.characters.clement;
    raoul.ambition = { kind: 'vengeance', targetId: 'player', since: 0, count: 0 };
    const t0 = getRelation(s, 'clement', 'player').trust;
    let ev;
    for (let i = 0; i < 30 && !ev; i++) { raoul.ambition.lastDay = -1; ev = trySlander(s, raoul, clement); }
    expect(ev?.type).toBe('slander');
    expect(getRelation(s, 'clement', 'player').trust).toBeLessThan(t0);
    expect(clement.knownEvents).toContain(ev!.id);
  });

  it('la fête de saison est payée par l’intendance à l’auberge et rassemble le village', () => {
    const s = createWorld(31);
    s.observer = true;
    const m0 = totalMoney(s);
    advanceTime(s, minutesUntilHour(s.time, 16));
    const manor0 = s.businesses.b_manor.treasury, tavern0 = s.businesses.b_tavern.treasury;
    advanceTime(s, 60); // 17h, premier jour de la saison
    expect(s.festival).toBeTruthy();
    expect(s.businesses.b_manor.treasury).toBeLessThan(manor0);
    expect(s.businesses.b_tavern.treasury).toBeGreaterThan(tavern0);
    advanceTime(s, 2 * 60);
    const atTavern = s.characterOrder.filter(id => s.characters[id].alive && s.characters[id].locationId === 'tavern').length;
    expect(atTavern).toBeGreaterThanOrEqual(10);
    expect(totalMoney(s)).toBe(m0);
    expect(() => startFestival(s)).not.toThrow();
  });
});

describe('Sauvegarde v2', () => {
  it('une sauvegarde de la phase 1 (v1) est migrée et se recharge', () => {
    const s = createWorld(32);
    const v1 = JSON.parse(JSON.stringify(s));
    delete v1.loans; delete v1.contracts; delete v1.orders;
    for (const id of v1.characterOrder) delete v1.characters[id].ambition;
    v1.version = 1;
    const body = JSON.stringify(v1);
    const file = JSON.stringify({ format: 'KINGDOM_ZERO_SAVE', version: 1, savedAt: 'x', checksum: checksum(body), state: v1 });
    const r = deserialize(file);
    expect(r.error).toBeUndefined();
    expect(r.state!.version).toBe(SAVE_VERSION);
    expect(r.state!.loans).toEqual([]);
    expect(r.state!.characters.bertrand.ambition.kind).toBeTruthy();
  });

  it('120 jours de phase 2 : intégrité, argent et objets conservés, sauvegarde fidèle', () => {
    const s = createWorld(42);
    s.observer = true;
    const m0 = totalMoney(s), i0 = totalItems(s);
    advanceTime(s, 120 * MIN_PER_DAY);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    expect(s.loans.length).toBeGreaterThan(1);
    const back = deserialize(serialize(s)).state!;
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
  });
});

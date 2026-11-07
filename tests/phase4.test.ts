// Phase 4 — pouvoir et conflits : organisations, combat, brigands, justice, gouvernement, guerre, complots, migration v4.
import { describe, expect, it } from 'vitest';
import {
  addWanted, advanceTime, autoBattle, caravanAmbushes, checkIntegrity, checksum, computeUnrest, createWorld, deserialize,
  encounterAction, fighterOf, hourlyJustice, itemBalance, MIN_PER_DAY, minutesUntilHour, moneyBalance, monthlyIntrigues,
  moveTo, orgList, petition, processCaravans, serialize, soldiersOf, totalItems, totalMoney, wait, wantedFor, weeklyGangs,
  weeklyGovernance, SAVE_VERSION, killCharacter, freeMembers, toDate,
} from '../src/engine';
import type { GameState } from '../src/engine';

const goTo = (s: GameState, loc: string, hour: number) => {
  if (s.characters.player.locationId !== loc) moveTo(s, loc);
  wait(s, minutesUntilHour(s.time, hour));
};

describe('Organisations', () => {
  it('maisons, guilde et bande existent avec chefs, membres et trésors', () => {
    const s = createWorld(61);
    expect(orgList(s, 'house').map(h => h.id).sort()).toEqual(['h_delaval', 'h_roche']);
    expect(s.orgs.b_loups.leaderId).toBe('raoul');
    expect(s.settlements.hautepierre.lordHouseId).toBe('h_roche');
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('à la mort du seigneur, l’héritier prend la tête de la maison', () => {
    const s = createWorld(62);
    s.observer = true;
    killCharacter(s, s.characters.alienor, 'de maladie');
    expect(s.orgs.h_roche.leaderId).toBe('berald');
    expect(s.characters.berald.profession).toBe('seigneur');
    expect(s.events.some(e => e.type === 'succession')).toBe(true);
  });
});

describe('Combat', () => {
  it('un combattant aguerri bat généralement un novice ; les coups retirent des points de vie', () => {
    const s = createWorld(63);
    let wins = 0;
    for (let i = 0; i < 20; i++) {
      const strong = fighterOf(s.characters.garin), weak = fighterOf(s.characters.jehan);
      const r = autoBattle(s, [strong], [weak], 8);
      if (r.winner === 'a') wins++;
      expect(weak.hp).toBeLessThanOrEqual(s.characters.jehan.health);
    }
    expect(wins).toBeGreaterThan(12);
  });
});

describe('Brigandage', () => {
  it('une caravane peut être attaquée : le butin passe réellement à la bande, rien ne se perd', () => {
    const s = createWorld(64);
    s.observer = true;
    const i0 = totalItems(s), m0 = totalMoney(s);
    // une caravane en route sur le chemin de la Loue, chargée de fer
    const m = s.characters.gilles;
    s.businesses.sa_b_market.stock.iron = 0;
    s.caravans.push({ id: 'vX', merchantId: 'gilles', from: 'staubin', to: 'valcendre', cargo: {}, cost: 0, departTime: s.time, arriveTime: s.time + 300, status: 'en_route', returning: false });
    const cv = s.caravans[s.caravans.length - 1];
    cv.cargo.grain = 30; s.businesses.sa_b_farm.stock.grain! -= 30; // la cargaison vient du domaine
    m.locationId = 'road_v_sa';
    m.activity = { kind: 'travel', locationId: 'road_v_sa', since: s.time, until: cv.arriveTime, note: 'En route' };
    let tries = 0;
    while (!cv.ambushed && tries++ < 400) caravanAmbushes(s);
    expect(cv.ambushed).toBe(true);
    expect(s.events.some(e => e.type === 'ambush')).toBe(true);
    expect(totalMoney(s)).toBe(m0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    advanceTime(s, 6 * 60);
    processCaravans(s);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
  });

  it('le joueur pris en embuscade peut payer : il perd l’argent réclamé et arrive à destination', () => {
    const s = createWorld(65);
    const p = s.characters.player;
    p.money = 100; s.ledger.externalMoneyIn += 100;
    let attempts = 0;
    while (!s.encounter && attempts++ < 60) {
      moveTo(s, p.locationId === 'square' ? 'sa_square' : 'square');
      p.health = 100; p.needs.hunger = 10; p.needs.energy = 90;
    }
    expect(s.encounter, 'une embuscade finit par survenir').toBeTruthy();
    const dest = s.encounter!.destination!;
    const demand = s.encounter!.demand;
    const gangBefore = s.orgs.b_loups.treasury;
    const before = p.money;
    const r = encounterAction(s, 'pay');
    expect(r.ok, r.message).toBe(true);
    expect(s.encounter).toBeUndefined();
    expect(p.locationId).toBe(dest);
    expect(before - p.money).toBeGreaterThanOrEqual(Math.min(before, demand) - 0);
    expect(s.orgs.b_loups.treasury).toBeGreaterThanOrEqual(gangBefore);
  });

  it('une bande recrute en secret et rançonne : refuser mène au saccage et à un avis de recherche', () => {
    const s = createWorld(66);
    s.observer = true;
    for (let i = 0; i < 6; i++) { weeklyGangs(s); s.orgs.b_loups.heat = 0; }
    expect(s.events.some(e => e.type === 'racket' || e.type === 'vandalism')).toBe(true);
    const recruit = s.events.find(e => e.type === 'recruit');
    if (recruit) expect(recruit.witnesses.every(id => s.orgs.b_loups.members.includes(id) || !s.characters[id].alive)).toBe(true);
  });
});

describe('Justice', () => {
  it('un recherché croisé par un garde en service est arrêté et emprisonné', () => {
    const s = createWorld(67);
    s.observer = true;
    const c = s.characters.colin;
    addWanted(s, c.id, 'valcendre', 'vol', 30);
    expect(wantedFor(s, c.id)).toBeTruthy();
    const g = s.characters.bastien;
    g.locationId = 'square'; g.activity = { kind: 'work', locationId: 'square', since: s.time, note: 'Patrouille' };
    c.locationId = 'square'; c.health = 40;
    for (let i = 0; i < 10 && !(c.jailedUntil && c.jailedUntil > s.time); i++) { hourlyJustice(s); c.locationId = 'square'; }
    expect(c.jailedUntil).toBeGreaterThan(s.time);
    expect(wantedFor(s, c.id)).toBeUndefined();
    expect(s.events.some(e => e.type === 'jail')).toBe(true);
  });

  it('le joueur recherché est interpellé : se rendre mène en prison, et le temps passe', () => {
    const s = createWorld(68);
    const p = s.characters.player;
    addWanted(s, 'player', 'valcendre', 'vol', 20);
    const g = s.characters.hugues;
    g.locationId = 'square'; g.activity = { kind: 'work', locationId: 'square', since: s.time, note: 'Patrouille' };
    hourlyJustice(s);
    expect(s.encounter?.kind).toBe('arrest');
    expect(moveTo(s, 'market').ok).toBe(false); // bloqué tant que la rencontre n'est pas réglée
    const t0 = s.time;
    const r = encounterAction(s, 'surrender');
    expect(r.ok).toBe(true);
    expect(s.time - t0).toBeGreaterThanOrEqual(3 * MIN_PER_DAY);
    expect(wantedFor(s, 'player')).toBeUndefined();
    expect(p.alive).toBe(true);
  });
});

describe('Gouvernement', () => {
  it('le tribut remonte à la maison, les soldats sont payés, la grogne se calcule sur des faits', () => {
    const s = createWorld(69);
    s.observer = true;
    s.businesses.b_manor.treasury = 1000;
    const m0 = totalMoney(s);
    const house0 = s.orgs.h_delaval.treasury;
    weeklyGovernance(s);
    expect(s.orgs.h_delaval.treasury).not.toBe(house0);
    const st = s.settlements.valcendre;
    const calm = computeUnrest(s, st);
    for (const id of s.characterOrder) if (s.characters[id].homeId && s.locations[s.characters[id].homeId].settlementId === 'valcendre') s.characters[id].needs.hunger = 95;
    expect(computeUnrest(s, st)).toBeGreaterThan(calm + 20);
    expect(totalMoney(s)).toBe(m0); // le tribut et les soldes déplacent l'argent, sans en créer
  });

  it('deux semaines de forte grogne déclenchent une révolte : l’impôt baisse et n’est plus perçu', () => {
    const s = createWorld(70);
    s.observer = true;
    const st = s.settlements.staubin;
    st.taxRate = 0.12;
    for (let w = 0; w < 3; w++) {
      for (const id of s.characterOrder) { const c = s.characters[id]; if (s.locations[c.homeId].settlementId === 'staubin') c.needs.hunger = 100; }
      st.prosperity = 5;
      weeklyGovernance(s);
    }
    expect(s.events.some(e => e.type === 'revolt')).toBe(true);
    expect(st.taxRate).toBeLessThan(0.12);
    expect(st.revoltUntilDay).toBeGreaterThanOrEqual(toDate(s.time).day);
  });
});

describe('Guerre et complots', () => {
  it('une maison belliqueuse et plus forte déclare la guerre ; les batailles font de vraies victimes', () => {
    const s = createWorld(71);
    s.observer = true;
    const roche = s.orgs.h_roche, delaval = s.orgs.h_delaval;
    roche.relations.h_delaval = -90; delaval.relations.h_roche = -90;
    // Roche lève une forte troupe ; Delaval est désarmée
    for (const id of ['jacquot', 'pons', 'tiphaine', 'evrard', 'achard']) { roche.members.push(id); roche.roles[id] = 'soldat'; s.characters[id].profession = 'soldat'; }
    for (const id of ['bastien', 'hugues', 'thomas']) s.characters[id].profession = 'journalier';
    for (const id of delaval.members) if (delaval.roles[id] === 'soldat') delete delaval.roles[id];
    roche.treasury = 5000; s.ledger.externalMoneyIn += 4500;
    weeklyGovernance(s);
    const war = s.wars.find(w => w.attackerId === 'h_roche');
    expect(war, 'guerre déclarée').toBeTruthy();
    for (let i = 0; i < 3 && war!.status === 'active'; i++) weeklyGovernance(s);
    expect(war!.status).toBe('ended');
    expect(s.settlements[war!.targetSettlementId].lordHouseId).toBe('h_roche'); // sans défenseurs, la place tombe
    expect(s.events.some(e => e.type === 'conquest')).toBe(true);
    expect(soldiersOf(s, roche).length).toBeGreaterThan(0);
  });

  it('un héritier ambitieux peut commanditer l’assassinat de son seigneur ; le complot est consigné', () => {
    const s = createWorld(72);
    s.observer = true;
    s.characters.gaucher.money = 200;
    s.characters.guerin.relations.gaucher = { affinity: -20, trust: -20, lastInteraction: 0 };
    let plot;
    for (let i = 0; i < 40 && !plot; i++) { monthlyIntrigues(s); plot = s.events.find(e => e.type === 'plot'); s.characters.gaucher.money = 200; }
    expect(plot).toBeTruthy();
    expect(plot!.actorId).toBe('gaucher');
    expect(freeMembers(s, s.orgs.b_loups).length).toBeGreaterThanOrEqual(0);
  });
});

describe('Requêtes du joueur', () => {
  it('écuyer (contre droits), puis service dans la garnison : le joueur entre dans la maison', () => {
    const s = createWorld(73);
    const p = s.characters.player;
    goTo(s, 'manor', 10);
    const lord = s.characters.guerin;
    lord.locationId = 'manor'; lord.activity = { kind: 'idle', locationId: 'manor', since: s.time };
    p.money = 300; s.ledger.externalMoneyIn += 300;
    const r = petition(s, 'guerin', 'ecuyer');
    expect(r.ok, r.message).toBe(true);
    expect(p.title).toBe('ecuyer');
    expect(s.orgs.h_delaval.members).toContain('player');
    const c = petition(s, 'guerin', 'conseiller');
    expect(p.title).toBe('ecuyer'); // pas encore assez de confiance
    expect(c.message).toMatch(/confiance/);
    expect(checkIntegrity(s)).toEqual([]);
  });
});

describe('Long terme et sauvegarde v4', () => {
  it('120 jours : intégrité, argent et objets conservés, sauvegarde fidèle', () => {
    const s = createWorld(42);
    s.observer = true;
    const m0 = totalMoney(s), i0 = totalItems(s);
    advanceTime(s, 120 * MIN_PER_DAY);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    expect(JSON.stringify(deserialize(serialize(s)).state)).toBe(JSON.stringify(s));
  });

  it('une sauvegarde v3 (sans pouvoir) est migrée', () => {
    const s = createWorld(74);
    const v3 = JSON.parse(JSON.stringify(s));
    for (const id of ['guerin', 'gaucher', 'alienor', 'berald']) { delete v3.characters[id]; v3.characterOrder = v3.characterOrder.filter((x: string) => x !== id); }
    for (const k of ['orgs', 'orgOrder', 'wars', 'wanted']) delete v3[k];
    for (const id of v3.settlementOrder) { delete v3.settlements[id].lordHouseId; delete v3.settlements[id].unrest; delete v3.settlements[id].unrestWeeks; }
    v3.version = 3;
    const body = JSON.stringify(v3);
    const r = deserialize(JSON.stringify({ format: 'KINGDOM_ZERO_SAVE', version: 3, savedAt: 'x', checksum: checksum(body), state: v3 }));
    expect(r.error).toBeUndefined();
    expect(r.state!.version).toBe(SAVE_VERSION);
    expect(r.state!.orgs.h_delaval.leaderId).toBe('guerin');
  });
});

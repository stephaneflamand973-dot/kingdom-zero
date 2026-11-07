// Phase 5 — familles et générations : anniversaires, mariage, naissances, enfance, succession, lignée du joueur, migration v5.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, birthdays, checkIntegrity, checksum, continueAs, court, createChild, createWorld, dailyFamily, deserialize,
  DAYS_PER_YEAR, feedChildren, heirsOf, itemBalance, killCharacter, liveDays, MIN_PER_DAY, minutesUntilHour, moneyBalance,
  moveTo, proposeMarriage, serialize, settleEstate, toDate, totalItems, totalMoney, wait, wed, weeklyCourtship, SAVE_VERSION,
  ensureHeirs,
} from '../src/engine';

describe('Âge et anniversaires', () => {
  it('chacun vieillit à son propre anniversaire, une fois par an', () => {
    const s = createWorld(81);
    const c = s.characters.martin;
    const age0 = c.age;
    const day = toDate(s.time).day;
    c.birthDay = day - 3 * DAYS_PER_YEAR; // anniversaire aujourd'hui
    birthdays(s);
    expect(c.age).toBe(age0 + 1);
    birthdays(s);
    expect(c.age).toBe(age0 + 1); // pas deux fois le même jour
  });
});

describe('Mariage', () => {
  it('deux adultes qui s’apprécient se font la cour puis se marient et partagent un foyer', () => {
    const s = createWorld(82);
    s.observer = true;
    const a = s.characters.isabeau, b = s.characters.martin;
    a.relations.martin = { affinity: 70, trust: 60, lastInteraction: 0 };
    b.relations.isabeau = { affinity: 70, trust: 60, lastInteraction: 0 };
    for (let w = 0; w < 12 && !a.spouseId; w++) weeklyCourtship(s);
    expect(a.spouseId).toBe('martin');
    expect(b.spouseId).toBe('isabeau');
    expect(a.homeId).toBe(b.homeId);
    expect(s.events.some(e => e.type === 'wedding')).toBe(true);
  });

  it('le joueur fait sa cour, se voit refuser trop tôt, puis épouse', () => {
    const s = createWorld(83);
    s.characters.player.locationId = 'sa_houses'; // sur place, sans risquer la route
    wait(s, minutesUntilHour(s.time, 18));
    const n = s.characters.oda;
    n.locationId = 'sa_houses'; n.activity = { kind: 'idle', locationId: 'sa_houses', since: s.time };
    n.relations.player = { affinity: 30, trust: 35, lastInteraction: 0 };
    expect(proposeMarriage(s, 'oda').message).toMatch(/décline/);
    for (let i = 0; i < 25 && (n.relations.player.romance ?? 0) < 70; i++) {
      n.locationId = s.characters.player.locationId; n.activity = { kind: 'idle', locationId: n.locationId, since: s.time };
      court(s, 'oda');
      n.relations.player.affinity = Math.max(n.relations.player.affinity, 55);
    }
    n.locationId = s.characters.player.locationId;
    const r = proposeMarriage(s, 'oda');
    expect(r.ok, r.message).toBe(true);
    expect(s.characters.player.spouseId).toBe('oda');
    expect(checkIntegrity(s)).toEqual([]);
  });
});

describe('Naissances et enfance', () => {
  it('un couple a un enfant : grossesse, naissance, filiation, traits hérités', () => {
    const s = createWorld(84);
    s.observer = true;
    const mother = s.characters.tiphaine, father = s.characters.jacquot;
    mother.pregnantUntil = toDate(s.time).day; mother.pregnancyFather = father.id;
    const before = s.characterOrder.length;
    dailyFamily(s);
    expect(s.characterOrder.length).toBe(before + 1);
    const child = s.characters[s.characterOrder[s.characterOrder.length - 1]];
    expect(child.parentIds).toEqual([mother.id, father.id]);
    expect(mother.childIds).toContain(child.id);
    expect(child.lastName).toBe(father.lastName);
    expect(child.age).toBe(0);
    expect(child.traits.some(t => mother.traits.includes(t) || father.traits.includes(t))).toBe(true);
    expect(s.events.some(e => e.type === 'birth')).toBe(true);
  });

  it('les parents nourrissent leur enfant (pain du foyer ou acheté), sans rien créer', () => {
    const s = createWorld(85);
    s.observer = true;
    const mother = s.characters.tiphaine;
    const child = createChild(s, mother, s.characters.jacquot);
    child.needs.hunger = 80;
    mother.inventory = {}; s.characters.jacquot.inventory = {};
    mother.money = 50;
    const i0 = totalItems(s), m0 = totalMoney(s);
    feedChildren(s);
    expect(child.needs.hunger).toBeLessThan(80);
    expect(totalMoney(s)).toBe(m0);
    // le pain acheté puis mangé est passé par une vraie transaction
    const d = itemBalance(i0, s, totalItems(s));
    expect(d).toEqual({});
  });
});

describe('Succession', () => {
  it('dettes payées d’abord, puis partage entre héritiers ; maisons et entreprises transmises', () => {
    const s = createWorld(86);
    s.observer = true;
    const gautier = s.characters.gautier;
    gautier.money = 200;
    const loan = s.loans.find(l => l.borrowerId === 'gautier')!;
    const lender0 = s.characters.bertrand.money;
    const m0 = totalMoney(s);
    killCharacter(s, gautier, 'de vieillesse');
    expect(loan.status === 'repaid' || loan.status === 'defaulted').toBe(true);
    expect(s.characters.bertrand.money).toBeGreaterThan(lender0);
    expect(s.businesses.b_farm.ownerId).toBe('martin');
    expect(s.events.some(e => e.type === 'estate')).toBe(true);
    expect(totalMoney(s)).toBe(m0);
    expect(heirsOf(s, gautier).map(c => c.id)).toContain('martin');
  });

  it('un orphelin mineur est confié à un tuteur', () => {
    const s = createWorld(87);
    s.observer = true;
    const mother = s.characters.tiphaine, father = s.characters.jacquot;
    const child = createChild(s, mother, father);
    killCharacter(s, father, 'de maladie');
    killCharacter(s, mother, 'de maladie');
    expect(child.guardianId).toBeTruthy();
    expect(s.events.some(e => e.type === 'adoption')).toBe(true);
    expect(settleEstate).toBeTruthy();
  });

  it('chez les nobles, l’aîné des enfants du seigneur devient héritier', () => {
    const s = createWorld(88);
    s.observer = true;
    const roche = s.orgs.h_roche;
    roche.roles.berald = 'membre';
    ensureHeirs(s);
    expect(roche.roles.berald).toBe('heritier');
  });
});

describe('Lignée du joueur', () => {
  it('à la mort du joueur, un enfant adulte reprend le flambeau ; le monde continue', () => {
    const s = createWorld(89);
    const p = s.characters.player;
    const spouse = s.characters.oda;
    wed(s, p, spouse);
    const kid = createChild(s, spouse, p);
    kid.age = 16;
    p.money = 120;
    const t = s.time;
    killCharacter(s, p, 'de maladie');
    expect(s.gameOver).toBeUndefined();
    expect(s.pendingSuccession?.candidates).toContain(kid.id);
    expect(moveTo(s, 'market').ok).toBe(false); // le monde attend le choix
    const r = continueAs(s, kid.id);
    expect(r.ok).toBe(true);
    expect(s.playerId).toBe(kid.id);
    expect(s.characters[kid.id].isPlayer).toBe(true);
    expect(s.dynasty.generation).toBe(2);
    expect(s.characters[kid.id].money).toBeGreaterThan(0); // héritage
    expect(s.time).toBe(t);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moveTo(s, 'market').ok).toBe(true);
  });

  it('sans aucun proche, la partie se termine', () => {
    const s = createWorld(90);
    for (const id of s.characterOrder) if (id !== 'player') delete s.characters[id].relations.player;
    killCharacter(s, s.characters.player, 'de faim');
    expect(s.gameOver).toBeTruthy();
  });

  it('vivre au jour le jour : l’IA mène le joueur, qui mange, dort et travaille', () => {
    const s = createWorld(91);
    const p = s.characters.player;
    p.money = 60; s.ledger.externalMoneyIn += 60;
    const r = liveDays(s, 7);
    expect(r.ok).toBe(true);
    if (!s.encounter && !s.pendingSuccession) expect(r.minutes).toBe(7 * MIN_PER_DAY);
    expect(p.alive).toBe(true);
    expect(s.autopilotUntil).toBeUndefined();
  });
});

describe('Long terme et sauvegarde v5', () => {
  it('300 jours : naissances ou mariages possibles, intégrité, argent et objets conservés', () => {
    const s = createWorld(42);
    s.observer = true;
    const m0 = totalMoney(s), i0 = totalItems(s);
    advanceTime(s, 300 * MIN_PER_DAY);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    expect(JSON.stringify(deserialize(serialize(s)).state)).toBe(JSON.stringify(s));
  });

  it('une sauvegarde v4 (sans familles) est migrée', () => {
    const s = createWorld(92);
    const v4 = JSON.parse(JSON.stringify(s));
    for (const id of v4.characterOrder) { const c = v4.characters[id]; delete c.birthDay; delete c.parentIds; delete c.childIds; delete c.spouseId; }
    delete v4.dynasty;
    v4.version = 4;
    const body = JSON.stringify(v4);
    const r = deserialize(JSON.stringify({ format: 'KINGDOM_ZERO_SAVE', version: 4, savedAt: 'x', checksum: checksum(body), state: v4 }));
    expect(r.error).toBeUndefined();
    expect(r.state!.version).toBe(SAVE_VERSION);
    expect(r.state!.characters.martin.parentIds).toContain('gautier');
    expect(r.state!.dynasty.generation).toBe(1);
  });
});

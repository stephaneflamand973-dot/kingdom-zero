// Phase 11 — rejoindre la bande, lever des hommes d'armes, se battre pour une maison.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, alliesAtHand, allBusinesses, checkIntegrity, createWorld, dailyRetinue, dismissManAtArms, escortFactor, followsCaptain,
  gangContact, gangOf, gangRaid, hireManAtArms, itemBalance, joinGang, leaveGang, MIN_PER_DAY, moneyBalance, musteredFor, muster, P,
  playerGangShare, recruitsHere, retinue, retinueCap, RETINUE_BOUNTY, RETINUE_PAY, rollTravelAmbush, totalItems, totalMoney,
  transferMoney, wantedFor, afterBattle, type GameState,
} from '../src/engine';

function fund(s: GameState, amount: number) {
  const p = s.characters.player;
  for (const b of allBusinesses(s).slice().sort((a, b) => b.treasury - a.treasury)) {
    const take = Math.min(Math.max(0, b.treasury - 60), amount - p.money);
    if (take > 0) transferMoney(s, P.b(b.id), P.c(p.id), take);
  }
  return p;
}
/** Un membre de la bande devenu ami du joueur, au même endroit que lui. */
function friendInGang(s: GameState) {
  const p = s.characters.player;
  const raoul = s.characters.raoul;
  raoul.relations[p.id] = { affinity: 40, trust: 30, lastInteraction: 0 };
  raoul.locationId = p.locationId;
  return raoul;
}

describe('Rejoindre la bande', () => {
  it('il faut la confiance d’un membre ; un homme titré ne peut pas', () => {
    const s = createWorld(1101);
    const p = s.characters.player;
    expect(gangContact(s, 'raoul')).toBeUndefined(); // il ne te connaît pas
    const raoul = friendInGang(s);
    expect(gangContact(s, 'raoul')?.id).toBe('b_loups');
    p.title = 'ecuyer';
    expect(joinGang(s, raoul.id).ok).toBe(false);
    p.title = undefined;
    raoul.locationId = p.locationId;
    expect(joinGang(s, raoul.id).ok).toBe(true);
    expect(gangOf(s)?.id).toBe('b_loups');
    expect(gangContact(s, 'raoul')).toBeUndefined(); // déjà membre
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('membre, on n’est plus rançonné par sa bande et l’on touche sa part du butin', () => {
    const s = createWorld(1102);
    const p = s.characters.player;
    joinGang(s, friendInGang(s).id);
    for (let i = 0; i < 40; i++) expect(rollTravelAmbush(s, 'square', s.settlements.staubin.squareId, 300)).toBeUndefined();
    const g = s.orgs.b_loups;
    const giver = Object.values(s.characters).find(c => !c.isPlayer && c.money >= 100) ?? fund(s, 0);
    transferMoney(s, P.c(giver.id), P.o(g.id), 100);
    const m0 = totalMoney(s), pm = p.money;
    const share = playerGangShare(s, g);
    expect(share).toBeGreaterThan(0);
    expect(p.money).toBe(pm + share);
    expect(totalMoney(s)).toBe(m0);
    expect(leaveGang(s).ok).toBe(true);
    expect(gangOf(s)).toBeUndefined();
  });

  it('guetter la route : rien ne passe, ou une caravane est attaquée (butin réel, rien de créé)', () => {
    const s = createWorld(1103);
    const p = s.characters.player;
    const money0 = totalMoney(s), items0 = totalItems(s); // référence prise à la création du monde
    joinGang(s, friendInGang(s).id);
    p.needs.energy = 90;
    const t0 = s.time;
    expect(gangRaid(s).message).toMatch(/personne ne passe/);
    expect(s.time - t0).toBe(360);
    // une caravane de Saint-Aubin vers Valcendre, sur la route voisine du repaire
    const m = s.characters.gilles;
    m.locationId = 'road_v_sa'; m.money += 0;
    m.activity = { kind: 'travel', locationId: 'road_v_sa', since: s.time, until: s.time + 600, note: 'En route' };
    const farm = allBusinesses(s).find(b => b.kind === 'farm')!;
    farm.stock.grain = (farm.stock.grain ?? 0) - 20; // la cargaison vient d'un stock réel
    s.caravans.push({ id: 'cv_t', merchantId: m.id, from: 'staubin', to: 'valcendre', cargo: { grain: 20 }, cost: 100, departTime: s.time, arriveTime: s.time + 600, status: 'en_route', returning: false });
    p.needs.energy = 90; p.health = 100;
    const r = gangRaid(s);
    expect(r.ok).toBe(true);
    expect(s.caravans.find(c => c.id === 'cv_t')!.ambushed).toBe(true);
    expect(s.events.some(e => e.type === 'ambush' && e.targetId === m.id)).toBe(true);
    expect(moneyBalance(money0, s)).toBe(0);
    expect(itemBalance(items0, s, totalItems(s))).toEqual({});
    if (r.message.includes('reconnu')) expect(wantedFor(s, p.id)).toBeTruthy();
    expect(p.alive).toBe(true);
  });
});

describe('Hommes d’armes', () => {
  /** Rend un habitant disponible et présent auprès du joueur. */
  function candidate(s: GameState, i = 0) {
    const p = s.characters.player;
    const c = Object.values(s.characters).filter(x => !x.isPlayer && x.alive && x.age >= 18 && x.age < 50 && x.profession !== 'seigneur'
      && !allBusinesses(s).some(b => b.ownerId === x.id) && !s.orgOrder.some(id => s.orgs[id].members.includes(x.id)) && s.locations[x.homeId].settlementId === 'valcendre')[i];
    if (c.employerId) { const b = s.businesses[c.employerId]; b.employees = b.employees.filter(id => id !== c.id); c.employerId = undefined; }
    c.profession = 'sans_emploi'; c.locationId = p.locationId; c.health = 100; c.sick = 0;
    return c;
  }

  it('s’engagent contre une prime, dans la limite du rang, et touchent leur solde chaque jour', () => {
    const s = createWorld(1110);
    const p = fund(s, 200);
    const a = candidate(s, 0), b = candidate(s, 1), c = candidate(s, 2);
    expect(recruitsHere(s).map(x => x.id)).toContain(a.id);
    const m0 = totalMoney(s), am = a.money;
    expect(hireManAtArms(s, a.id).ok).toBe(true);
    expect(a.money).toBe(am + RETINUE_BOUNTY);
    b.locationId = p.locationId; c.locationId = p.locationId;
    expect(hireManAtArms(s, b.id).ok).toBe(true);
    c.locationId = p.locationId;
    expect(retinueCap(p)).toBe(2);
    expect(hireManAtArms(s, c.id).ok).toBe(false); // sans titre : deux hommes
    const pm = p.money;
    dailyRetinue(s);
    expect(pm - p.money).toBe(2 * RETINUE_PAY);
    expect(totalMoney(s)).toBe(m0);
    // sans solde, ils s'en vont
    transferMoney(s, P.c(p.id), P.c(c.id), p.money);
    dailyRetinue(s);
    expect(retinue(s).length).toBe(0);
    expect(a.profession).toBe('sans_emploi');
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('suivent leur capitaine, dissuadent les brigands et se battent à ses côtés', () => {
    const s = createWorld(1111);
    const p = fund(s, 300);
    const a = candidate(s, 0);
    hireManAtArms(s, a.id);
    p.locationId = 'farm';
    a.needs.hunger = 10; a.needs.energy = 90;
    expect(followsCaptain(s, a, 10)).toBe(true);
    expect(a.locationId).toBe('farm');
    a.needs.hunger = 80;
    expect(followsCaptain(s, a, 10)).toBe(false); // il va d'abord manger
    a.needs.hunger = 10; followsCaptain(s, a, 10);
    expect(alliesAtHand(s).map(x => x.id)).toEqual([a.id]);
    expect(escortFactor(s)).toBeCloseTo(0.8, 5);
    expect(dismissManAtArms(s, a.id).ok).toBe(true);
    expect(escortFactor(s)).toBe(1);
  });

  it('une vie avec deux hommes d’armes reste cohérente sur deux semaines', () => {
    const s = createWorld(1112);
    const p = fund(s, 400);
    hireManAtArms(s, candidate(s, 0).id);
    const second = candidate(s, 1); second.locationId = p.locationId;
    hireManAtArms(s, second.id);
    const m0 = totalMoney(s), i0 = totalItems(s);
    for (let d = 0; d < 14; d++) { p.needs.hunger = 20; p.health = 100; s.encounter = undefined; advanceTime(s, MIN_PER_DAY); }
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    expect(retinue(s).every(c => c.alive)).toBe(true);
  }, 20000);
});

describe('Se battre pour une maison', () => {
  it('une promesse d’épée ajoute le joueur et ses hommes à la bataille, puis la maison récompense', () => {
    const s = createWorld(1120);
    const p = fund(s, 100);
    expect(muster(s, 'h_delaval').ok).toBe(false); // pas de guerre
    s.wars.push({ id: 'w_t', attackerId: 'h_roche', defenderId: 'h_delaval', targetSettlementId: 'valcendre', startDay: 0, victories: { attacker: 0, defender: 0 }, battles: 0, status: 'active' });
    expect(muster(s, 'h_delaval').ok).toBe(true);
    expect(musteredFor(s, 'h_delaval').map(c => c.id)).toContain(p.id);
    expect(musteredFor(s, 'h_roche')).toEqual([]);
    const m0 = totalMoney(s), pm = p.money;
    afterBattle(s, 'h_delaval', true);
    expect(p.money).toBeGreaterThan(pm);
    expect(totalMoney(s)).toBe(m0);
    expect(s.muster).toBeUndefined();
    expect((s.chronicle ?? []).some(c => c.text.includes('combat pour'))).toBe(true);
  });

  it('une guerre réelle avec le joueur engagé se déroule sans incohérence', () => {
    const s = createWorld(1121);
    const p = s.characters.player;
    s.wars.push({ id: 'w_t', attackerId: 'h_roche', defenderId: 'h_delaval', targetSettlementId: 'valcendre', startDay: 0, victories: { attacker: 0, defender: 0 }, battles: 0, status: 'active' });
    muster(s, 'h_delaval');
    const m0 = totalMoney(s);
    for (let d = 0; d < 9 && !s.pendingSuccession && !s.gameOver; d++) { if (p.alive) { p.needs.hunger = 20; p.needs.energy = 80; p.health = Math.max(p.health, 60); } s.encounter = undefined; advanceTime(s, MIN_PER_DAY); }
    expect(s.events.some(e => e.type === 'battle')).toBe(true);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
  }, 20000);
});

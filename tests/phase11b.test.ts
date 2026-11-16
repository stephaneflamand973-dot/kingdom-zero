// Phase 11 (suite) — chef de bande, maison du joueur, équipement des hommes d'armes, guerres plus fréquentes.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, allBusinesses, buyGear, challengeGangLeader, checkIntegrity, continueAs, createWorld, declareWar, fighterOf, foundHouse,
  gangOf, GEAR, hireManAtArms, houseOfPlayer, houseTreasury, HOUSE_FOUNDING, joinGang, killCharacter, landsOf, MIN_PER_DAY, moneyBalance,
  P, qty, retinue, soldiersOf, totalMoney, transferMoney, warTargets, type GameState,
} from '../src/engine';

function fund(s: GameState, amount: number) {
  const p = s.characters.player;
  for (const b of allBusinesses(s).slice().sort((a, b) => b.treasury - a.treasury)) {
    const take = Math.min(Math.max(0, b.treasury - 40), amount - p.money);
    if (take > 0) transferMoney(s, P.b(b.id), P.c(p.id), take);
  }
  for (const c of Object.values(s.characters).filter(x => !x.isPlayer).sort((a, b) => b.money - a.money)) {
    const take = Math.min(Math.max(0, c.money - 20), amount - p.money);
    if (take > 0) transferMoney(s, P.c(c.id), P.c(p.id), take);
  }
  return p;
}

describe('Chef de bande', () => {
  it('on défie le chef en duel : vainqueur, on prend la tête et l’on touche double part', () => {
    const s = createWorld(1130);
    const p = s.characters.player;
    const raoul = s.characters.raoul;
    raoul.relations[p.id] = { affinity: 40, trust: 30, lastInteraction: 0 }; raoul.locationId = p.locationId;
    joinGang(s, 'raoul');
    // un joueur aguerri contre un chef affaibli
    p.skills.combat = 70; p.attributes.force = 10; p.health = 100; p.needs.energy = 90;
    raoul.health = 40; raoul.locationId = p.locationId;
    const r = challengeGangLeader(s);
    expect(r.ok).toBe(true);
    expect(gangOf(s)!.leaderId).toBe(p.id);
    expect(gangOf(s)!.roles.raoul).toBe('membre');
    expect(raoul.alive).toBe(true); // un duel, pas un meurtre
    expect(challengeGangLeader(s).ok).toBe(false); // on la mène déjà
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('un duel perdu laisse dans la bande, humilié', () => {
    const s = createWorld(1131);
    const p = s.characters.player;
    const raoul = s.characters.raoul;
    raoul.relations[p.id] = { affinity: 40, trust: 30, lastInteraction: 0 }; raoul.locationId = p.locationId;
    joinGang(s, 'raoul');
    p.skills.combat = 0; p.attributes.force = 1; p.health = 60; p.needs.energy = 90;
    raoul.skills.combat = 80; raoul.attributes.force = 10; raoul.health = 100; raoul.locationId = p.locationId;
    challengeGangLeader(s);
    expect(gangOf(s)!.leaderId).toBe('raoul');
    expect(gangOf(s)!.members).toContain(p.id);
  });
});

describe('La maison du joueur', () => {
  it('un écuyer fonde sa maison : trésor doté, hommes d’armes devenus soldats, conjoint membre', () => {
    const s = createWorld(1140);
    const p = fund(s, 700);
    expect(foundHouse(s).ok).toBe(false); // sans titre
    p.title = 'ecuyer';
    const c = Object.values(s.characters).find(x => !x.isPlayer && x.alive && x.age >= 18 && x.age < 50 && !x.employerId && !s.orgOrder.some(id => s.orgs[id].members.includes(x.id)))!;
    c.locationId = p.locationId; c.health = 100; c.sick = 0;
    expect(hireManAtArms(s, c.id).ok).toBe(true);
    const m0 = totalMoney(s);
    const r = foundHouse(s);
    expect(r.ok).toBe(true);
    const h = houseOfPlayer(s)!;
    expect(h.treasury).toBe(HOUSE_FOUNDING);
    expect(h.roles[c.id]).toBe('soldat');
    expect(retinue(s).length).toBe(0); // soldés par la maison désormais
    expect(soldiersOf(s, h).map(x => x.id)).toContain(c.id);
    expect(totalMoney(s)).toBe(m0);
    expect(houseTreasury(s, -50).ok).toBe(true);
    expect(h.treasury).toBe(HOUSE_FOUNDING - 50);
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('déclarer la guerre pour une localité voisine : le joueur combat, une victoire donne un fief', () => {
    const s = createWorld(1141);
    const p = fund(s, 700);
    p.title = 'ecuyer';
    foundHouse(s);
    const h = houseOfPlayer(s)!;
    expect(warTargets(s)).toContain('valcendre');
    const m0 = totalMoney(s);
    expect(declareWar(s, 'valcendre').ok).toBe(true);
    expect(declareWar(s, 'staubin').ok).toBe(false); // une guerre à la fois
    // un champion invincible pour vérifier la conquête
    p.skills.combat = 100; p.attributes.force = 10; p.attributes.agilite = 10;
    p.gear = { weapon: { id: 'epee_longue', wear: 0 }, armor: { id: 'harnois', wear: 0 } };
    expect(fighterOf(p).attack).toBeGreaterThan(20);
    for (let d = 0; d < 30 && !landsOf(s, h).length && s.wars.some(w => w.status === 'active'); d++) {
      p.needs.hunger = 20; p.needs.energy = 80; p.health = 100; s.encounter = undefined;
      advanceTime(s, MIN_PER_DAY);
    }
    const war = s.wars.find(w => w.attackerId === h.id)!;
    expect(war.battles).toBeGreaterThan(0);
    if (landsOf(s, h).length) expect(s.settlements.valcendre.lordHouseId).toBe(h.id);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(checkIntegrity(s)).toEqual([]);
  }, 30000);

  it('à la mort du joueur, sa maison passe à celui qui reprend la lignée', () => {
    const s = createWorld(1142);
    const p = fund(s, 700);
    p.title = 'ecuyer';
    const friend = Object.values(s.characters).find(x => !x.isPlayer && x.alive && x.age >= 20 && x.profession !== 'seigneur')!;
    friend.relations[p.id] = { affinity: 60, trust: 50, lastInteraction: 0 };
    foundHouse(s);
    const h = houseOfPlayer(s)!;
    killCharacter(s, p, 'de vieillesse');
    expect(h.leaderId).toBeNull();
    expect(h.dissolved).toBeFalsy();
    expect(s.pendingSuccession!.candidates).toContain(friend.id);
    continueAs(s, friend.id);
    expect(h.leaderId).toBe(friend.id);
    expect(h.roles[friend.id]).toBe('seigneur');
    expect(checkIntegrity(s)).toEqual([]);
  });
});

describe('Équiper ses hommes d’armes', () => {
  it('une épée forgée pour un homme d’armes renforce ce soldat-là, pas le joueur', () => {
    const s = createWorld(1150);
    const p = fund(s, 500);
    const c = Object.values(s.characters).find(x => !x.isPlayer && x.alive && x.age >= 18 && x.age < 50 && !x.employerId && !s.orgOrder.some(id => s.orgs[id].members.includes(x.id)))!;
    c.locationId = p.locationId; c.health = 100; c.sick = 0;
    hireManAtArms(s, c.id);
    const forge = allBusinesses(s).find(b => b.kind === 'forge')!;
    forge.stock.tools = Math.max(qty(forge.stock, 'tools'), 4);
    p.locationId = forge.locationId;
    const atk0 = fighterOf(c).attack;
    expect(buyGear(s, forge.id, 'epee', c.id).ok).toBe(true);
    expect(c.gear?.weapon?.id).toBe('epee');
    expect(p.gear?.weapon).toBeUndefined();
    expect(fighterOf(c).attack).toBeGreaterThan(atk0); // l'épée (+6) remplace le fourniment de base (+4)
    const stranger = Object.values(s.characters).find(x => !x.isPlayer && x.alive && x.id !== c.id)!;
    p.locationId = forge.locationId;
    expect(buyGear(s, forge.id, 'dague', stranger.id).ok).toBe(false);
    void GEAR;
  });
});

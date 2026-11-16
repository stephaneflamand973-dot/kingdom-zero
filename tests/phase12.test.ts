// Phase 12 — gouverner son fief, tournois de saison, postures d'escrime, PNJ qui s'équipent.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, allBusinesses, applyStance, buildWork, checkIntegrity, computeUnrest, createWorld, deserialize, encounterAction, enterTourney,
  exchange, fighterOf, foundHouse, hasWork, holdAudience, houseOfPlayer, hourlyTourneys, moneyBalance, settlementIdOf, P, qty, serialize,
  setFiefTax, toDate, totalMoney, transferMoney, upcomingTourney, weeklyArming, weeklyGovernance, WORKS, type GameState,
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

/** Le joueur fonde sa maison et reçoit Valcendre en fief. */
function lordOfValcendre(seed: number) {
  const s = createWorld(seed);
  const p = fund(s, 1400);
  p.title = 'ecuyer';
  expect(foundHouse(s).ok).toBe(true);
  const h = houseOfPlayer(s)!;
  transferMoney(s, P.c(p.id), P.o(h.id), 600);
  s.settlements.valcendre.lordHouseId = h.id;
  return { s, p, h, st: s.settlements.valcendre };
}

/** Fait passer les jours en gardant le joueur en forme (il attend, sans risque de mourir de faim). */
function rest(s: GameState, until: (s: GameState) => boolean, maxHours = 24 * 40) {
  for (let i = 0; i < maxHours && !until(s); i++) {
    const p = s.characters[s.playerId];
    p.needs.hunger = 0; p.needs.energy = 90; p.health = 100; p.sick = 0;
    advanceTime(s, 60);
  }
}

describe('Postures d’escrime', () => {
  it('parer réduit les coups reçus, le coup puissant frappe plus fort', () => {
    const s = createWorld(1200);
    const me = s.characters.player, foe = s.characters.raoul;
    const trial = (stance: 'fight' | 'guard' | 'strike') => {
      let taken = 0, dealt = 0;
      for (let i = 0; i < 400; i++) {
        const a = fighterOf(me), b = fighterOf(foe);
        a.hp = 100; b.hp = 100;
        applyStance(s, a, me, stance, [foe], []);
        exchange(s, [a], [b], []);
        taken += 100 - a.hp; dealt += 100 - b.hp;
      }
      return { taken, dealt };
    };
    const plain = trial('fight'), guard = trial('guard'), strike = trial('strike');
    expect(guard.taken).toBeLessThan(plain.taken);
    expect(guard.dealt).toBeLessThan(plain.dealt);
    expect(strike.dealt).toBeGreaterThan(plain.dealt);
  });
});

describe('Gouverner son fief', () => {
  it('le seigneur fixe l’impôt ; la maison ne le change plus d’elle-même', () => {
    const { s, st } = lordOfValcendre(1210);
    expect(setFiefTax(s, 'valcendre', 0.12).ok).toBe(true);
    expect(st.taxRate).toBe(0.12);
    expect(setFiefTax(s, 'valcendre', 0.12).ok).toBe(false);
    expect(setFiefTax(s, 'hautepierre', 0.02).ok).toBe(false); // pas sa terre
    weeklyGovernance(s);
    expect(st.taxRate).toBe(0.12);
    expect(setFiefTax(s, 'valcendre', 0.5).ok).toBe(true);
    expect(st.taxRate).toBe(0.15); // plafonné
  });

  it('un aménagement se paie au trésor, l’argent reste dans le pays, l’effet vient au bout du chantier', () => {
    const { s, h, st, p } = lordOfValcendre(1211);
    p.locationId = st.squareId;
    const m0 = totalMoney(s), t0 = h.treasury;
    const before = computeUnrest(s, st);
    expect(buildWork(s, 'chapelle').ok).toBe(true);
    expect(h.treasury).toBe(t0 - WORKS.chapelle.cost);
    expect(totalMoney(s)).toBe(m0);
    expect(buildWork(s, 'chapelle').ok).toBe(false); // déjà commandée
    expect(hasWork(s, 'valcendre', 'chapelle')).toBe(false);
    rest(s, x => hasWork(x, 'valcendre', 'chapelle'));
    expect(hasWork(s, 'valcendre', 'chapelle')).toBe(true);
    // la grogne calculée intègre la chapelle (8 points de moins, toutes choses égales)
    st.works = [];
    const without = computeUnrest(s, st);
    st.works = [{ id: 'chapelle', ready: 0 }];
    expect(computeUnrest(s, st)).toBe(Math.max(0, without - 8));
    expect(before).toBeGreaterThanOrEqual(0);
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('tenir audience : à l’intendance, une fois par semaine, la grogne s’apaise', () => {
    const { s, p, st } = lordOfValcendre(1212);
    rest(s, x => toDate(x.time).hour === 10);
    expect(holdAudience(s).ok).toBe(false); // pas à l'intendance
    p.locationId = s.businesses[st.manorId].locationId;
    const u0 = computeUnrest(s, st);
    const m0 = totalMoney(s);
    const r = holdAudience(s);
    expect(r.ok).toBe(true);
    expect(computeUnrest(s, st)).toBeLessThanOrEqual(u0);
    expect(holdAudience(s).ok).toBe(false); // une fois par semaine
    expect(totalMoney(s)).toBe(m0);
  });

  it('un seigneur PNJ au trésor plein bâtit ce qui manque à ses terres', () => {
    const s = createWorld(1213);
    const p = fund(s, 3000);
    const m0 = totalMoney(s);
    transferMoney(s, P.c(p.id), P.o('h_roche'), p.money);
    s.characters[s.orgs.h_roche.leaderId!].traits = s.characters[s.orgs.h_roche.leaderId!].traits.filter(t => t !== 'avare');
    for (let w = 0; w < 30 && !Object.values(s.settlements).some(x => x.works?.length); w++) weeklyGovernance(s);
    expect(Object.values(s.settlements).some(x => x.works?.length)).toBe(true);
    expect(totalMoney(s)).toBe(m0);
  });
});

describe('Tournois', () => {
  it('annoncé à la fête de saison ; le joueur entre en lice, livre ses assauts, et le prix est réel', () => {
    const s = createWorld(1220);
    const p = s.characters.player;
    rest(s, x => !!upcomingTourney(x));
    const t = upcomingTourney(s)!;
    expect(t).toBeTruthy();
    expect(enterTourney(s).ok).toBe(false); // pas encore le jour
    rest(s, x => toDate(x.time).day === t.day && toDate(x.time).hour === 9);
    p.locationId = s.settlements[t.settlementId].squareId;
    // un champion redoutable
    p.skills.combat = 90; p.attributes.force = 10; p.attributes.agilite = 9; p.health = 100; p.needs.energy = 100;
    if (p.money < 20) transferMoney(s, P.b(s.settlements[t.settlementId].manorId), P.c(p.id), 20);
    const m0 = totalMoney(s);
    const r = enterTourney(s);
    expect(r.ok).toBe(true);
    expect(s.encounter?.kind).toBe('duel');
    let n = 0;
    while (s.encounter && n++ < 200) encounterAction(s, n % 3 === 0 ? 'feint' : 'strike');
    expect(s.encounter).toBeUndefined();
    expect(t.status).toBe('done');
    expect(t.championId).toBeTruthy();
    expect(p.alive).toBe(true);
    expect(totalMoney(s)).toBe(m0);
    if (t.championId === p.id) expect(p.title).toBe('ecuyer'); // armé écuyer au soir du tournoi
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('céder l’assaut élimine ; le tournoi se termine sans le joueur', () => {
    const s = createWorld(1221);
    const p = s.characters.player;
    rest(s, x => !!upcomingTourney(x));
    const t = upcomingTourney(s)!;
    rest(s, x => toDate(x.time).day === t.day && toDate(x.time).hour === 9);
    p.locationId = s.settlements[t.settlementId].squareId;
    if (p.money < 20) transferMoney(s, P.b(s.settlements[t.settlementId].manorId), P.c(p.id), 20);
    expect(enterTourney(s).ok).toBe(true);
    const r = encounterAction(s, 'surrender');
    expect(r.ok).toBe(true);
    expect(s.encounter).toBeUndefined();
    expect(t.status).toBe('done');
    expect(t.championId).not.toBe(p.id);
  });

  it('sans le joueur, le tournoi se joue à 13 h et le vainqueur touche le prix', () => {
    const s = createWorld(1222);
    rest(s, x => !!upcomingTourney(x));
    const t = upcomingTourney(s)!;
    const m0 = totalMoney(s);
    rest(s, () => t.status === 'done');
    expect(t.status).toBe('done');
    const champ = s.characters[t.championId!];
    expect(champ).toBeTruthy();
    expect(champ.alive).toBe(true);
    expect(moneyBalance(m0, s)).toBe(0); // l'argent change de mains, sans création (migrants compris)
    hourlyTourneys(s); // sans effet une fois joué
    expect(checkIntegrity(s)).toEqual([]);
  });
});

describe('Les PNJ s’équipent', () => {
  it('un garde qui a de l’épargne se fait forger une protection ; le métal sort du stock de la forge', () => {
    const s = createWorld(1230);
    const guardC = Object.values(s.characters).find(c => c.profession === 'garde' && c.alive)!;
    const sid = settlementIdOf(s, guardC.homeId);
    const forge = allBusinesses(s).find(b => b.kind === 'forge' && settlementIdOf(s, b.locationId) === sid)!;
    forge.stock.tools = 10;
    const p = fund(s, 400);
    transferMoney(s, P.c(p.id), P.c(guardC.id), 300);
    const m0 = totalMoney(s), t0 = qty(forge.stock, 'tools');
    weeklyArming(s);
    expect(guardC.gear?.armor?.id).toBe('gambison');
    expect(qty(forge.stock, 'tools')).toBeLessThan(t0);
    expect(totalMoney(s)).toBe(m0);
    expect(checkIntegrity(s)).toEqual([]);
  });
});

describe('Sauvegarde', () => {
  it('aménagements et tournois survivent à la sauvegarde', () => {
    const { s, st, p } = lordOfValcendre(1240);
    p.locationId = st.squareId;
    buildWork(s, 'paves');
    rest(s, x => !!upcomingTourney(x));
    const back = deserialize(serialize(s));
    expect(back.error).toBeUndefined();
    expect(back.state!.settlements.valcendre.works?.[0].id).toBe('paves');
    expect(back.state!.tourneys?.length).toBeGreaterThan(0);
    const m0 = totalMoney(s);
    expect(moneyBalance(m0, back.state!)).toBe(0);
  });
});

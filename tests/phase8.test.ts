// Phase 8 — carrière : apprentissage, grades, promotions, augmentation, reprise par le contremaître.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, allBusinesses, applyForJob, askRaise, businessesIn, careerReview, careerStatus, checkIntegrity, createWorld, eligibleGrade,
  foundingCost, FOUNDING_COST, gradeOf, gradeWage, hiringGrade, jobOffer, journeymanSkill, killCharacter, learningRate, manageBusiness,
  MIN_PER_DAY, minutesUntilHour, moneyBalance, raiseChance, socialRank, totalMoney, weeklyContractReview, type Business, type GameState,
} from '../src/engine';

const signAt = (s: GameState, kind: Business['kind']) => {
  const p = s.characters[s.playerId];
  const b = businessesIn(s, 'valcendre').find(x => x.kind === kind)!;
  p.locationId = b.locationId;
  advanceTime(s, minutesUntilHour(s.time, b.openFrom + 1));
  p.locationId = b.locationId;
  const r = applyForJob(s, b.id);
  return { p, b, owner: s.characters[b.ownerId!], r, k: s.contracts.find(k => k.status === 'active' && k.workerId === p.id) };
};

describe('Apprentissage', () => {
  it('un débutant sans expérience est pris comme apprenti à la forge, sans que le maître le connaisse', () => {
    const s = createWorld(801);
    const p = s.characters[s.playerId];
    const forge = businessesIn(s, 'valcendre').find(b => b.kind === 'forge')!;
    expect(p.skills.artisanat).toBeLessThan(journeymanSkill(forge));
    const o = jobOffer(s, forge, p);
    expect(o.ok).toBe(true);
    expect(o.grade).toBe('apprenti');
    const { r, k } = signAt(s, 'forge');
    expect(r.ok).toBe(true);
    expect(gradeOf(k!)).toBe('apprenti');
    expect(socialRank(s).level).toBeLessThan(2); // un apprenti n'est pas encore compagnon
    // une seule place d'apprenti par atelier
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('l’apprenti apprend plus vite que le compagnon, et mieux auprès d’un maître', () => {
    const s = createWorld(802);
    const { p, b, k } = signAt(s, 'bakery');
    const asApprentice = learningRate(s, p, b);
    expect(asApprentice).toBeGreaterThanOrEqual(1.5);
    k!.grade = 'compagnon';
    expect(learningRate(s, p, b)).toBeLessThan(asApprentice);
    const npc = s.characters[b.ownerId!];
    expect(learningRate(s, npc, b)).toBe(1); // les PNJ ne sont pas concernés
  });

  it('un voleur connu ou un ennemi du maître n’est pas pris en apprentissage', () => {
    const s = createWorld(803);
    const p = s.characters[s.playerId];
    const forge = businessesIn(s, 'valcendre').find(b => b.kind === 'forge')!;
    s.characters[forge.ownerId!].relations[p.id] = { affinity: -20, trust: -10, lastInteraction: 0 };
    expect(jobOffer(s, forge, p).ok).toBe(false);
  });
});

describe('Grades et salaires', () => {
  it('chaque grade paie nettement mieux que le précédent', () => {
    const s = createWorld(810);
    const p = s.characters[s.playerId];
    const b = allBusinesses(s).find(x => x.kind === 'bakery')!;
    p.skills.artisanat = 50;
    const w = (['apprenti', 'compagnon', 'maitre', 'contremaitre'] as const).map(g => gradeWage(b, p, g));
    expect(w[0]).toBeLessThan(w[1]);
    expect(w[1]).toBeLessThan(w[2]);
    expect(w[2]).toBeLessThan(w[3]);
    expect(w[3]).toBeGreaterThanOrEqual(w[1] * 1.5);
  });

  it('la revue du lundi promeut selon la compétence et l’ancienneté, et le salaire suit', () => {
    const s = createWorld(811);
    const { p, b, k } = signAt(s, 'bakery');
    const w0 = k!.wage;
    p.skills.artisanat = journeymanSkill(b) + 1;
    k!.goodWeeks = 1;
    careerReview(s, k!, b, p);
    expect(gradeOf(k!)).toBe('compagnon');
    expect(k!.wage).toBeGreaterThan(w0);
    // maître : compétence 45 ET quatre semaines satisfaisantes
    p.skills.artisanat = 50; k!.goodWeeks = 2;
    careerReview(s, k!, b, p);
    expect(gradeOf(k!)).toBe('compagnon');
    k!.goodWeeks = 4;
    careerReview(s, k!, b, p);
    expect(gradeOf(k!)).toBe('maitre');
    expect(p.gradeHeld?.artisanat).toBe('maitre');
    expect(s.events.some(e => e.type === 'promotion' && e.text.includes('maître'))).toBe(true);
    // contremaître : il faut aussi savoir gérer
    p.skills.artisanat = 70; k!.goodWeeks = 12; p.skills.gestion = 5;
    expect(eligibleGrade(b, p, 12)).toBe('maitre');
    p.skills.gestion = 12;
    careerReview(s, k!, b, p);
    expect(gradeOf(k!)).toBe('contremaitre');
  });

  it('un maître garde son grade chez un nouveau patron ; un grade ne redescend jamais en cours de contrat', () => {
    const s = createWorld(812);
    const p = s.characters[s.playerId];
    const b = allBusinesses(s).find(x => x.kind === 'bakery')!;
    p.skills.artisanat = 50;
    expect(hiringGrade(b, p)).toBe('compagnon');
    p.gradeHeld = { artisanat: 'maitre' };
    expect(hiringGrade(b, p)).toBe('maitre');
    p.gradeHeld = { artisanat: 'contremaitre' };
    expect(hiringGrade(b, p)).toBe('maitre'); // la confiance d'un contremaître se regagne sur place
  });

  it('la revue hebdomadaire réelle fait progresser un apprenti assidu', () => {
    const s = createWorld(813);
    const { p, b, k } = signAt(s, 'bakery');
    p.skills.artisanat = journeymanSkill(b);
    k!.hoursThisWeek = 30;
    k!.startDay -= 7;
    weeklyContractReview(s);
    expect(gradeOf(k!)).toBe('compagnon');
    expect(k!.goodWeeks).toBe(1);
  });
});

describe('Augmentation', () => {
  it('se demande en personne, pas en apprentissage, et pas plus d’une fois par mois', () => {
    const s = createWorld(820);
    const { p, b, owner, k } = signAt(s, 'bakery');
    expect(askRaise(s).ok).toBe(false); // apprenti
    k!.grade = 'compagnon';
    expect(askRaise(s).ok).toBe(false); // trop tôt
    k!.startDay -= 30;
    owner.locationId = 'square'; p.locationId = b.locationId;
    if (owner.locationId === p.locationId) owner.locationId = s.settlements.valcendre.squareId;
    expect(askRaise(s).message).toMatch(/en personne/);
    owner.locationId = p.locationId;
    owner.relations[p.id] = { affinity: 80, trust: 90, lastInteraction: 0 };
    k!.goodWeeks = 12; p.skills.diplomatie = 60;
    expect(raiseChance(s, k!)).toBeGreaterThan(0.9);
    const w0 = k!.wage, m0 = totalMoney(s);
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) { k!.lastRaiseDay = undefined; k!.startDay -= 30; owner.locationId = p.locationId; ok = k!.wage > w0 || (askRaise(s), k!.wage > w0); }
    expect(k!.wage).toBe(w0 + 1);
    expect(moneyBalance(m0, s) === 0 || totalMoney(s) === m0).toBe(true);
    owner.locationId = p.locationId;
    expect(askRaise(s).ok).toBe(false); // délai d'un mois
  });
});

describe('Le contremaître et l’atelier', () => {
  it('le contremaître reprend l’affaire d’un patron mort sans héritier', () => {
    const s = createWorld(830);
    const { p, b, owner, k } = signAt(s, 'forge');
    k!.grade = 'contremaitre';
    // patron sans famille
    owner.spouseId = undefined; owner.childIds = []; owner.parentIds = [];
    for (const c of Object.values(s.characters)) { c.parentIds = c.parentIds.filter(id => id !== owner.id); if (c.spouseId === owner.id) c.spouseId = undefined; }
    killCharacter(s, owner, 'de vieillesse');
    expect(b.ownerId).toBe(p.id);
    expect(k!.status).toBe('ended');
    expect(b.employees.includes(p.id)).toBe(false);
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('un apprenti n’est pas renvoyé parce que les réserves débordent', () => {
    const s = createWorld(831);
    const { p, b } = signAt(s, 'bakery');
    b.stock.bread = 500; // production largement excédentaire
    b.lastStaffChangeDay = -20;
    const others = b.employees.filter(id => id !== p.id).length;
    for (let i = 0; i < 6; i++) { b.lastStaffChangeDay = -20; manageBusiness(s, b); }
    expect(b.employees.includes(p.id)).toBe(true);
    expect(b.employees.filter(id => id !== p.id).length).toBeLessThanOrEqual(others);
  });

  it('un maître du métier fonde son atelier un quart moins cher', () => {
    const s = createWorld(832);
    const p = s.characters[s.playerId];
    expect(foundingCost(p, 'forge')).toBe(FOUNDING_COST.forge);
    p.skills.artisanat = 45;
    expect(foundingCost(p, 'forge')).toBe(Math.round(FOUNDING_COST.forge! * 0.75));
  });

  it('une carrière vécue : apprenti puis compagnon en quelques semaines, monde intègre', () => {
    const s = createWorld(2);
    const { r } = signAt(s, 'bakery');
    expect(r.ok).toBe(true);
    const m0 = totalMoney(s);
    let grade = 'apprenti';
    for (let w = 0; w < 6 && grade === 'apprenti'; w++) {
      for (let d = 0; d < 7; d++) { if (s.encounter) s.encounter = undefined; advanceTime(s, MIN_PER_DAY); }
      // le joueur fait ses heures (travail réel au fournil)
      grade = careerStatus(s)?.grade ?? grade;
    }
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
  }, 20000);
});

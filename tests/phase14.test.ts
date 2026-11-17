// Phase 14 — le savoir-faire compte : compétences du propriétaire, commandement, forge par soi-même.
import { describe, expect, it } from 'vitest';
import {
  allBusinesses, askPrice, checkIntegrity, commandBonus, commandExtra, createWorld, gearPrice, gearPriceFor, gestionWear, masterBonusRate,
  masterLabor, masteryNotes, moneyBalance, qualityPremium, retinueCap, sellersOf, totalMoney, transferBusiness, weeklyWageReview, advanceTime, MIN_PER_DAY,
  type GameState,
} from '../src/engine';

function bakeryOf(s: GameState, lvl: number) {
  const p = s.characters.player;
  const b = allBusinesses(s).find(x => x.kind === 'bakery')!;
  transferBusiness(s, b, p, b.ownerId ? s.characters[b.ownerId] : undefined);
  p.skills.artisanat = lvl; p.skills.gestion = lvl; p.skills.commerce = lvl;
  return { p, b };
}

describe('Le savoir-faire du propriétaire', () => {
  it('rendement, tour de main, qualité, gestion et négoce croissent avec la compétence', () => {
    const s = createWorld(1500);
    const { p, b } = bakeryOf(s, 10);
    const low = { labor: masterLabor(s, b), bonus: masterBonusRate(s, b), q: qualityPremium(s, b), wear: gestionWear(s, b), price: askPrice(s, b, 'bread') };
    p.skills.artisanat = 100; p.skills.gestion = 100; p.skills.commerce = 100;
    expect(masterLabor(s, b)).toBeGreaterThan(low.labor);
    expect(masterLabor(s, b)).toBeCloseTo(1.28, 2);
    expect(masterBonusRate(s, b)).toBeGreaterThan(0.3);
    expect(low.bonus).toBe(0);
    expect(qualityPremium(s, b)).toBeCloseTo(0.117, 2);
    expect(gestionWear(s, b)).toBeLessThan(low.wear);
    expect(askPrice(s, b, 'bread')).toBeGreaterThanOrEqual(low.price);
    expect(masteryNotes(s, b).join(' ')).toContain('Artisanat 100');
  });

  it('à prix voisin, les clients vont chez le meilleur artisan', () => {
    const s = createWorld(1501);
    const { b } = bakeryOf(s, 100);
    const buyer = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.homeId && s.locations[c.homeId] && c.age > 16)!;
    buyer.locationId = s.settlements.valcendre.squareId;
    const list = sellersOf(s, 'bread', 10, buyer, true);
    const tavern = list.find(x => x.b.kind === 'tavern');
    if (tavern) expect(list.findIndex(x => x.b.id === b.id)).toBeLessThan(list.findIndex(x => x.b.id === tavern.b.id));
  });

  it('un maître fait plus d’argent qu’un novice, à salaire égal', () => {
    const cash = (lvl: number) => {
      let t = 0;
      for (const seed of [4400, 4401, 4402]) {
        const s = createWorld(seed);
        const { b } = bakeryOf(s, lvl);
        s.observer = true; b.wage = 4;
        const m0 = totalMoney(s);
        advanceTime(s, 70 * MIN_PER_DAY);
        expect(moneyBalance(m0, s)).toBe(0);
        expect(checkIntegrity(s)).toEqual([]);
        t += b.treasury;
      }
      return t;
    };
    expect(cash(100)).toBeGreaterThan(cash(10) * 1.3);
  }, 60000);
});

describe('Salaires', () => {
  it('le contremaître ne relève pas d’office les salaires d’une affaire du joueur', () => {
    const s = createWorld(1510);
    const { b } = bakeryOf(s, 30);
    b.wage = 4; b.treasury += 0; b.daysInDeficit = 0;
    // une caisse pleine : une affaire de PNJ augmenterait ses gages
    const rich = allBusinesses(s).filter(x => x.id !== b.id && x.kind !== 'manor').sort((x, y) => y.treasury - x.treasury)[0];
    const take = rich.treasury - 10;
    rich.treasury -= take; b.treasury += take;
    weeklyWageReview(s, b);
    expect(b.wage).toBe(4);
  });

  it('une affaire riche ne baisse pas ses gages pour quelques jours d’achats', () => {
    const s = createWorld(1511);
    const b = allBusinesses(s).find(x => x.kind === 'forge')!;
    b.wage = 5; b.daysInDeficit = 6; b.treasury = 5000 + 0; // (argent fictif : on ne fait que tester la règle)
    weeklyWageReview(s, b);
    expect(b.wage).toBeGreaterThanOrEqual(5); // (elle peut même les relever)
  });
});

describe('Commandement et forge', () => {
  it('le commandement renforce les hommes et permet d’en mener davantage', () => {
    const s = createWorld(1520);
    const p = s.characters.player;
    p.skills.commandement = 0;
    const cap0 = retinueCap(p, s);
    expect(commandBonus(p).attack).toBe(0);
    p.skills.commandement = 100;
    expect(commandBonus(p)).toEqual({ attack: 5, defense: 2.5 });
    expect(commandExtra(p)).toBe(4);
    expect(retinueCap(p, s)).toBe(cap0 + 4);
  });

  it('un artisan aguerri forge ses armes au prix du métal', () => {
    const s = createWorld(1521);
    const p = s.characters.player;
    const forge = allBusinesses(s).find(x => x.kind === 'forge')!;
    p.skills.artisanat = 10;
    expect(gearPriceFor(s, forge, 'epee', p)).toBe(gearPrice(s, forge, 'epee'));
    p.skills.artisanat = 50;
    expect(gearPriceFor(s, forge, 'epee', p)).toBeLessThan(gearPrice(s, forge, 'epee'));
  });
});

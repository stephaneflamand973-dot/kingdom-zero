// Phase 10 — armes et armures forgées avec du vrai métal, usure, train de vie.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, allBusinesses, businessesIn, buyGear, checkIntegrity, createWorld, dailyLifestyle, fighterOf, GEAR, gearBonus, gearPrice,
  itemBalance, LIFESTYLES, MIN_PER_DAY, moneyBalance, P, qty, repairCost, repairGear, setLifestyle, totalItems, totalMoney, transferMoney,
  wearGear, type GameState,
} from '../src/engine';

/** Dote le joueur en prenant aux caisses existantes (aucun denier créé). */
function fund(s: GameState, amount: number) {
  const p = s.characters.player;
  for (const b of allBusinesses(s).slice().sort((a, b) => b.treasury - a.treasury)) {
    const take = Math.min(Math.max(0, b.treasury - 60), amount - p.money);
    if (take > 0) transferMoney(s, P.b(b.id), P.c(p.id), take);
  }
  return p;
}
function atForge(s: GameState) {
  const forge = businessesIn(s, 'valcendre').find(b => b.kind === 'forge')!;
  s.characters.player.locationId = forge.locationId;
  return forge;
}

describe('Armes et armures', () => {
  it('une épée se forge avec le métal de la forge : outils consommés, prix payé, attaque en hausse', () => {
    const s = createWorld(1001);
    const p = fund(s, 300);
    const forge = atForge(s);
    forge.stock.tools = Math.max(qty(forge.stock, 'tools'), 3);
    const m0 = totalMoney(s), i0 = totalItems(s);
    const tools0 = qty(forge.stock, 'tools'), cash0 = forge.treasury, atk0 = fighterOf(p).attack;
    const price = gearPrice(s, forge, 'epee');
    const r = buyGear(s, forge.id, 'epee');
    expect(r.ok).toBe(true);
    expect(qty(forge.stock, 'tools')).toBe(tools0 - GEAR.epee.units);
    expect(forge.treasury).toBeGreaterThanOrEqual(cash0 + price - 40); // (la forge a pu dépenser entre-temps : 30 min)
    expect(p.gear?.weapon?.id).toBe('epee');
    expect(fighterOf(p).attack).toBeCloseTo(atk0 + GEAR.epee.attack, 5);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({}); // le métal est comptabilisé comme consommé
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('sans métal en réserve, sans argent ou ailleurs qu’à la forge, pas d’équipement', () => {
    const s = createWorld(1002);
    const p = s.characters.player;
    const forge = atForge(s);
    forge.stock.tools = Math.max(qty(forge.stock, 'tools'), 2);
    expect(buyGear(s, forge.id, 'epee').ok).toBe(false); // sans le sou
    fund(s, 400);
    expect(buyGear(s, forge.id, 'harnois').message).toMatch(/métal/); // six pièces exigées
    p.locationId = 'square';
    expect(buyGear(s, forge.id, 'dague').ok).toBe(false);
    expect(p.gear).toBeUndefined();
  });

  it('l’équipement s’use, se répare, et finit par se briser', () => {
    const s = createWorld(1003);
    const p = fund(s, 400);
    const forge = atForge(s);
    forge.stock.tools = Math.max(qty(forge.stock, 'tools'), 3);
    buyGear(s, forge.id, 'dague'); p.locationId = forge.locationId;
    buyGear(s, forge.id, 'gambison'); p.locationId = forge.locationId;
    for (let i = 0; i < 5; i++) wearGear(s, p, true, true);
    expect(p.gear!.weapon!.wear).toBe(5);
    expect(repairCost(s, forge, p, 'weapon')).toBeGreaterThan(0);
    expect(repairGear(s, forge.id, 'weapon').ok).toBe(true);
    expect(p.gear!.weapon!.wear).toBe(0);
    let broke: string[] = [];
    for (let i = 0; i < GEAR.dague.durability; i++) broke = broke.concat(wearGear(s, p, true, false));
    expect(p.gear!.weapon).toBeUndefined();
    expect(broke.join(' ')).toMatch(/se brise/);
    expect(p.gear!.armor!.id).toBe('gambison'); // l'armure, non touchée, reste
  });

  it('soldats et gardes ont le fourniment de leur maison', () => {
    const s = createWorld(1004);
    const guard = Object.values(s.characters).find(c => c.profession === 'garde' || c.profession === 'soldat')!;
    expect(gearBonus(guard).attack).toBeGreaterThan(0);
    const farmer = Object.values(s.characters).find(c => c.profession === 'fermier')!;
    expect(gearBonus(farmer)).toEqual({ attack: 0, defense: 0 });
  });
});

describe('Train de vie', () => {
  it('la dépense quotidienne va réellement aux commerçants du lieu, et la vie sociale s’en ressent', () => {
    const s = createWorld(1010);
    const p = fund(s, 200);
    p.locationId = 'square';
    setLifestyle(s, 'aise');
    const shops = businessesIn(s, 'valcendre').filter(b => b.kind === 'tavern' || b.kind === 'bakery' || b.kind === 'market');
    const before = shops.reduce((a, b) => a + b.treasury, 0), m0 = totalMoney(s), pm = p.money;
    p.needs.social = 20;
    dailyLifestyle(s);
    expect(pm - p.money).toBe(LIFESTYLES.aise.cost);
    expect(shops.reduce((a, b) => a + b.treasury, 0) - before).toBe(LIFESTYLES.aise.cost);
    expect(p.needs.social).toBe(20 + LIFESTYLES.aise.social);
    expect(totalMoney(s)).toBe(m0);
  });

  it('une bourse vide ramène à la frugalité ; le faste fait gagner l’estime des habitants', () => {
    const s = createWorld(1011);
    const p = s.characters.player;
    setLifestyle(s, 'fastueux');
    dailyLifestyle(s);
    expect(p.lifestyle).toBe('frugal');
    fund(s, 600);
    setLifestyle(s, 'fastueux');
    const sum = () => Object.values(s.characters).reduce((a, c) => a + (c.relations[p.id]?.affinity ?? 0), 0);
    const a0 = sum(), m0 = totalMoney(s);
    for (let d = 0; d < 8; d++) { p.needs.hunger = 20; p.health = 100; s.encounter = undefined; advanceTime(s, MIN_PER_DAY); }
    expect(sum()).toBeGreaterThan(a0);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(checkIntegrity(s)).toEqual([]);
  }, 20000);
});

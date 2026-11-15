// Phase 9 — création du personnage (atouts), foyer du conjoint, enfants du joueur, testament.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, applyHourlyNeeds, businessesIn, checkIntegrity, continueAs, createWorld, designateHeir, gainXp, heirOptions,
  killCharacter, MIN_PER_DAY, minutesUntilHour, modifyRelation, PREGNANCY_DAYS, sleep, sleepOptions, successionCandidates,
  totalMoney, tryForChild, wed, type GameState,
} from '../src/engine';

const evening = (s: GameState) => advanceTime(s, minutesUntilHour(s.time, 20));

describe('Création du personnage', () => {
  it('le nom, le sexe, l’âge et les atouts choisis s’appliquent au joueur et à la lignée', () => {
    const s = createWorld(901, { firstName: '  Ysabeau ', lastName: 'Boisvert', sex: 'F', age: 30, perks: ['pecule', 'fils_d_artisan', 'robuste'] });
    const p = s.characters[s.playerId];
    expect(p.firstName).toBe('Ysabeau');
    expect(p.sex).toBe('F');
    expect(p.age).toBe(30);
    expect(p.perks).toEqual(['pecule', 'fils_d_artisan']); // deux atouts au plus
    expect(p.money).toBe(60);
    expect(p.skills.artisanat).toBe(20);
    expect(s.dynasty.name).toBe('Boisvert');
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('« Esprit vif » fait apprendre deux fois plus vite', () => {
    const a = createWorld(902), b = createWorld(902, { firstName: 'A', lastName: 'B', sex: 'M', age: 24, perks: ['esprit_vif'] });
    const pa = a.characters.player, pb = b.characters.player;
    for (let i = 0; i < 40; i++) { gainXp(a, pa, 'artisanat', 1); gainXp(b, pb, 'artisanat', 1); }
    expect(pb.skills.artisanat - 8).toBeGreaterThanOrEqual((pa.skills.artisanat - 8) * 1.8);
  });

  it('« Robuste » a faim moins vite ; « Beau parleur » se fait aimer plus vite', () => {
    const a = createWorld(903), b = createWorld(903, { firstName: 'A', lastName: 'B', sex: 'M', age: 24, perks: ['robuste', 'beau_parleur'] });
    const pa = a.characters.player, pb = b.characters.player;
    pa.needs.hunger = 20; pb.needs.hunger = 20;
    applyHourlyNeeds(a, pa); applyHourlyNeeds(b, pb);
    expect(pb.needs.hunger).toBeLessThan(pa.needs.hunger);
    const npcA = Object.values(a.characters).find(c => !c.isPlayer)!;
    modifyRelation(a, npcA.id, pa.id, 10, 0);
    modifyRelation(b, npcA.id, pb.id, 10, 0);
    expect(b.characters[npcA.id].relations[pb.id].affinity).toBe(15);
    expect(a.characters[npcA.id].relations[pa.id].affinity).toBe(10);
  });
});

/** Marie le joueur à l'aubergiste, chez qui il louait une chambre. */
function marriedToInnkeeper(seed: number, sex: 'M' | 'F' = 'M') {
  const s = createWorld(seed, { firstName: 'Test', lastName: 'Joueur', sex, age: 25, perks: [] });
  const p = s.characters.player;
  const tavern = businessesIn(s, 'valcendre').find(b => b.kind === 'tavern')!;
  const keeper = s.characters[tavern.ownerId!];
  keeper.sex = sex === 'M' ? 'F' : 'M'; keeper.spouseId = undefined; keeper.age = 26;
  const room = s.properties.find(pr => pr.locationId === tavern.locationId);
  if (room) { room.tenantId = p.id; room.rentDueDay = 5; p.homeId = room.locationId; }
  wed(s, p, keeper);
  return { s, p, keeper, tavern, room };
}

describe('Le foyer du conjoint', () => {
  it('marié à l’aubergiste, on dort au foyer sans louer de chambre', () => {
    const { s, p, keeper, tavern, room } = marriedToInnkeeper(910);
    expect(p.spouseId).toBe(keeper.id);
    if (room) expect(room.tenantId).toBeUndefined(); // la chambre louée est rendue
    p.locationId = tavern.locationId;
    keeper.homeId = tavern.locationId; p.homeId = tavern.locationId;
    evening(s);
    p.locationId = tavern.locationId;
    p.needs.energy = 30;
    const opts = sleepOptions(s);
    expect(opts.some(o => o.mode === 'home' && o.ok)).toBe(true);
    expect(opts.some(o => o.mode === 'inn')).toBe(false); // plus besoin de louer un lit
    const m0 = p.money;
    const r = sleep(s, 'home');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('au foyer');
    expect(p.money).toBe(m0);
  });

  it('chez son conjoint ailleurs qu’à l’auberge, on dort aussi au foyer', () => {
    const s = createWorld(911);
    const p = s.characters.player;
    const spouse = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.sex === 'F' && c.age >= 18 && !c.spouseId && s.locations[c.homeId].kind !== 'square')!;
    wed(s, p, spouse);
    p.locationId = spouse.homeId;
    p.needs.energy = 30;
    expect(sleepOptions(s).some(o => o.mode === 'home' && o.ok)).toBe(true);
  });
});

describe('Avoir des enfants', () => {
  it('il faut être marié, ensemble, le soir, et le ventre plein', () => {
    const s = createWorld(920);
    expect(tryForChild(s).ok).toBe(false); // pas marié
    const { s: s2, p, keeper } = marriedToInnkeeper(921);
    keeper.locationId = 'square'; p.locationId = 'tavern';
    expect(tryForChild(s2).message).toMatch(/pas là/);
    keeper.locationId = p.locationId;
    s2.time += minutesUntilHour(s2.time, 10); s2.processedHours = Math.floor((s2.time + 360) / 60);
    expect(tryForChild(s2).message).toMatch(/soir/);
  });

  it('un couple qui essaie chaque soir attend un enfant, qui naît et rejoint la famille', () => {
    const { s, p, keeper } = marriedToInnkeeper(922);
    const m0 = totalMoney(s), s0In = s.ledger.externalMoneyIn, s0Out = s.ledger.externalMoneyOut;
    let pregnant = false;
    for (let d = 0; d < 20 && !pregnant; d++) {
      evening(s);
      keeper.locationId = p.locationId;
      p.needs.hunger = 20; keeper.needs.hunger = 20;
      tryForChild(s);
      pregnant = keeper.pregnantUntil !== undefined;
      if (!pregnant) advanceTime(s, 4 * 60);
    }
    expect(pregnant).toBe(true);
    expect(keeper.pregnancyFather).toBe(p.id);
    expect(tryForChild(s).ok).toBe(false); // déjà enceinte
    for (let d = 0; d <= PREGNANCY_DAYS + 1 && keeper.pregnantUntil !== undefined; d++) {
      p.needs.hunger = 20; keeper.needs.hunger = 20; p.health = 100; keeper.health = 100;
      if (s.encounter) s.encounter = undefined;
      advanceTime(s, MIN_PER_DAY);
    }
    expect(p.childIds.length).toBeGreaterThanOrEqual(1);
    const child = s.characters[p.childIds[0]];
    expect(child.parentIds).toContain(p.id);
    expect(child.lastName).toBe(p.lastName);
    expect(totalMoney(s) - m0).toBe(s.ledger.externalMoneyIn - s.ledger.externalMoneyOut - (s0In - s0Out));
    expect(checkIntegrity(s)).toEqual([]);
  }, 30000);

  it('une joueuse peut porter l’enfant elle-même', () => {
    const { s, p, keeper } = marriedToInnkeeper(923, 'F');
    let ok = false;
    for (let d = 0; d < 25 && !ok; d++) { evening(s); keeper.locationId = p.locationId; p.needs.hunger = 20; tryForChild(s); ok = p.pregnantUntil !== undefined; if (!ok) advanceTime(s, 4 * 60); }
    expect(ok).toBe(true);
    expect(p.pregnancyFather).toBe(keeper.id);
  });
});

describe('Testament', () => {
  it('l’héritier désigné reçoit les biens et passe en tête des successeurs', () => {
    const s = createWorld(930);
    const p = s.characters.player;
    const friend = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.age >= 20)!;
    expect(designateHeir(s, friend.id).ok).toBe(false); // ni famille ni ami
    friend.relations[p.id] = { affinity: 50, trust: 40, lastInteraction: 0 };
    expect(heirOptions(s).some(c => c.id === friend.id)).toBe(true);
    expect(designateHeir(s, friend.id).ok).toBe(true);
    p.money = 0;
    const owned = businessesIn(s, 'valcendre').find(b => b.kind === 'woodlot')!;
    const prev = s.characters[owned.ownerId!]; owned.ownerId = p.id; if (prev.employerId === owned.id) prev.employerId = undefined;
    const m0 = totalMoney(s);
    expect(successionCandidates(s, p)[0]).toBe(friend.id);
    killCharacter(s, p, 'de vieillesse');
    expect(owned.ownerId).toBe(friend.id);
    expect(s.pendingSuccession?.candidates[0]).toBe(friend.id);
    expect(totalMoney(s)).toBe(m0);
    continueAs(s, friend.id);
    expect(s.dynasty.designatedHeir).toBeUndefined();
    expect(checkIntegrity(s)).toEqual([]);
  });
});

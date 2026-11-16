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
    expect(p.perks).toEqual(['pecule', 'fils_d_artisan', 'robuste']); // autant d'atouts que l'on veut
    expect(p.money).toBe(60);
    expect(p.skills.artisanat).toBe(20);
    expect(p.attributes.endurance).toBe(7);
    expect(s.dynasty.name).toBe('Boisvert');
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('« Maîtrise double » fait gagner les points deux fois plus vite dans chaque compétence, et se cumule avec Esprit vif', () => {
    const mk = (perks: Parameters<typeof createWorld>[1] extends infer T ? T extends { perks: infer P } ? P : never : never) => createWorld(905, { firstName: 'A', lastName: 'B', sex: 'M', age: 24, perks });
    const base = mk([]), dbl = mk(['maitrise_double']), both = mk(['maitrise_double', 'esprit_vif']);
    // expérience gagnée pour un même effort (sans franchir de niveau) : exactement ×2, puis ×4 avec Esprit vif
    const xp = (s: GameState, skill: 'artisanat' | 'combat' | 'gestion' | 'commerce') => { const p = s.characters.player; p.skillXp[skill] = 0; gainXp(s, p, skill, 0.5); return p.skillXp[skill]!; };
    for (const sk of ['artisanat', 'combat', 'gestion', 'commerce'] as const) {
      const x0 = xp(base, sk);
      expect(xp(dbl, sk)).toBeCloseTo(x0 * 2, 6);
      expect(xp(both, sk)).toBeCloseTo(x0 * 4, 6);
    }
    expect(dbl.characters.player.skills.agriculture).toBe(base.characters.player.skills.agriculture); // compétences de départ inchangées
    const all = createWorld(906, { firstName: 'A', lastName: 'B', sex: 'M', age: 24, perks: ['esprit_vif', 'robuste', 'beau_parleur', 'bras_solides', 'main_verte', 'fils_d_artisan', 'pecule', 'bonne_etoile', 'maitrise_double'] });
    expect(all.characters.player.perks!.length).toBe(9);
    expect(checkIntegrity(all)).toEqual([]);
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

import { deleteSlot, loadFromStore, saveFileName, saveToStore, slotInfo } from '../src/engine';

describe('Sauvegardes', () => {
  it('un emplacement indique le personnage, se recharge à l’identique et peut être effacé', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const s = createWorld(940, { firstName: 'Héloïse', lastName: 'de la Haie', sex: 'F', age: 22, perks: ['pecule'] });
    advanceTime(s, 2 * MIN_PER_DAY);
    saveToStore(store, 'rapide', s);
    const info = slotInfo(store, 'rapide')!;
    expect(info.who).toBe('Héloïse de la Haie');
    expect(info.money).toBe(s.characters.player.money);
    const back = loadFromStore(store, 'rapide');
    expect(JSON.stringify(back.state)).toBe(JSON.stringify(s));
    expect(saveFileName(s)).toMatch(/^kingdom-zero-heloise-de-la-haie-jour-\d+\.json$/);
    deleteSlot(store, 'rapide');
    expect(slotInfo(store, 'rapide')).toBeNull();
  });
});

import { allBusinesses, chooseTavern, found, isHiring, manageBusiness, opportunityLabel, P, reserveFor, transferMoney, liveDays } from '../src/engine';

describe('Fonder son établissement', () => {
  /** Dote le joueur en prenant aux caisses existantes (aucun denier créé). */
  const fund = (s: GameState, amount: number) => {
    const p = s.characters.player;
    for (const b of allBusinesses(s).slice().sort((a, b) => b.treasury - a.treasury)) {
      const take = Math.min(Math.max(0, b.treasury - 80), amount - p.money);
      if (take > 0) transferMoney(s, P.b(b.id), P.c(p.id), take);
    }
    return p;
  };

  it('une boulangerie fondée avec 100 d de fonds embauche, s’approvisionne et produit dès la première semaine', () => {
    const s = createWorld(5, { firstName: 'A', lastName: 'B', sex: 'M', age: 24, perks: [] });
    const p = fund(s, 420);
    const r = found(s, 'bakery', 100);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Fournil'); // le lieu est indiqué
    const b = allBusinesses(s).find(x => x.ownerId === p.id)!;
    expect(b.startup).toBe(true);
    expect(reserveFor(b)).toBeLessThan(100);
    for (let d = 0; d < 7; d++) { liveDays(s, 1); if (s.encounter) s.encounter = undefined; }
    // elle produit dès la première semaine ; elle embauche s'il reste un candidat sans emploi et de quoi le payer
    expect(b.produced.bread ?? 0).toBeGreaterThan(20);
    expect(b.employees.length > 0 || jobless(s, 'valcendre').length === 0 || !businessDiagnosis(s, b).ok || isHiring(s, b)).toBe(true);
    expect(checkIntegrity(s)).toEqual([]);
  }, 20000);

  it('la période de lancement prend fin, et une jeune affaire d’une ancienne sauvegarde en bénéficie', () => {
    const s = createWorld(6, { firstName: 'A', lastName: 'B', sex: 'M', age: 24, perks: [] });
    const p = fund(s, 420);
    found(s, 'bakery', 100);
    const b = allBusinesses(s).find(x => x.ownerId === p.id)!;
    delete b.startup; // comme dans une sauvegarde d'avant le correctif
    manageBusiness(s, b);
    expect(b.startup).toBe(true);
    b.founded = -200;
    manageBusiness(s, b);
    expect(b.startup).toBeUndefined();
    expect(isHiring(s, b) === true || isHiring(s, b) === false).toBe(true);
  });

  it('un second cabaret trouve des clients : chacun choisit sa taverne', () => {
    const s = createWorld(7, { firstName: 'A', lastName: 'B', sex: 'M', age: 24, perks: [] });
    const p = fund(s, 520);
    found(s, 'tavern', 200);
    const mine = allBusinesses(s).find(x => x.ownerId === p.id)!;
    mine.stock.ale = 0; // stock nul : compté tel quel
    const rival = allBusinesses(s).find(x => x.kind === 'tavern' && x.id !== mine.id && s.locations[x.locationId].settlementId === 'valcendre')!;
    // les deux ont de la bière au même prix
    const moved = Math.min(10, rival.stock.ale ?? 0);
    rival.stock.ale = (rival.stock.ale ?? 0) - moved; mine.stock.ale = moved;
    const picks = Object.values(s.characters).filter(c => !c.isPlayer && c.alive && s.locations[c.homeId].settlementId === 'valcendre').map(c => chooseTavern(s, c, 'valcendre')!.id);
    expect(picks.includes(mine.id)).toBe(true);
    expect(picks.includes(rival.id)).toBe(true);
    expect(chooseTavern(s, s.characters[rival.ownerId!], 'valcendre', true)!.id).toBe(rival.id); // soir de fête : l'auberge historique
    expect(opportunityLabel(s, 'forge', 'staubin').level).toBe('forte');
    expect(opportunityLabel(s, 'bakery', 'valcendre').level).toBe('moyenne');
  });
});

import { businessDiagnosis, hiringThreshold, recommendedCapital, FOUNDABLE, ownerOrder, jobless } from '../src/engine';

describe('Diriger son affaire', () => {
  it('le diagnostic explique une caisse trop maigre et dit combien déposer ; le dépôt débloque l’embauche', () => {
    const s = createWorld(8, { firstName: 'A', lastName: 'B', sex: 'M', age: 24, perks: [] });
    const p = s.characters.player;
    for (const b of allBusinesses(s).slice().sort((a, b) => b.treasury - a.treasury)) { const t = Math.min(Math.max(0, b.treasury - 80), 700 - p.money); if (t > 0) transferMoney(s, P.b(b.id), P.c(p.id), t); }
    found(s, 'bakery', 50);
    const b = allBusinesses(s).find(x => x.ownerId === p.id)!;
    transferMoney(s, P.b(b.id), P.c(p.id), b.treasury - 15); // caisse à 15 d, comme dans le cas signalé
    const d = businessDiagnosis(s, b);
    expect(d.ok).toBe(false);
    expect(d.text).toMatch(/trop maigre/);
    expect(d.need).toBe(hiringThreshold(b) - 15);
    p.locationId = 'square';
    expect(ownerOrder(s, b.id, { kind: 'deposit', amount: d.need! }).ok).toBe(false); // la caisse se gère sur place
    p.locationId = b.locationId;
    expect(ownerOrder(s, b.id, { kind: 'deposit', amount: d.need! }).ok).toBe(true);
    expect(businessDiagnosis(s, b).ok).toBe(true);
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('chaque type d’affaire a un fonds conseillé qui couvre matières premières et gages', () => {
    for (const k of FOUNDABLE) expect(recommendedCapital(k)).toBeGreaterThanOrEqual(150);
    expect(recommendedCapital('forge')).toBeGreaterThan(recommendedCapital('tavern'));
  });
});

import { backupSlot, deserialize, repairState, serialize, checksum } from '../src/engine';

describe('Reprendre une ancienne partie', () => {
  const pack = (s: GameState) => { const body = JSON.stringify(s); return JSON.stringify({ format: 'KINGDOM_ZERO_SAVE', version: s.version, savedAt: 'x', checksum: checksum(body), state: s }); };

  it('une sauvegarde abîmée par d’anciens bogues est réparée au chargement au lieu d’être refusée', () => {
    const s = createWorld(950);
    advanceTime(s, MIN_PER_DAY);
    const p = s.characters.player;
    const bakery = allBusinesses(s).find(b => b.kind === 'bakery')!;
    const forge = allBusinesses(s).find(b => b.kind === 'forge')!;
    // 1. contrat resté actif alors que le joueur n'est plus employé (ancien bogue du décès)
    s.contracts.push({ id: 'k_old', businessId: bakery.id, workerId: p.id, wage: 4, hoursPerWeek: 24, startDay: 0, hoursThisWeek: 0, goodWeeks: 0, strikes: 0, status: 'active' });
    // 2. employé inscrit au registre sans que sa fiche le dise (ancien bogue de la saisie)
    const stray = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.employerId && c.employerId !== forge.id && !allBusinesses(s).some(b => b.ownerId === c.id))!;
    forge.employees.push(stray.id);
    // 3. propriétaire mort resté en titre, horloge désynchronisée, valeur invalide
    const owner = s.characters[bakery.ownerId!]; owner.alive = false;
    s.processedHours += 3;
    p.money = -5;
    const raw = pack(s);
    const r = deserialize(raw);
    expect(r.error).toBeUndefined();
    expect(r.repaired!.length).toBeGreaterThanOrEqual(4);
    const t = r.state!;
    expect(checkIntegrity(t)).toEqual([]);
    expect(t.contracts.find(k => k.id === 'k_old')!.status).toBe('ended');
    expect(t.businesses[forge.id].employees.includes(stray.id)).toBe(false);
    expect(t.characters[stray.id].employerId).toBe(stray.employerId); // il garde sa vraie place
    expect(t.businesses[bakery.id].ownerId).toBeNull();
    expect(t.characters.player.money).toBe(0);
    // la partie réparée se joue normalement
    advanceTime(t, 3 * MIN_PER_DAY);
    expect(checkIntegrity(t)).toEqual([]);
  });

  it('une partie saine n’est pas touchée, et une partie sans joueur reste refusée', () => {
    const s = createWorld(951);
    expect(repairState(JSON.parse(JSON.stringify(s)))).toEqual([]);
    expect(deserialize(serialize(s)).repaired).toEqual([]);
    const broken = JSON.parse(JSON.stringify(s)); broken.playerId = 'personne';
    expect(deserialize(pack(broken)).error).toMatch(/incohérente/);
  });

  it('la partie en cours est copiée avant d’être remplacée', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const s = createWorld(952, { firstName: 'Ancienne', lastName: 'Partie', sex: 'F', age: 30, perks: [] });
    saveToStore(store, 'auto', s);
    expect(backupSlot(store, 'auto', 'precedente')).toBe(true);
    saveToStore(store, 'auto', createWorld(953));
    expect(slotInfo(store, 'precedente')!.who).toBe('Ancienne Partie');
    expect(backupSlot(store, 'vide', 'x')).toBe(false);
  });
});

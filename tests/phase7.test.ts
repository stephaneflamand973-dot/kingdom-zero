// Phase 7 — requêtes nées de la simulation, rangs sociaux, chronique de la lignée.
import { describe, expect, it } from 'vitest';
import {
  acceptQuest, acceptedQuests, advanceTime, allBusinesses, checkIntegrity, checksum, chronicle, completeQuest, createWorld,
  dailyChronicle, dailyQuests, declineQuest, deserialize, getRelation, MIN_PER_DAY, moveTo, openOffers, qty, questActionsWith, quests,
  SAVE_VERSION, socialRank, totalItems, totalMoney, type GameState, type Quest,
} from '../src/engine';

function addQuest(s: GameState, q: Omit<Quest, 'id' | 'status' | 'offeredDay'>): Quest {
  s.idSeq += 1;
  const quest: Quest = { ...q, id: `q${s.idSeq}`, status: 'offerte', offeredDay: Math.floor((s.time + 360) / MIN_PER_DAY) };
  (s.quests ??= []).push(quest);
  return quest;
}
const day = (s: GameState) => Math.floor((s.time + 360) / MIN_PER_DAY);

describe('Requêtes nées de la simulation', () => {
  it('une pénurie réelle dans un atelier fait naître une requête de livraison', () => {
    const s = createWorld(701);
    const bakery = allBusinesses(s).find(b => b.kind === 'bakery' && b.ownerId)!;
    bakery.lastShortageDay.wood = day(s);
    dailyQuests(s);
    const q = openOffers(s).find(x => x.kind === 'livraison' && x.businessId === bakery.id);
    expect(q).toBeTruthy();
    expect(q!.giverId).toBe(bakery.ownerId);
    expect(q!.item).toBe('wood');
  });

  it('une livraison tenue : les objets et la récompense changent réellement de mains, rien n’est créé', () => {
    const s = createWorld(702);
    const p = s.characters[s.playerId];
    const bakery = allBusinesses(s).find(b => b.kind === 'bakery' && b.ownerId && s.locations[b.locationId].settlementId === 'valcendre')!;
    const owner = s.characters[bakery.ownerId!];
    owner.money = Math.max(owner.money, 60);
    // le joueur obtient 3 fagots d'un autre habitant (transfert, pas de création)
    const woodlot = allBusinesses(s).find(b => b.kind === 'woodlot')!;
    woodlot.stock.wood = Math.max(qty(woodlot.stock, 'wood'), 3);
    woodlot.stock.wood -= 3; p.inventory.wood = (p.inventory.wood ?? 0) + 3;
    const q = addQuest(s, { kind: 'livraison', giverId: owner.id, businessId: bakery.id, item: 'wood', count: 3, reward: 30, deadlineDay: day(s) + 6, text: 'test' });
    expect(acceptQuest(s, q.id).ok).toBe(true);
    const money0 = totalMoney(s), items0 = totalItems(s), pm0 = p.money, stock0 = qty(bakery.stock, 'wood');
    expect(questActionsWith(s, owner.id)[0].ready).toBe(false); // pas sur place
    p.locationId = bakery.locationId;
    const r = completeQuest(s, q.id);
    expect(r.ok).toBe(true);
    expect(qty(bakery.stock, 'wood')).toBe(stock0 + 3);
    expect(p.money - pm0).toBe(30);
    expect(totalMoney(s)).toBe(money0);
    expect(totalItems(s)).toEqual(items0);
    expect(q.status).toBe('reussie');
    expect(getRelation(s, owner.id, p.id).trust).toBeGreaterThan(0);
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('une promesse non tenue à l’échéance abîme la confiance du donneur', () => {
    const s = createWorld(703);
    const giver = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.age >= 20)!;
    const q = addQuest(s, { kind: 'nouvelles', giverId: giver.id, settlementId: 'hautepierre', reward: 10, deadlineDay: day(s) + 1, text: 'test' });
    acceptQuest(s, q.id);
    const trust0 = getRelation(s, giver.id, s.playerId).trust;
    advanceTime(s, 3 * MIN_PER_DAY);
    expect(q.status).toBe('echouee');
    expect(getRelation(s, giver.id, s.playerId).trust).toBeLessThan(trust0);
    expect((s.chronicle ?? []).some(c => c.text.includes('manque à sa parole'))).toBe(true);
  });

  it('les nouvelles exigent un vrai voyage après la promesse', () => {
    const s = createWorld(704);
    const p = s.characters[s.playerId];
    const giver = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.age >= 20 && s.locations[c.homeId].settlementId === 'valcendre')!;
    giver.money = Math.max(giver.money, 20);
    const q = addQuest(s, { kind: 'nouvelles', giverId: giver.id, settlementId: 'staubin', reward: 12, deadlineDay: day(s) + 12, text: 'test' });
    acceptQuest(s, q.id);
    p.locationId = giver.locationId;
    expect(completeQuest(s, q.id).ok).toBe(false); // pas encore allé à Saint-Aubin
    moveTo(s, s.settlements.staubin.squareId);
    while (s.encounter) { s.encounter = undefined; }
    advanceTime(s, 60);
    expect(s.priceBook.staubin.day).toBeGreaterThanOrEqual(day(s) - 1);
    p.locationId = giver.locationId;
    giver.locationId = p.locationId;
    const r = completeQuest(s, q.id);
    expect(r.ok).toBe(true);
    expect(Object.keys(s.tradeMemory).some(k => k.startsWith(`${giver.id}:staubin:`))).toBe(true);
  });

  it('une réconciliation rapproche réellement les deux brouillés', () => {
    const s = createWorld(705);
    const p = s.characters[s.playerId];
    const [a, b] = Object.values(s.characters).filter(c => !c.isPlayer && c.alive && c.age >= 20);
    a.relations[b.id] = { affinity: -40, trust: -20, lastInteraction: 0 };
    b.relations[a.id] = { affinity: -40, trust: -20, lastInteraction: 0 };
    const q = addQuest(s, { kind: 'reconciliation', giverId: a.id, targetId: b.id, reward: 0, deadlineDay: day(s) + 10, text: 'test' });
    acceptQuest(s, q.id);
    b.locationId = p.locationId;
    expect(completeQuest(s, q.id).ok).toBe(true);
    expect(getRelation(s, b.id, a.id).affinity).toBeGreaterThan(-40);
    expect(getRelation(s, a.id, b.id).affinity).toBeGreaterThan(-40);
  });

  it('pas plus de trois engagements à la fois ; décliner est sans conséquence', () => {
    const s = createWorld(706);
    const givers = Object.values(s.characters).filter(c => !c.isPlayer && c.alive && c.age >= 20).slice(0, 5);
    const qs = givers.map(g => addQuest(s, { kind: 'nouvelles', giverId: g.id, settlementId: 'staubin', reward: 5, deadlineDay: day(s) + 9, text: 't' }));
    expect(acceptQuest(s, qs[0].id).ok && acceptQuest(s, qs[1].id).ok && acceptQuest(s, qs[2].id).ok).toBe(true);
    expect(acceptQuest(s, qs[3].id).ok).toBe(false);
    const trust0 = getRelation(s, givers[4].id, s.playerId).trust;
    expect(declineQuest(s, qs[4].id).ok).toBe(true);
    expect(getRelation(s, givers[4].id, s.playerId).trust).toBe(trust0);
    expect(acceptedQuests(s).length).toBe(3);
  });

  it('en vivant quelques semaines, des requêtes de plusieurs types apparaissent d’elles-mêmes', () => {
    const s = createWorld(2);
    for (let i = 0; i < 40; i++) advanceTime(s, MIN_PER_DAY);
    const kinds = new Set(quests(s).map(q => q.kind));
    expect(quests(s).length).toBeGreaterThanOrEqual(3);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  }, 20000);
});

describe('Rangs et chronique', () => {
  it('le rang social se calcule sur l’état réel et la chronique ne retient que les rangs atteints pour la première fois', () => {
    const s = createWorld(710);
    const p = s.characters[s.playerId];
    expect(socialRank(s).name).toBe('Vagabond'); // on arrive sans un denier
    p.money = 0; p.employerId = undefined;
    dailyChronicle(s);
    expect(socialRank(s).level).toBe(0);
    const biz = allBusinesses(s).find(b => b.kind === 'woodlot')!;
    const old = s.characters[biz.ownerId!];
    biz.ownerId = p.id; if (old.employerId === biz.id) old.employerId = undefined;
    dailyChronicle(s);
    expect(socialRank(s).level).toBeGreaterThanOrEqual(3);
    expect((s.chronicle ?? []).filter(c => c.text.includes('devient')).length).toBe(1);
    biz.ownerId = old.id;
    dailyChronicle(s);
    expect((s.chronicle ?? []).filter(c => c.text.includes('redescend')).length).toBe(0);
    chronicle(s, 'Fait mémorable');
    expect(s.chronicle!.at(-1)!.text).toBe('Fait mémorable');
  });

  it('une sauvegarde v7 est migrée en v8 (requêtes et chronique initialisées)', () => {
    const s = createWorld(711);
    const v7 = JSON.parse(JSON.stringify(s));
    delete v7.quests; delete v7.chronicle; delete v7.chronicleSeq; delete v7.playerRank;
    v7.version = 7;
    const body = JSON.stringify(v7);
    const r = deserialize(JSON.stringify({ format: 'KINGDOM_ZERO_SAVE', version: 7, savedAt: 'x', checksum: checksum(body), state: v7 }));
    expect(r.error).toBeUndefined();
    expect(SAVE_VERSION).toBe(8);
    expect(r.state!.quests).toEqual([]);
    expect(r.state!.chronicle).toEqual([]);
  });
});

import { canWork, encounterAction, liveDays, talk, wait, work, buy, eat, forage, checkIntegrity as integ, moneyBalance, itemBalance } from '../src/engine';
import { mulberry } from './util';

describe('Stabilité avec les requêtes (fuzz)', () => {
  for (const seed of [21, 22]) {
    it(`graine ${seed} : 250 actions au hasard dont accepter et accomplir des requêtes`, () => {
      const s = createWorld(seed);
      const m0 = totalMoney(s), i0 = totalItems(s);
      const r = mulberry(seed);
      const pk = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
      for (let i = 0; i < 250 && !s.gameOver; i++) {
        if (s.pendingSuccession) { s.pendingSuccession = undefined; break; }
        if (s.encounter) { encounterAction(s, 'surrender'); continue; }
        const p = s.characters[s.playerId];
        const here = Object.values(s.businesses).filter(b => b.locationId === p.locationId);
        const npcsHere = Object.values(s.characters).filter(c => c.alive && !c.isPlayer && c.locationId === p.locationId);
        switch (Math.floor(r() * 10)) {
          case 0: moveTo(s, pk(s.locationOrder)); break;
          case 1: { const b = here.find(x => canWork(s, x, p).ok); if (b) work(s, b.id, 3); else wait(s, 60); break; }
          case 2: if (here.length) buy(s, pk(here).id, pk(['bread', 'wood', 'grain'] as const), 2); break;
          case 3: eat(s); break;
          case 4: { const o = openOffers(s); if (o.length) acceptQuest(s, pk(o).id); break; }
          case 5: for (const n of npcsHere) for (const a of questActionsWith(s, n.id)) if (a.ready) completeQuest(s, a.quest.id); break;
          case 6: if (npcsHere.length) talk(s, pk(npcsHere).id, 'chat'); break;
          case 7: forage(s, 2); break;
          case 8: if (r() < 0.3) liveDays(s, 2); break;
          default: { const q = acceptedQuests(s)[0]; const t = q && (q.targetId ?? q.giverId); if (t) p.locationId = s.characters[t].locationId; else wait(s, 120); }
        }
      }
      expect(integ(s)).toEqual([]);
      expect(moneyBalance(m0, s)).toBe(0);
      expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    }, 30000);
  }
});

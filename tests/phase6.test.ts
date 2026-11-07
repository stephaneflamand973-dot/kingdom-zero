// Phase 6 — polissage : aléas du monde, initiatives des PNJ, stabilité (fuzz), équilibrage d'un joueur débutant, migration v6.
import { describe, expect, it } from 'vitest';
import {
  activeIncidents, advanceTime, allBusinesses, askPrice, buy, burn, canWork, checkIntegrity, checksum, continueAs, createLoan, loanTerms,
  createWorld, dailyIncidents, deserialize, eat, encounterAction, epidemicFactor, forage, incidentYield, itemBalance, liveDays,
  MIN_PER_DAY, moneyBalance, moveTo, npcApproaches, qty, SAVE_VERSION, serialize, sleep, sleepOptions, talk, totalItems,
  logEvent, totalMoney, train, wait, work, transferMoney, transferBusiness, hireBest, P, settleEstate, minutesUntilHour, grainConvoy, businessesIn, residents, type EncounterChoice, type GameState, type TalkKind,
} from '../src/engine';
import { mulberry } from './util';

function startIncident(s: GameState, sid: string, kind: 'secheresse' | 'recolte' | 'foire' | 'epidemie', days = 5) {
  const day = Math.floor((s.time + 360) / MIN_PER_DAY);
  s.incidents = [...(s.incidents ?? []), { id: `t_${kind}`, kind, settlementId: sid, fromDay: day, toDay: day + days }];
}

describe('Aléas du monde', () => {
  it('la sécheresse réduit réellement le rendement des fermes, la belle récolte l’augmente', () => {
    const s = createWorld(601);
    const farm = allBusinesses(s).find(b => b.kind === 'farm')!;
    const sid = s.locations[farm.locationId].settlementId;
    expect(incidentYield(s, farm)).toBe(1);
    startIncident(s, sid, 'secheresse');
    expect(incidentYield(s, farm)).toBeLessThan(0.6);
    s.incidents = [];
    startIncident(s, sid, 'recolte');
    expect(incidentYield(s, farm)).toBeGreaterThan(1.3);
  });

  it('la foire fait baisser les prix et l’épidémie multiplie le risque de maladie', () => {
    const s = createWorld(602);
    const bakery = allBusinesses(s).find(b => b.kind === 'bakery')!;
    const sid = s.locations[bakery.locationId].settlementId;
    bakery.stock.bread = 20;
    const before = askPrice(s, bakery, 'bread');
    startIncident(s, sid, 'foire');
    expect(askPrice(s, bakery, 'bread')).toBeLessThanOrEqual(before);
    expect(epidemicFactor(s, sid)).toBe(1);
    startIncident(s, sid, 'epidemie');
    expect(epidemicFactor(s, sid)).toBe(5);
  });

  it('un incendie détruit des stocks sans casser la conservation des objets', () => {
    const s = createWorld(603);
    s.observer = true;
    const b = allBusinesses(s).find(x => x.kind === 'bakery')!;
    b.stock.grain = 40;
    const items0 = totalItems(s), money0 = totalMoney(s);
    const before = qty(b.stock, 'grain');
    const lost = burn(s, s.locations[b.locationId].settlementId, b);
    expect(lost).toBeGreaterThan(0);
    expect(qty(b.stock, 'grain')).toBeLessThan(before);
    expect(activeIncidents(s).some(i => i.kind === 'incendie')).toBe(true);
    expect(s.events.at(-1)!.text).toContain('feu');
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(money0, s)).toBe(0);
    // la perte est bien enregistrée comme consommée
    expect(s.ledger.consumed.grain ?? 0).toBeGreaterThan(0);
    expect(itemBalance(items0, s, totalItems(s))).toEqual({});
  });

  it('les aléas sont déterministes pour une même graine et surviennent réellement sur une année', () => {
    const run = () => {
      const s = createWorld(604); s.observer = true;
      const seen = new Map<string, string>();
      for (let d = 0; d < 112; d++) { advanceTime(s, MIN_PER_DAY); for (const i of s.incidents ?? []) seen.set(i.id, `${i.kind}@${i.settlementId}:${i.fromDay}`); }
      return [...seen.values()];
    };
    const a = run(), b = run();
    expect(a).toEqual(b);
    expect(a.some(x => x.startsWith('foire'))).toBe(true); // chaque localité tient sa foire annuelle
    expect(a.length).toBeGreaterThanOrEqual(3);
  });

  it('dailyIncidents purge les aléas expirés', () => {
    const s = createWorld(605);
    s.incidents = [{ id: 'old', kind: 'secheresse', settlementId: 'valcendre', fromDay: -20, toDay: -10 }];
    dailyIncidents(s);
    expect(s.incidents.some(i => i.id === 'old')).toBe(false);
  });
});

describe('Initiatives des PNJ', () => {
  it('un ami partage son pain avec le joueur affamé (objet réellement transféré)', () => {
    const s = createWorld(611);
    const p = s.characters[s.playerId];
    const friend = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.age >= 18 && c.locationId === p.locationId)
      ?? Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.age >= 18)!;
    friend.locationId = p.locationId;
    friend.activity = { kind: 'idle', locationId: p.locationId, since: s.time, note: 'Flâne' };
    for (const c of Object.values(s.characters)) if (c.id !== friend.id && !c.isPlayer) c.locationId = c.homeId;
    friend.relations[p.id] = { affinity: 60, trust: 40, lastInteraction: 0 };
    friend.inventory.bread = 5;
    p.inventory = {}; p.needs.hunger = 80;
    const items0 = totalItems(s);
    let text: string | undefined;
    for (let i = 0; i < 40 && !text; i++) { s.lastApproach = undefined; text = npcApproaches(s); }
    expect(text).toContain('miche');
    expect(qty(p.inventory, 'bread')).toBe(1);
    expect(qty(friend.inventory, 'bread')).toBe(4);
    expect(totalItems(s)).toEqual(items0);
    // délai de grâce : pas de nouvelle initiative avant quatre heures
    expect(npcApproaches(s)).toBeUndefined();
  });

  it('un créancier relance le joueur qui a manqué une échéance', () => {
    const s = createWorld(612);
    const p = s.characters[s.playerId];
    const lender = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.age >= 25)!;
    for (const c of Object.values(s.characters)) if (!c.isPlayer) c.locationId = c.homeId;
    lender.locationId = p.locationId;
    lender.activity = { kind: 'idle', locationId: p.locationId, since: s.time, note: 'Flâne' };
    lender.money += 50;
    const terms = loanTerms(s, lender, p, 30);
    const loan = createLoan(s, lender, p, { ...terms, ok: true }, 'test')!;
    expect(loan).toBeTruthy();
    loan.missed = 1;
    let text: string | undefined;
    for (let i = 0; i < 40 && !text; i++) { s.lastApproach = undefined; text = npcApproaches(s); }
    expect(text).toMatch(/échéance/);
  });
});

/** Joue des actions au hasard, valides ou non : le moteur ne doit ni planter ni perdre un denier. */
function fuzz(seed: number, steps: number) {
  const s = createWorld(seed);
  const money0 = totalMoney(s), items0 = totalItems(s);
  const r = mulberry(seed * 7 + 1);
  const pickOf = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
  const talks: TalkKind[] = ['chat', 'news', 'compliment', 'gift_bread', 'gift_coins', 'ask_help', 'insult'];
  const choices: EncounterChoice[] = ['fight', 'flee', 'pay', 'parley', 'surrender'];
  for (let i = 0; i < steps; i++) {
    if (s.gameOver) break;
    if (s.pendingSuccession) { continueAs(s, s.pendingSuccession.candidates[0]); continue; }
    if (s.encounter) { encounterAction(s, pickOf(choices)); continue; }
    const p = s.characters[s.playerId];
    const here = Object.values(s.businesses).filter(b => b.locationId === p.locationId);
    const roll = Math.floor(r() * 12);
    switch (roll) {
      case 0: moveTo(s, pickOf(s.locationOrder)); break;
      case 1: { const b = here.find(x => canWork(s, x, p).ok); if (b) work(s, b.id, 1 + Math.floor(r() * 4)); else wait(s, 30); break; }
      case 2: if (here.length) buy(s, pickOf(here).id, pickOf(['bread', 'grain', 'ale', 'wood'] as const), 1); break;
      case 3: eat(s); break;
      case 4: { const o = sleepOptions(s).filter(x => x.ok); if (o.length) sleep(s, pickOf(o).mode); break; }
      case 5: { const n = Object.values(s.characters).filter(c => c.alive && !c.isPlayer && c.locationId === p.locationId); if (n.length) talk(s, pickOf(n).id, pickOf(talks)); break; }
      case 6: wait(s, 60 * (1 + Math.floor(r() * 6))); break;
      case 7: forage(s, 2); break;
      case 8: train(s); break;
      case 9: if (r() < 0.2) liveDays(s, 2); break;
      default: moveTo(s, s.settlements[pickOf(s.settlementOrder)].squareId); break;
    }
  }
  return { s, money0, items0 };
}

describe('Stabilité (fuzz)', () => {
  for (const seed of [11, 22, 33, 44]) {
    it(`graine ${seed} : 300 actions au hasard, aucune erreur ni fuite`, () => {
      const { s, money0, items0 } = fuzz(seed, 300);
      expect(checkIntegrity(s)).toEqual([]);
      expect(moneyBalance(money0, s)).toBe(0);
      expect(itemBalance(items0, s, totalItems(s))).toEqual({});
      // la sauvegarde reste fidèle après ce chaos
      const back = deserialize(serialize(s));
      expect(back.error).toBeUndefined();
      expect(JSON.stringify(back.state)).toBe(JSON.stringify(s));
    }, 30000);
  }
});

describe('Équilibrage', () => {
  it('un débutant qui « vit au jour le jour » survit à sa première saison dans la plupart des mondes', () => {
    let alive = 0;
    const seeds = [701, 702, 703, 704, 705];
    for (const seed of seeds) {
      const s = createWorld(seed);
      for (let k = 0; k < 6 && !s.gameOver && !s.pendingSuccession; k++) {
        if (s.encounter) encounterAction(s, 'pay');
        if (s.encounter) encounterAction(s, 'surrender');
        liveDays(s, 5);
      }
      const p = s.characters[s.playerId];
      if (p.alive && !s.pendingSuccession) alive++;
    }
    expect(alive).toBeGreaterThanOrEqual(4);
  }, 60000);
});

describe('Sauvegarde v6', () => {
  it('une sauvegarde v5 est migrée (aléas initialisés) et reste intègre', () => {
    const s = createWorld(620);
    advanceTime(s, 2 * MIN_PER_DAY);
    const v5 = JSON.parse(JSON.stringify(s));
    delete v5.incidents; delete v5.lastApproach;
    v5.version = 5;
    const body = JSON.stringify(v5);
    const r = deserialize(JSON.stringify({ format: 'KINGDOM_ZERO_SAVE', version: 5, savedAt: 'x', checksum: checksum(body), state: v5 }));
    expect(r.error).toBeUndefined();
    expect(r.state!.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(6);
    expect(Array.isArray(r.state!.incidents)).toBe(true);
  });
});

describe('Notifications de l’interface', () => {
  it('ne retient que les faits nouveaux qui concernent le joueur (acteur, cible ou témoin)', async () => {
    const { notableFor } = await import('../src/ui/useGame');
    const s = createWorld(630);
    const seq0 = s.eventSeq;
    const p = s.characters[s.playerId];
    const other = Object.values(s.characters).find(c => !c.isPlayer && c.alive)!;
    logEvent(s, { type: 'theft', actorId: other.id, importance: 2, text: 'vol lointain', witnesses: [] });
    logEvent(s, { type: 'approach', actorId: other.id, targetId: p.id, importance: 2, text: 'on m’aborde', witnesses: [] });
    logEvent(s, { type: 'incident', importance: 3, text: 'épidémie vue', witnesses: [p.id] });
    logEvent(s, { type: 'work', actorId: p.id, importance: 1, text: 'routine', witnesses: [] });
    const got = notableFor(s, seq0).map(e => e.text);
    expect(got).toEqual(['épidémie vue', 'on m’aborde']);
  });
});

describe('Équilibrage économique (phase 6)', () => {
  it('un transfert vers soi-même ne crée pas d’argent', () => {
    const s = createWorld(640);
    const m0 = totalMoney(s);
    const b = allBusinesses(s)[0];
    expect(transferMoney(s, P.b(b.id), P.b(b.id), Math.min(10, b.treasury))).toBe(true);
    expect(totalMoney(s)).toBe(m0);
  });

  it('l’héritier qui devait de l’argent au défunt voit sa dette s’éteindre (pas de prêt à soi-même)', () => {
    const s = createWorld(641);
    s.observer = true;
    const parent = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.childIds.some(k => s.characters[k]?.alive && s.characters[k].age >= 16))
      ?? Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.spouseId)!;
    const heir = s.characters[parent.childIds.find(k => s.characters[k]?.alive && s.characters[k].age >= 16) ?? parent.spouseId!];
    const terms = loanTerms(s, parent, heir, 20);
    const loan = createLoan(s, parent, heir, { ...terms, ok: true }, 'test');
    if (!loan) return; // pas assez d'argent dans ce monde : rien à vérifier
    const m0 = totalMoney(s);
    settleEstate(s, parent);
    expect(loan.lenderId === heir.id && loan.status === 'active').toBe(false);
    expect(totalMoney(s)).toBe(m0);
  });

  it('en pleine disette, les affamés cueillent racines et baies (vivres réellement produits)', () => {
    const s = createWorld(642);
    s.observer = true;
    // plus rien à vendre nulle part dans la localité
    for (const b of allBusinesses(s)) { delete b.stock.bread; delete b.stock.grain; }
    const c = Object.values(s.characters).find(x => !x.isPlayer && x.alive && x.age >= 20 && s.locations[x.homeId].settlementId === 'valcendre')!;
    c.inventory = {}; c.money = 0; c.needs.hunger = 80; c.needs.energy = 80;
    c.relations = {};
    s.time += minutesUntilHour(s.time, 9);
    const prod0 = s.ledger.produced.grain ?? 0;
    for (let h = 0; h < 8 && c.activity.kind !== 'forage'; h++) advanceTime(s, 60);
    expect(c.activity.kind).toBe('forage');
    expect(c.activity.item).toBe('grain');
    advanceTime(s, 6 * 60);
    expect((s.ledger.produced.grain ?? 0)).toBeGreaterThan(prod0);
  });

  it('le convoi d’urgence n’achète qu’à une localité bien pourvue, argent et grain changent de mains', () => {
    const s = createWorld(643);
    s.observer = true;
    for (const b of businessesIn(s, 'hautepierre')) { delete b.stock.bread; delete b.stock.grain; }
    for (const c of residents(s, 'hautepierre')) { c.needs.hunger = 70; delete c.inventory.bread; delete c.inventory.grain; }
    const farm = businessesIn(s, 'staubin').find(b => b.kind === 'farm')!;
    farm.stock.grain = 400; // Saint-Aubin regorge de grain
    const m0 = totalMoney(s), i0 = totalItems(s);
    const n = grainConvoy(s, 'hautepierre');
    expect(n).toBeGreaterThan(0);
    const market = businessesIn(s, 'hautepierre').find(b => b.kind === 'market')!;
    expect(qty(market.stock, 'grain')).toBe(n);
    expect(totalMoney(s)).toBe(m0);
    expect(totalItems(s)).toEqual(i0);
    // pas deux convois coup sur coup
    expect(grainConvoy(s, 'hautepierre')).toBe(0);
  });
});

describe('Cohérence des emplois (phase 6)', () => {
  it('un propriétaire saisi qui travaille ailleurs garde son emploi extérieur', () => {
    const s = createWorld(650);
    const shop = allBusinesses(s).find(b => b.kind === 'market' && b.ownerId)!;
    const owner = s.characters[shop.ownerId!];
    const other = allBusinesses(s).find(b => b.kind === 'bakery' && b.id !== shop.id && s.locations[b.locationId].settlementId === s.locations[shop.locationId].settlementId)!;
    // le propriétaire travaille comme salarié dans une autre affaire
    shop.employees = shop.employees.filter(id => id !== owner.id);
    owner.employerId = other.id; other.employees.push(owner.id);
    const buyer = Object.values(s.characters).find(c => !c.isPlayer && c.alive && c.age >= 20 && c.id !== owner.id && !allBusinesses(s).some(b => b.ownerId === c.id))!;
    if (buyer.employerId) { const b = s.businesses[buyer.employerId]; b.employees = b.employees.filter(id => id !== buyer.id); buyer.employerId = undefined; }
    transferBusiness(s, shop, buyer, owner);
    expect(owner.employerId).toBe(other.id);
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('les arriérés d’un ancien employeur ne font pas démissionner du nouvel emploi', () => {
    const s = createWorld(651);
    s.observer = true;
    const c = Object.values(s.characters).find(x => !x.isPlayer && x.alive && !x.employerId && x.age >= 18 && x.age < 60)!;
    c.unpaidWages = 200;
    const manor = s.businesses[s.settlements[s.locations[c.homeId].settlementId].manorId];
    const hired = hireBest(s, manor, [c]);
    expect(hired?.id).toBe(c.id);
    expect(c.unpaidWages).toBe(0);
  });
});

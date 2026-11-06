// Scénarios de validation obligatoires (A–G) + invariants du monde.
import { describe, expect, it } from 'vitest';
import {
  advanceTime, buy, checkIntegrity, createWorld, deserialize, eat, getRelation, HUNGER_PER_HOUR, itemBalance,
  MIN_PER_DAY, moneyBalance, moveTo, priceForCharacter, runProduction, serialize, talk, totalItems, totalMoney,
  wait, work, minutesUntilHour, toDate, sell, steal, sleep, canWork, forage,
} from '../src/engine';
import type { GameState } from '../src/engine';

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

describe('Test A — Économie : travailler, être payé, acheter', () => {
  it('le salaire est transféré de la caisse au joueur, puis l’achat est cohérent', () => {
    const s = createWorld(1);
    const p = s.characters.player;
    const farm = s.businesses.b_farm;
    const m0 = totalMoney(s);
    expect(p.money).toBe(0);
    expect(moveTo(s, 'farm').ok).toBe(true);
    const offer = canWork(s, farm, p);
    expect(offer.ok, offer.reason).toBe(true);
    const r = work(s, 'b_farm', 4);
    expect(r.ok, r.message).toBe(true);
    expect(p.money).toBe(offer.wage * 4);         // salaire exact : 4 heures payées
    expect(p.unpaidWages).toBe(0);
    expect(totalMoney(s)).toBe(m0);                // l'argent n'a pas été créé
    expect(farm.produced.grain ?? 0).toBeGreaterThan(0);

    // aller acheter du pain (sans franchir d'heure pour une vérification exacte)
    expect(moveTo(s, 'bakery').ok).toBe(true);
    if (toDate(s.time).minute > 50) wait(s, 15);
    const bakery = s.businesses.b_bakery;
    const price = priceForCharacter(s, bakery, p, 'bread', 'buy');
    const money = p.money, bread = p.inventory.bread ?? 0, stock = bakery.stock.bread ?? 0, till = bakery.treasury;
    const rb = buy(s, 'b_bakery', 'bread', 1);
    expect(rb.ok, rb.message).toBe(true);
    expect(p.money).toBe(money - price);
    expect(p.inventory.bread).toBe(bread + 1);
    expect(bakery.stock.bread).toBe(stock - 1);
    expect(bakery.treasury).toBe(till + price);
    expect(totalMoney(s)).toBe(m0);
  });

  it('acheter sans argent est refusé sans aucun effet', () => {
    const s = createWorld(1);
    moveTo(s, 'bakery');
    const before = JSON.stringify(s);
    const r = buy(s, 'b_bakery', 'bread', 1);
    expect(r.ok).toBe(false);
    expect(r.minutes).toBe(0);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('Test B — Autonomie du monde', () => {
  it('pendant que le joueur attend, les PNJ agissent réellement', () => {
    const s = createWorld(2);
    const snap = clone(s);
    for (let i = 0; i < 3; i++) wait(s, 12 * 60); // 36 heures
    expect(s.stats.npcActions).toBeGreaterThan(300);
    expect(s.stats.trades).toBeGreaterThan(10);
    expect(s.ledger.produced.bread ?? 0).toBeGreaterThan(0);
    expect(s.ledger.consumed.bread ?? 0).toBeGreaterThan(0);
    let changed = 0;
    for (const id of s.characterOrder) {
      const a = snap.characters[id], b = s.characters[id];
      if (!a || b.isPlayer) continue;
      if (a.money !== b.money || JSON.stringify(a.inventory) !== JSON.stringify(b.inventory)) changed++;
      // chaque activité porte une raison lisible issue de la décision
      expect(b.activity.note && b.activity.note.length).toBeTruthy();
    }
    expect(changed).toBeGreaterThan(10);
    // les événements notables ont une cause identifiable (entreprise, acteur ou témoins)
    for (const e of s.events.filter(e => e.importance >= 2)) {
      expect(e.businessId || e.actorId || e.witnesses.length).toBeTruthy();
    }
  });

  it('les entreprises s’approvisionnent auprès d’autres entreprises', () => {
    const s = createWorld(3);
    s.observer = true;
    advanceTime(s, 3 * MIN_PER_DAY);
    const b2b = s.events.filter(e => e.type === 'trade' && e.businessId && e.data?.seller);
    expect(b2b.length).toBeGreaterThan(0);
  });
});

describe('Test C — Relations', () => {
  it('insulter le forgeron dégrade la relation et entraîne un refus de vente ultérieur', () => {
    const s = createWorld(4);
    moveTo(s, 'forge');
    wait(s, minutesUntilHour(s.time, 9));
    const aldric = s.characters.aldric;
    expect(aldric.locationId).toBe('forge');
    const r0 = getRelation(s, 'aldric', 'player');
    const r = talk(s, 'aldric', 'insult');
    expect(r.ok).toBe(true);
    const r1 = getRelation(s, 'aldric', 'player');
    expect(r1.affinity).toBeLessThan(r0.affinity);
    expect(r1.trust).toBeLessThan(r0.trust);
    // insultes répétées → refus de commercer avec une raison issue de l'état
    for (let i = 0; i < 3 && s.characters.player.alive; i++) talk(s, 'aldric', 'insult');
    s.characters.player.money = 0; // pas d'effet de bord : on vérifie le refus avant la question d'argent
    const rb = buy(s, 'b_forge', 'tools', 1);
    expect(rb.ok).toBe(false);
    expect(rb.message).toMatch(/Aldric Ferrand refuse/);
    expect(rb.message).toMatch(/insult/);
  });

  it('une bonne relation améliore les prix, une mauvaise les dégrade', () => {
    const s = createWorld(5);
    const p = s.characters.player;
    const forge = s.businesses.b_forge;
    const priceWith = (affinity: number) => {
      s.characters.aldric.relations.player = { affinity, trust: 0, lastInteraction: 0 };
      return priceForCharacter(s, forge, p, 'tools', 'buy');
    };
    const friend = priceWith(80), neutral = priceWith(0), rival = priceWith(-50);
    expect(friend).toBeLessThan(neutral);
    expect(neutral).toBeLessThan(rival);
  });

  it('les rumeurs propagent un vol vers des PNJ qui n’en ont pas été témoins', () => {
    const s = createWorld(6);
    moveTo(s, 'bakery');
    wait(s, minutesUntilHour(s.time, 9));
    s.characters.player.skills.discretion = 0;
    s.characters.player.attributes.agilite = 1;
    let caught;
    for (let i = 0; i < 12 && !caught; i++) {
      const r = steal(s, 'b_bakery', 'bread');
      if (r.message.startsWith('Pris')) caught = r.eventIds![0];
    }
    expect(caught).toBeTruthy();
    const knowersAt = s.characterOrder.filter(id => s.characters[id].knownEvents.includes(caught!)).length;
    s.observer = true;
    advanceTime(s, 4 * MIN_PER_DAY);
    const knowersLater = s.characterOrder.filter(id => s.characters[id].knownEvents.includes(caught!)).length;
    expect(knowersLater).toBeGreaterThan(knowersAt);
  });
});

describe('Test D — Ressources', () => {
  it('une recette consomme exactement ses intrants et produit ses extrants', () => {
    const s = createWorld(7);
    const b = s.businesses.b_bakery;
    b.stock = { grain: 4, wood: 1 };
    b.laborPool = 6.5; // assez pour 2 lots, mais le bois ne suffit que pour 1
    const n = runProduction(s, b);
    expect(n).toBe(1);
    expect(b.stock).toEqual({ grain: 2, bread: 10 });
    // le 2e lot faute de bois est refusé et la pénurie journalisée (une seule fois par jour)
    const shortageCount = () => s.events.filter(e => e.type === 'shortage' && e.businessId === b.id).length;
    expect(shortageCount()).toBe(1);
    expect(runProduction(s, b)).toBe(0);
    expect(b.stock.bread).toBe(10);
    expect(b.stock.grain).toBe(2);
    expect(shortageCount()).toBe(1);
  });

  it('manger consomme le pain ; sans pain l’action est refusée', () => {
    const s = createWorld(8);
    const p = s.characters.player;
    expect(p.inventory.bread).toBe(1);
    const h0 = p.needs.hunger;
    expect(eat(s).ok).toBe(true);
    expect(p.inventory.bread ?? 0).toBe(0);
    expect(p.needs.hunger).toBeLessThan(h0);
    const r = eat(s);
    expect(r.ok).toBe(false);
    expect(r.minutes).toBe(0);
  });

  it('ramasser du bois produit des fagots tracés dans le bilan matière', () => {
    const s = createWorld(16);
    const i0 = totalItems(s);
    moveTo(s, 'woodlot');
    wait(s, minutesUntilHour(s.time, 8));
    const r = forage(s, 3);
    expect(r.ok, r.message).toBe(true);
    expect(s.characters.player.inventory.wood ?? 0).toBeGreaterThan(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    expect(forage(s, 1).ok || true).toBe(true);
    moveTo(s, 'square');
    expect(forage(s, 1).ok).toBe(false);
  });

  it('vendre plus que ce que l’on possède est refusé', () => {
    const s = createWorld(9);
    moveTo(s, 'market');
    wait(s, minutesUntilHour(s.time, 9));
    const r = sell(s, 'b_market', 'wood', 3);
    expect(r.ok).toBe(false);
  });
});

describe('Test E — Sauvegarde', () => {
  it('sauvegarder puis recharger restitue exactement l’état, et la suite est identique', () => {
    const s = createWorld(10);
    moveTo(s, 'farm');
    work(s, 'b_farm', 3);
    advanceTime(s, MIN_PER_DAY);
    const text = serialize(s, '2026-01-01T00:00:00Z');
    const loaded = deserialize(text);
    expect(loaded.error).toBeUndefined();
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(s));
    // reprise : les deux mondes évoluent à l'identique
    wait(s, 20 * 60); wait(loaded.state!, 20 * 60);
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(s));
  });

  it('une sauvegarde altérée est rejetée', () => {
    const s = createWorld(11);
    const text = serialize(s).replace('"money":0', '"money":9999');
    expect(deserialize(text).error).toMatch(/corrompue/);
    expect(deserialize('pas du json').error).toBeTruthy();
  });
});

describe('Test F — Reproductibilité', () => {
  const play = (seed: number) => {
    const s = createWorld(seed);
    moveTo(s, 'woodlot');
    work(s, 'b_wood', 4);
    moveTo(s, 'tavern');
    talk(s, 'mathilde', 'chat');
    wait(s, 2 * MIN_PER_DAY);
    return s;
  };
  it('même graine + mêmes actions = même monde', () => {
    expect(JSON.stringify(play(77))).toBe(JSON.stringify(play(77)));
  });
  it('une graine différente produit un monde différent', () => {
    expect(JSON.stringify(play(77))).not.toBe(JSON.stringify(play(78)));
  });
});

describe('Test G — Cohérence temporelle', () => {
  it('le découpage du temps ne change pas le résultat (aucun double calcul)', () => {
    const a = createWorld(12); a.observer = true;
    const b = createWorld(12); b.observer = true;
    const c = createWorld(12); c.observer = true;
    advanceTime(a, MIN_PER_DAY);
    for (let i = 0; i < 24; i++) advanceTime(b, 60);
    for (let i = 0; i < 24 * 6; i++) advanceTime(c, 10);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    expect(a.processedHours - createWorld(12).processedHours).toBe(24);
  });

  it('la faim augmente exactement une fois par heure franchie', () => {
    const s = createWorld(13);
    const p = s.characters.player;
    p.needs.hunger = 0;
    wait(s, 30);           // 6h00 → 6h30 : aucune frontière d'heure
    expect(p.needs.hunger).toBe(0);
    wait(s, 30 + 120);     // → 9h00 : 3 frontières
    expect(p.needs.hunger).toBeCloseTo(3 * HUNGER_PER_HOUR, 5);
    expect(toDate(s.time).hour).toBe(9);
  });

  it('travailler N heures produit exactement N heures de travail payées', () => {
    const s = createWorld(14);
    moveTo(s, 'farm');
    wait(s, minutesUntilHour(s.time, 8));
    const p = s.characters.player;
    const h0 = p.hoursWorkedToday;
    const r = work(s, 'b_farm', 3);
    expect(r.ok, r.message).toBe(true);
    expect(p.hoursWorkedToday - h0).toBe(3);
    expect(r.minutes).toBe(180);
  });

  it('dormir à la belle étoile jusqu’au matin restaure l’énergie', () => {
    const s = createWorld(15);
    wait(s, minutesUntilHour(s.time, 22));
    const p = s.characters.player;
    p.needs.energy = 20;
    p.inventory.bread = 3;
    const r = sleep(s, 'rough');
    expect(r.ok).toBe(true);
    expect(toDate(s.time).hour).toBe(6);
    expect(p.needs.energy).toBeGreaterThan(20);
  });
});

describe('Invariants à long terme', () => {
  it('60 jours : argent et objets conservés, intégrité intacte, village vivant', () => {
    const s = createWorld(42);
    s.observer = true;
    const m0 = totalMoney(s), i0 = totalItems(s);
    advanceTime(s, 60 * MIN_PER_DAY);
    expect(checkIntegrity(s)).toEqual([]);
    expect(moneyBalance(m0, s)).toBe(0);
    expect(itemBalance(i0, s, totalItems(s))).toEqual({});
    const alive = s.characterOrder.filter(id => s.characters[id].alive && !s.characters[id].isPlayer).length;
    expect(alive).toBeGreaterThanOrEqual(14);
  });
});

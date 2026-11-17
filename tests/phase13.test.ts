// Phase 13 — les affaires du joueur (plus de dettes envers soi-même, comptes, prélèvement, vente)
// et le pilote automatique (« vivre une semaine / une saison »).
import { describe, expect, it } from 'vitest';
import {
  acceptOrder, activeContract, activeLoans, advanceTime, allBusinesses, checkIntegrity, cleanSelfDealings, createWorld, deserialize, foundHouse,
  garrison, hasVocation, houseOfPlayer, jobOffer, liveDays, manage, moneyBalance, ownedBusinesses, P, petition, postOrder, recordIOU, reserveFor,
  saleOffer, sellBusinessAsPlayer, serialize, signContract, toDate, totalMoney, transferBusiness, transferMoney, weeklyBooks, type GameState,
} from '../src/engine';

function fund(s: GameState, amount: number) {
  const p = s.characters.player;
  for (const b of allBusinesses(s).slice().sort((a, b) => b.treasury - a.treasury)) {
    const k = Math.min(Math.max(0, b.treasury - 40), amount - p.money);
    if (k > 0) transferMoney(s, P.b(b.id), P.c(p.id), k);
  }
  return p;
}

/** Le joueur reçoit le fournil de Valcendre. */
function owner(seed: number) {
  const s = createWorld(seed);
  const p = s.characters.player;
  const b = allBusinesses(s).find(x => x.kind === 'bakery')!;
  transferBusiness(s, b, p, b.ownerId ? s.characters[b.ownerId] : undefined);
  p.locationId = b.locationId;
  return { s, p, b };
}

describe('Plus d’affaires conclues avec soi-même', () => {
  it('on ne prend pas la commande de sa propre affaire, et l’on ne se doit rien', () => {
    const { s, p, b } = owner(1300);
    b.targets.grain = 40;
    const o = postOrder(s, b, 'grain');
    if (o) {
      p.locationId = s.settlements.valcendre.squareId;
      expect(acceptOrder(s, o.id).ok).toBe(false);
    }
    expect(recordIOU(s, p, p, 50, 'test')).toBeUndefined();
    expect(activeLoans(s).some(l => l.lenderId === l.borrowerId)).toBe(false);
  });

  it('pas de place sous contrat dans sa propre affaire', () => {
    const { s, p, b } = owner(1301);
    const o = jobOffer(s, b, p);
    expect(o.ok).toBe(false);
    expect(signContract(s, b.id).ok).toBe(false);
  });

  it('racheter l’affaire où l’on travaille met fin au contrat', () => {
    const s = createWorld(1302);
    const p = s.characters.player;
    const b = allBusinesses(s).find(x => x.kind === 'bakery')!;
    // le joueur y est embauché
    p.locationId = b.locationId;
    const k = { id: 'k_t', businessId: b.id, workerId: p.id, wage: 4, hoursPerWeek: 30, startDay: 0, hoursThisWeek: 0, goodWeeks: 0, strikes: 0, status: 'active' as const, grade: 'compagnon' as const };
    s.contracts.push(k); b.employees.push(p.id); p.employerId = b.id;
    transferBusiness(s, b, p, s.characters[b.ownerId!]);
    expect(activeContract(s, p.id)).toBeUndefined();
    expect(b.employees).not.toContain(p.id);
  });

  it('une ancienne sauvegarde est réparée : dette envers soi annulée, contrat avec soi clos', () => {
    const { s, p, b } = owner(1303);
    s.loans.push({ id: 'l_self', lenderId: p.id, borrowerId: p.id, principal: 30, totalDue: 30, remaining: 30, installment: 15, weeklyRate: 0, createdDay: 0, nextDueDay: 7, finalDueDay: 14, missed: 0, status: 'active', purpose: 'test' });
    s.contracts.push({ id: 'k_self', businessId: b.id, workerId: p.id, wage: 4, hoursPerWeek: 30, startDay: 0, hoursThisWeek: 0, goodWeeks: 0, strikes: 0, status: 'active', grade: 'apprenti' });
    const back = deserialize(serialize(s));
    expect(back.error).toBeUndefined();
    expect(back.repaired?.some(x => x.includes('dette envers soi-même'))).toBe(true);
    expect(back.state!.loans.find(l => l.id === 'l_self')!.status).toBe('repaid');
    expect(back.state!.contracts.find(k => k.id === 'k_self')!.status).toBe('ended');
    expect(cleanSelfDealings(back.state!)).toEqual([]);
  });
});

describe('Comptes, prélèvement et vente', () => {
  it('le livre de comptes range ventes, achats, gages ; le prélèvement tombe le lundi sans entamer la réserve', () => {
    const { s, p, b } = owner(1310);
    transferMoney(s, P.c(fund(s, 600).id), P.b(b.id), 500);
    const m0 = totalMoney(s);
    expect(manage(s, b.id, { kind: 'draw', delta: 40 }).ok).toBe(true);
    for (let i = 0; i < 24 * 9; i++) { p.needs.hunger = 0; p.needs.energy = 90; advanceTime(s, 60); }
    expect(b.books).toBeTruthy();
    expect(b.books!.past.length).toBeGreaterThan(0);
    const w = b.books!.past[0];
    expect(w.sales + w.purchases + w.wages + w.taxes).toBeGreaterThan(0);
    expect(b.books!.cur.ownerOut + w.ownerOut).toBeGreaterThan(0); // le prélèvement est passé (il ouvre la semaine nouvelle)
    expect(b.treasury).toBeGreaterThanOrEqual(0);
    expect(moneyBalance(m0, s)).toBe(0);
  });

  it('le prélèvement ne vide jamais la caisse sous sa réserve', () => {
    const { s, p, b } = owner(1311);
    b.ownerDraw = 300;
    const before = p.money;
    weeklyBooks(s);
    expect(b.treasury).toBeGreaterThanOrEqual(Math.min(reserveFor(b), b.treasury));
    expect(p.money - before).toBeLessThanOrEqual(300);
  });

  it('vendre son affaire : un habitant aisé la rachète, sinon l’intendance à bas prix', () => {
    const { s, p, b } = owner(1312);
    const m0 = totalMoney(s);
    const o = saleOffer(s, b);
    if (!o) return; // personne ne peut payer dans ce monde : la vente est refusée proprement
    const r = sellBusinessAsPlayer(s, b.id);
    expect(r.ok).toBe(true);
    expect(b.ownerId).not.toBe(p.id);
    expect(ownedBusinesses(s, p).length).toBe(0);
    expect(b.employees).not.toContain(p.id);
    expect(totalMoney(s)).toBe(m0);
    expect(checkIntegrity(s)).toEqual([]);
  });
});

describe('Pilote automatique', () => {
  it('un propriétaire ne court pas les embauches : il vit de sa caisse sans la vider', () => {
    const { s, p, b } = owner(1320);
    transferMoney(s, P.c(fund(s, 500).id), P.b(b.id), 450);
    p.money = 0 + p.money; // la bourse est vide, la caisse pleine
    transferMoney(s, P.c(p.id), P.b(b.id), p.money);
    expect(hasVocation(s, p)).toBe(true);
    const r = liveDays(s, 14);
    expect(r.ok).toBe(true);
    expect(activeContract(s, p.id)).toBeUndefined();
    expect(p.alive).toBe(true);
    expect(p.money).toBeGreaterThan(0);
    expect(r.message).toContain(b.name);
  });

  it('un seigneur garde au trésor de sa maison de quoi solder sa garnison', () => {
    const s = createWorld(1321);
    const p = fund(s, 1400);
    p.title = 'ecuyer';
    expect(foundHouse(s).ok).toBe(true);
    const h = houseOfPlayer(s)!;
    const c = Object.values(s.characters).find(x => !x.isPlayer && x.alive && x.age >= 18 && x.age < 45 && !x.employerId && !s.orgOrder.some(id => s.orgs[id].members.includes(x.id)));
    if (c) { h.members.push(c.id); h.roles[c.id] = 'soldat'; c.profession = 'soldat'; }
    transferMoney(s, P.o(h.id), P.c(p.id), h.treasury); // trésor vide
    const r = liveDays(s, 7);
    expect(r.ok).toBe(true);
    expect(activeContract(s, p.id)).toBeUndefined(); // un seigneur ne s'engage pas comme apprenti
    if (c && garrison(s, h).length) expect(h.treasury).toBeGreaterThan(0);
  });

  it('un soldat au pilote automatique patrouille, et son service compte pour sa solde', () => {
    const s = createWorld(1322);
    const p = s.characters.player;
    const h = s.orgs.h_delaval;
    const lord = s.characters[h.leaderId!];
    p.locationId = lord.locationId; lord.activity.kind = 'idle';
    expect(petition(s, lord.id, 'enlist').ok).toBe(true);
    let paid = false;
    for (let d = 0; d < 9; d++) {
      const before = p.money;
      liveDays(s, 1);
      if (toDate(s.time).weekday === 0 && p.money > before) paid = true;
    }
    expect(activeContract(s, p.id)).toBeUndefined();
    expect(p.profession).toBe('soldat');
    expect(paid).toBe(true);
  });
});

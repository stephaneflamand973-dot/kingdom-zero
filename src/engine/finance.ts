// ─────────────────────────────────────────────────────────────
// Finance : prêts entre personnes, échéances, défaut de paiement, saisies.
// Tout transfert passe par transferMoney / transferItem : la masse monétaire reste constante.
// ─────────────────────────────────────────────────────────────
import { ITEMS, ITEM_IDS, PROFESSION_BY_BUSINESS } from './data';
import { P, referencePrice, reserveFor, transferItem, transferMoney } from './economy';
import { getEvent, logEvent } from './events';
import { getRelation, modifyRelation } from './social';
import { toDate } from './time';
import type { Business, Character, GameState, Loan } from './types';
import { allBusinesses, charactersAt, fullName, hasTrait, newId, npcs, qty } from './util';

export const MAX_DEBT = 220;

export function lenderReserve(c: Character): number {
  return hasTrait(c, 'prudent') ? 120 : 60;
}

export function activeLoans(state: GameState, opts: { borrowerId?: string; lenderId?: string } = {}): Loan[] {
  return state.loans.filter(l => l.status === 'active'
    && (!opts.borrowerId || l.borrowerId === opts.borrowerId)
    && (!opts.lenderId || l.lenderId === opts.lenderId));
}

export function debtOf(state: GameState, id: string): number {
  return activeLoans(state, { borrowerId: id }).reduce((s, l) => s + l.remaining, 0);
}

/** L'observateur sait-il (par témoignage ou rumeur) que la personne a déjà fait défaut ? */
export function knownBadDebtor(state: GameState, observer: Character, targetId: string): boolean {
  return observer.knownEvents.some(id => {
    const e = getEvent(state, id);
    return !!e && e.type === 'default' && e.actorId === targetId;
  });
}

export interface LoanTerms {
  ok: boolean;
  reason?: string;
  amount: number;
  weeklyRate: number;
  weeks: number;
  totalDue: number;
  installment: number;
}

/** Conditions auxquelles `lender` accepterait de prêter `amount` à `borrower`. */
export function loanTerms(state: GameState, lender: Character, borrower: Character, amount: number): LoanTerms {
  const weeks = amount <= 40 ? 2 : amount <= 100 ? 4 : 6;
  let rate = 0.05;
  if (hasTrait(lender, 'avare')) rate += 0.04;
  if (hasTrait(lender, 'ambitieux')) rate += 0.02;
  if (hasTrait(lender, 'genereux')) rate -= 0.03;
  const rel = getRelation(state, lender.id, borrower.id);
  if (rel.affinity >= 40) rate *= 0.25;
  else if (rel.affinity >= 20) rate *= 0.6;
  rate = Math.max(0, Math.round(rate * 100) / 100);
  const totalDue = Math.round(amount * (1 + rate * weeks));
  const installment = Math.ceil(totalDue / weeks);
  const base = { amount, weeklyRate: rate, weeks, totalDue, installment };
  const refuse = (reason: string): LoanTerms => ({ ok: false, reason, ...base });
  if (!lender.alive || !borrower.alive || lender.id === borrower.id) return refuse('Prêt impossible.');
  if (!Number.isInteger(amount) || amount <= 0) return refuse('Montant invalide.');
  const you = borrower.isPlayer;
  const L = lender.firstName;
  if (knownBadDebtor(state, lender, borrower.id)) return refuse(you ? `${L} sait que tu n’as pas remboursé une dette.` : `${L} sait que ${borrower.firstName} n’a pas remboursé une dette.`);
  if (activeLoans(state, { borrowerId: borrower.id, lenderId: lender.id }).length) return refuse(`${L} attend d’abord le remboursement du prêt en cours.`);
  if (debtOf(state, borrower.id) + totalDue > MAX_DEBT) return refuse(you ? 'Ta dette totale serait trop lourde.' : 'Sa dette totale serait trop lourde.');
  if (rel.trust < -5) return refuse(you ? `${L} ne te fait pas confiance.` : `${L} ne lui fait pas confiance.`);
  if (amount > 30 && rel.trust < 10 && rel.affinity < 15) return refuse(you ? `${L} ne te connaît pas assez pour prêter autant.` : `${L} ne le connaît pas assez pour prêter autant.`);
  if (lender.money - lenderReserve(lender) < amount) return refuse(`${L} n’a pas ${amount} d à prêter.`);
  if (hasTrait(lender, 'prudent') && amount > (lender.money - lenderReserve(lender)) / 2) return refuse(`${L}, prudent, ne risquerait pas une telle somme.`);
  return { ok: true, ...base };
}

/** Signe un prêt : l'argent passe immédiatement du prêteur à l'emprunteur. */
export function createLoan(state: GameState, lender: Character, borrower: Character, terms: LoanTerms, purpose: string, witnesses: string[] = []): Loan | undefined {
  if (!terms.ok) return undefined;
  if (!transferMoney(state, P.c(lender.id), P.c(borrower.id), terms.amount)) return undefined;
  const day = toDate(state.time).day;
  const loan: Loan = {
    id: newId(state, 'l'), lenderId: lender.id, borrowerId: borrower.id, principal: terms.amount,
    totalDue: terms.totalDue, remaining: terms.totalDue, installment: terms.installment, weeklyRate: terms.weeklyRate,
    createdDay: day, nextDueDay: day + 7, finalDueDay: day + 7 * terms.weeks, missed: 0, status: 'active', purpose,
  };
  state.loans.push(loan);
  modifyRelation(state, borrower.id, lender.id, 4, 3);
  logEvent(state, {
    type: 'loan', actorId: borrower.id, targetId: lender.id, locationId: borrower.locationId, importance: 2,
    text: `${fullName(borrower)} emprunte ${terms.amount} d à ${fullName(lender)} (${Math.round(terms.weeklyRate * 100)} %/semaine, ${terms.totalDue} d à rendre en ${terms.weeks} semaines) ${purpose}.`,
    witnesses: [lender.id, borrower.id, ...witnesses], data: { loan: loan.id, amount: terms.amount },
  });
  return loan;
}

/** Reconnaissance de dette sans versement (marchandise livrée non payée), sans intérêt, 2 semaines. */
export function recordIOU(state: GameState, creditor: Character, debtor: Character, amount: number, purpose: string): Loan {
  const day = toDate(state.time).day;
  const loan: Loan = {
    id: newId(state, 'l'), lenderId: creditor.id, borrowerId: debtor.id, principal: amount, totalDue: amount, remaining: amount,
    installment: Math.ceil(amount / 2), weeklyRate: 0, createdDay: day, nextDueDay: day + 7, finalDueDay: day + 14,
    missed: 0, status: 'active', purpose,
  };
  state.loans.push(loan);
  logEvent(state, {
    type: 'loan', actorId: debtor.id, targetId: creditor.id, importance: 2,
    text: `${fullName(debtor)} reconnaît devoir ${amount} d à ${fullName(creditor)} ${purpose}.`,
    witnesses: [creditor.id, debtor.id], data: { loan: loan.id, amount },
  });
  return loan;
}

/** Fonds mobilisables par le débiteur : sa bourse, puis la caisse de son affaire. */
function payFrom(state: GameState, borrower: Character, to: Character, amount: number): number {
  let paid = 0;
  const own = Math.min(amount, borrower.money);
  if (own > 0 && transferMoney(state, P.c(borrower.id), P.c(to.id), own)) paid += own;
  if (paid < amount) {
    for (const b of ownedBusinesses(state, borrower)) {
      const take = Math.min(amount - paid, b.treasury);
      if (take > 0 && transferMoney(state, P.b(b.id), P.c(to.id), take)) paid += take;
      if (paid >= amount) break;
    }
  }
  return paid;
}

export function ownedBusinesses(state: GameState, c: Character): Business[] {
  return allBusinesses(state).filter(b => b.ownerId === c.id);
}

/** Remboursement volontaire (anticipé ou partiel). Renvoie la somme versée. */
export function repay(state: GameState, loan: Loan, amount: number): number {
  if (loan.status !== 'active') return 0;
  const borrower = state.characters[loan.borrowerId], lender = state.characters[loan.lenderId];
  const n = Math.min(amount, loan.remaining, borrower.money);
  if (n <= 0 || !transferMoney(state, P.c(borrower.id), P.c(lender.id), n)) return 0;
  loan.remaining -= n;
  if (loan.remaining === 0) closeRepaid(state, loan);
  return n;
}

function closeRepaid(state: GameState, loan: Loan): void {
  const borrower = state.characters[loan.borrowerId], lender = state.characters[loan.lenderId];
  loan.status = 'repaid';
  modifyRelation(state, loan.lenderId, loan.borrowerId, 3, 10);
  logEvent(state, {
    type: 'loan_repaid', actorId: borrower.id, targetId: lender.id, importance: 2,
    text: `${fullName(borrower)} a remboursé sa dette envers ${fullName(lender)} (${loan.totalDue} d).`,
    witnesses: [lender.id, borrower.id],
  });
}

/** Échéances du jour : appelé une fois par jour. */
export function processLoans(state: GameState): void {
  const day = toDate(state.time).day;
  for (const loan of state.loans) {
    if (loan.status !== 'active' || loan.nextDueDay > day) continue;
    const borrower = state.characters[loan.borrowerId], lender = state.characters[loan.lenderId];
    if (!lender.alive) {
      // Créance éteinte avec le créancier (pas encore de succession familiale)
      loan.status = 'repaid';
      continue;
    }
    if (!borrower.alive) { defaultLoan(state, loan, 'le débiteur est mort'); continue; }
    const due = Math.min(loan.installment, loan.remaining);
    const paid = payFrom(state, borrower, lender, due);
    loan.remaining -= paid;
    if (loan.remaining <= 0) { loan.remaining = 0; closeRepaid(state, loan); continue; }
    if (paid * 2 < due) {
      loan.missed += 1;
      modifyRelation(state, lender.id, borrower.id, -4, -12);
      logEvent(state, {
        type: 'loan', actorId: borrower.id, targetId: lender.id, importance: 2,
        text: `${fullName(borrower)} ne peut verser que ${paid} d sur les ${due} d dus à ${fullName(lender)}.`,
        // (une échéance payée à moitié au moins n'est pas comptée comme manquée)
        witnesses: [lender.id, borrower.id], data: { loan: loan.id, missed: loan.missed },
      });
    }
    loan.nextDueDay += 7;
    if (loan.missed >= 2 || (day >= loan.finalDueDay + 7 && loan.remaining > 0)) defaultLoan(state, loan, 'échéances impayées');
  }
  // Archives : on ne garde qu'un historique raisonnable
  if (state.loans.length > 80) state.loans = state.loans.filter((l, i) => l.status === 'active' || i >= state.loans.length - 60);
}

/** Valeur de reprise d'une entreprise : caisse + stocks + fonds de commerce. */
export function businessValue(state: GameState, b: Business): number {
  let v = b.treasury + 150;
  for (const it of ITEM_IDS) v += qty(b.stock, it) * (referencePrice(state, it) ?? ITEMS[it].base);
  return Math.round(v);
}

/** Défaut : le créancier saisit l'argent, les biens, puis l'entreprise du débiteur. */
export function defaultLoan(state: GameState, loan: Loan, why: string): void {
  const borrower = state.characters[loan.borrowerId], lender = state.characters[loan.lenderId];
  loan.status = 'defaulted';
  const seized: string[] = [];
  if (borrower.alive) {
    const cash = Math.min(borrower.money, loan.remaining);
    if (cash > 0 && transferMoney(state, P.c(borrower.id), P.c(lender.id), cash)) { loan.remaining -= cash; seized.push(`${cash} d`); }
    for (const it of ITEM_IDS) {
      if (loan.remaining <= 0) break;
      const price = referencePrice(state, it) ?? ITEMS[it].base;
      const n = Math.min(qty(borrower.inventory, it), Math.ceil(loan.remaining / price));
      if (n > 0 && transferItem(state, P.c(borrower.id), P.c(lender.id), it, n)) {
        loan.remaining = Math.max(0, loan.remaining - n * price);
        seized.push(`${n} ${n > 1 ? ITEMS[it].plural : ITEMS[it].name}`);
      }
    }
  }
  const ev = logEvent(state, {
    type: 'default', actorId: borrower.id, targetId: lender.id, locationId: borrower.locationId, importance: 3,
    text: `${fullName(borrower)} fait défaut sur sa dette envers ${fullName(lender)} (${why}).${seized.length ? ` Saisie : ${seized.join(', ')}.` : ''}`,
    witnesses: [lender.id, borrower.id, ...charactersAt(state, borrower.locationId).map(c => c.id)],
    data: { loan: loan.id },
  });
  // Saisie de l'entreprise si la dette reste importante
  const biz = borrower.alive ? ownedBusinesses(state, borrower)[0] : undefined;
  if (biz && loan.remaining >= 30 && biz.kind !== 'manor') {
    transferBusiness(state, biz, lender, borrower);
    logEvent(state, {
      type: 'seizure', actorId: lender.id, targetId: borrower.id, businessId: biz.id, locationId: biz.locationId, importance: 3,
      text: `${fullName(lender)} saisit ${biz.name} pour couvrir la dette de ${fullName(borrower)}.`,
      witnesses: [...new Set([lender.id, borrower.id, ...biz.employees, ...charactersAt(state, biz.locationId).map(c => c.id)])],
      causeIds: [ev.id],
    });
    loan.remaining = 0;
  }
  modifyRelation(state, lender.id, borrower.id, -15, -40);
  if (borrower.alive) {
    modifyRelation(state, borrower.id, lender.id, -40, -20);
    considerVengeance(state, borrower, lender.id);
  }
}

/** Change le propriétaire d'une entreprise ; l'ancien reste comme ouvrier s'il y a de la place. */
export function transferBusiness(state: GameState, b: Business, newOwner: Character, oldOwner?: Character): void {
  // (un acquéreur employé ailleurs y reste : il devient propriétaire absent)
  if (b.employees.includes(newOwner.id)) {
    b.employees = b.employees.filter(id => id !== newOwner.id);
    if (newOwner.employerId === b.id) newOwner.employerId = undefined;
  }
  b.ownerId = newOwner.id;
  if (!newOwner.employerId) newOwner.employerId = b.id; // un propriétaire déjà employé ailleurs devient rentier
  if (!newOwner.isPlayer) newOwner.ambition = { kind: 'faire_fortune', since: state.time };
  // un ancien propriétaire salarié ailleurs garde ce travail-là (sinon fiche et registre du patron divergent)
  if (oldOwner && oldOwner.alive && (!oldOwner.employerId || oldOwner.employerId === b.id)) {
    oldOwner.employerId = undefined;
    oldOwner.profession = 'sans_emploi';
    oldOwner.goal = { kind: 'trouver_emploi' };
    if (b.employees.length < b.maxWorkers && getRelation(state, newOwner.id, oldOwner.id).affinity > -40) {
      b.employees.push(oldOwner.id);
      oldOwner.employerId = b.id;
      oldOwner.profession = PROFESSION_BY_BUSINESS[b.kind];
      oldOwner.goal = { kind: 'epargner' };
    }
  }
  b.lastStaffChangeDay = toDate(state.time).day;
}

/** Un ressentiment profond peut devenir une vengeance chez les tempéraments concernés. */
export function considerVengeance(state: GameState, c: Character, targetId: string): void {
  if (c.isPlayer || c.ambition.kind === 'vengeance') return;
  const r = getRelation(state, c.id, targetId);
  const prone = hasTrait(c, 'rancunier') || hasTrait(c, 'colerique') || hasTrait(c, 'malhonnete');
  if (r.affinity <= -55 && prone) {
    c.ambition = { kind: 'vengeance', targetId, since: state.time, count: 0 };
    logEvent(state, {
      type: 'rivalry', actorId: c.id, targetId, importance: 2,
      text: `${fullName(c)} jure de faire payer ${fullName(state.characters[targetId])}.`,
      witnesses: charactersAt(state, c.locationId).map(x => x.id),
    });
  }
}

/** Les PNJ cherchent un prêteur quand leur affaire ne peut plus payer ses ouvriers. */
export function npcBorrowing(state: GameState): void {
  for (const owner of npcs(state)) {
    if (activeLoans(state, { borrowerId: owner.id }).length) continue;
    for (const b of ownedBusinesses(state, owner)) {
      const weekWages = b.wage * 8 * Math.max(1, b.employees.length) * 5;
      if (b.treasury >= b.wage * 8 * Math.max(1, b.employees.length) || owner.money >= 50) continue;
      if (hasTrait(owner, 'prudent') && b.treasury > 0) continue;
      const amount = Math.max(40, Math.min(200, weekWages - b.treasury));
      const lenders = npcs(state).filter(l => l.id !== owner.id).sort((a, z) => z.money - a.money || (a.id < z.id ? -1 : 1));
      for (const l of lenders) {
        const t = loanTerms(state, l, owner, amount);
        if (!t.ok) continue;
        if (createLoan(state, l, owner, t, `pour renflouer ${b.name}`)) {
          transferMoney(state, P.c(owner.id), P.b(b.id), Math.min(owner.money, t.amount));
        }
        break;
      }
    }
  }
}

/** Petit prêt d'un ami à un affamé sans le sou (avant de mendier). */
export function friendlyLoan(state: GameState, c: Character): Loan | undefined {
  const friends = Object.entries(c.relations)
    .filter(([id, r]) => r.affinity >= 10 && state.characters[id]?.alive && !state.characters[id].isPlayer)
    .map(([id]) => state.characters[id])
    .sort((a, z) => z.money - a.money || (a.id < z.id ? -1 : 1));
  for (const f of friends) {
    const t = loanTerms(state, f, c, 20);
    if (t.ok) return createLoan(state, f, c, t, 'pour manger');
  }
  return undefined;
}

export function businessInTrouble(b: Business): boolean {
  return b.treasury < reserveFor(b) / 2;
}

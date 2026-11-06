// ─────────────────────────────────────────────────────────────
// Société (phase 2) : ambitions des PNJ, rachat d'entreprises, mobilité
// professionnelle, vengeance et calomnie, fêtes de saison, réputation par catégories.
// ─────────────────────────────────────────────────────────────
import { askPrice, fireEmployee, hireBest, isHiring, P, reserveFor, transferMoney } from './economy';
import { activeLoans, businessValue, considerVengeance, createLoan, loanTerms, ownedBusinesses, transferBusiness } from './finance';
import { getEvent, logEvent } from './events';
import { chance } from './rng';
import { getRelation, modifyRelation } from './social';
import { toDate } from './time';
import type { Ambition, Business, Character, GameState, WorldEvent } from './types';
import { addItem, aliveCharacters, allBusinesses, fullName, hasTrait, npcs, qty } from './util';

// ── Ambitions ────────────────────────────────────────────────

export function initialAmbition(state: GameState, c: Character): Ambition {
  const owns = allBusinesses(state).some(b => b.ownerId === c.id);
  if (owns) return { kind: 'faire_fortune', since: state.time };
  if (hasTrait(c, 'ambitieux')) return { kind: 'ouvrir_commerce', target: 350, since: state.time };
  if (c.employerId && !hasTrait(c, 'loyal') && c.profession !== 'garde' && c.profession !== 'intendant') return { kind: 'meilleur_salaire', since: state.time };
  return { kind: 'vie_paisible', since: state.time };
}

export function ambitionLabel(state: GameState, c: Character): string {
  const a = c.ambition;
  switch (a.kind) {
    case 'ouvrir_commerce': return `Posséder son propre commerce (${c.money}/${a.target ?? '?'} d épargnés)`;
    case 'faire_fortune': return 'Faire prospérer ses affaires';
    case 'meilleur_salaire': return 'Trouver une place mieux payée';
    case 'vengeance': return `Se venger de ${a.targetId ? fullName(state.characters[a.targetId]) : '?'}`;
    default: return 'Mener une vie paisible';
  }
}

/** Les entreprises qu'un acheteur pourrait reprendre, avec leur prix. */
export function businessesForSale(state: GameState, buyer?: Character): { b: Business; price: number; seller: string | null }[] {
  const out: { b: Business; price: number; seller: string | null }[] = [];
  for (const b of allBusinesses(state)) {
    if (b.kind === 'manor' || b.ownerId === buyer?.id) continue;
    const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
    const willing = !owner
      || (!owner.isPlayer && (owner.age >= 62 || (b.daysInDeficit >= 5 && owner.money < 40 && b.treasury < reserveFor(b))));
    if (!willing) continue;
    out.push({ b, price: businessValue(state, b), seller: owner ? owner.id : null });
  }
  return out.sort((x, y) => x.price - y.price);
}

/** Achat d'une entreprise : l'argent va au vendeur (ou au trésor du village). */
export function buyBusiness(state: GameState, buyer: Character, b: Business, price: number): boolean {
  const seller = b.ownerId ? state.characters[b.ownerId] : undefined;
  const to = seller ? P.c(seller.id) : P.b(state.village.manorId);
  if (!transferMoney(state, P.c(buyer.id), to, price)) return false;
  transferBusiness(state, b, buyer, seller);
  logEvent(state, {
    type: 'sale', actorId: buyer.id, targetId: seller?.id, businessId: b.id, locationId: b.locationId, importance: 3,
    text: seller
      ? `${fullName(seller)} vend ${b.name} à ${fullName(buyer)} pour ${price} d.`
      : `${fullName(buyer)} rachète ${b.name} à l'intendance pour ${price} d.`,
    witnesses: aliveCharacters(state).map(c => c.id), // affaire publique
  });
  return true;
}

/** Quotidien : poursuite des ambitions de long terme. */
export function processAmbitions(state: GameState): void {
  for (const c of npcs(state)) {
    const a = c.ambition;
    // Une rancune profonde peut naître (ou s'éteindre)
    if (a.kind !== 'vengeance') {
      const worst = Object.entries(c.relations)
        .filter(([id]) => state.characters[id]?.alive)
        .sort((x, y) => x[1].affinity - y[1].affinity)[0];
      // une rancune assouvie laisse un répit de quatre semaines
      const rested = state.time - a.since > 42 * 24 * 60;
      if (worst && worst[1].affinity <= -55 && rested) considerVengeance(state, c, worst[0]);
    } else {
      const t = a.targetId ? state.characters[a.targetId] : undefined;
      if (!t || !t.alive || (a.count ?? 0) >= 3 || getRelation(state, c.id, t.id).affinity > -30) {
        c.ambition = initialAmbition(state, c);
      }
      continue;
    }
    if (c.ambition.kind === 'ouvrir_commerce') {
      const offers = businessesForSale(state, c);
      if (offers.length) c.ambition.target = offers[0].price;
      const deal = offers.find(o => o.seller !== c.id && o.price <= c.money)
        ?? offers.find(o => o.seller !== c.id && o.price - c.money <= 150 && c.money >= o.price * 0.6);
      if (!deal) continue;
      if (deal.price > c.money) {
        // Emprunter le complément : risque d'une saisie future si l'affaire périclite
        const need = deal.price - c.money;
        const lender = npcs(state).filter(l => l.id !== c.id && l.id !== deal.seller)
          .sort((x, y) => y.money - x.money || (x.id < y.id ? -1 : 1))
          .find(l => loanTerms(state, l, c, need).ok);
        if (!lender || !createLoan(state, lender, c, loanTerms(state, lender, c, need), `pour racheter ${deal.b.name}`)) continue;
      }
      // l'ancien employeur perd un ouvrier
      if (c.employerId) {
        const prev = state.businesses[c.employerId];
        if (prev && prev.ownerId !== c.id) prev.employees = prev.employees.filter(id => id !== c.id);
        c.employerId = undefined;
      }
      buyBusiness(state, c, deal.b, deal.price);
    }
  }
}

/** Hebdomadaire : les employés partent pour un meilleur salaire. */
export function jobHopping(state: GameState): void {
  for (const c of npcs(state)) {
    if (!c.employerId || hasTrait(c, 'loyal') || c.profession === 'garde' || c.profession === 'intendant') continue;
    const cur = state.businesses[c.employerId];
    if (!cur || cur.ownerId === c.id) continue;
    if (toDate(state.time).day - (c.jobSince ?? -99) < 21) continue; // on ne change pas de place sans cesse
    const margin = c.ambition.kind === 'meilleur_salaire' ? 1 : 2;
    const better = allBusinesses(state)
      .filter(b => b.id !== cur.id && b.kind !== 'manor' && isHiring(state, b) && b.wage >= cur.wage + margin)
      .filter(b => !b.ownerId || getRelation(state, b.ownerId, c.id).affinity > -10)
      .sort((x, y) => y.wage - x.wage || (x.id < y.id ? -1 : 1))[0];
    if (!better || !chance(state, 0.4)) continue;
    fireEmployee(state, cur, c, `part pour un meilleur salaire à ${better.name} (${better.wage} d/h contre ${cur.wage})`, true);
    if (hireBest(state, better, [c])) better.lastStaffChangeDay = toDate(state.time).day;
  }
}

// ── Vengeance et calomnie ───────────────────────────────────

/** Pendant une soirée, un rancunier dénigre sa cible auprès d'un tiers. */
export function trySlander(state: GameState, speaker: Character, listener: Character): WorldEvent | undefined {
  const a = speaker.ambition;
  if (a.kind !== 'vengeance' || !a.targetId || listener.id === a.targetId) return undefined;
  const day = toDate(state.time).day;
  if (a.lastDay === day) return undefined; // une calomnie par soirée au plus
  if (!chance(state, hasTrait(speaker, 'bavard') ? 0.7 : 0.45)) return undefined;
  const target = state.characters[a.targetId];
  a.count = (a.count ?? 0) + 1;
  a.lastDay = day;
  const ev = logEvent(state, {
    type: 'slander', actorId: speaker.id, targetId: target.id, locationId: speaker.locationId, importance: 2,
    text: `${fullName(speaker)} raconte à ${fullName(listener)} que ${fullName(target)} est un escroc sans parole.`,
    witnesses: [speaker.id, listener.id],
  });
  // L'auditeur juge selon ce qu'il pense déjà de la cible
  if (getRelation(state, listener.id, target.id).affinity >= 30) modifyRelation(state, listener.id, speaker.id, -3, -6);
  else modifyRelation(state, listener.id, target.id, -4, -8);
  return ev;
}

// ── Fête de saison ───────────────────────────────────────────

/** Premier jour de chaque saison à 17 h : l'intendance offre la bière à l'auberge. */
export function startFestival(state: GameState): void {
  const d = toDate(state.time);
  const tavern = allBusinesses(state).find(b => b.kind === 'tavern');
  const manor = state.businesses[state.village.manorId];
  if (!tavern) return;
  const adults = npcs(state).filter(c => c.age >= 14).length + 1;
  const price = Math.max(1, Math.round(askPrice(state, tavern, 'ale') * 0.8));
  const n = Math.min(adults, qty(tavern.stock, 'ale'), Math.floor(Math.max(0, manor.treasury - 250) / price));
  const name = ['Fête du Printemps', "Fête de l'Été", "Fête de l'Automne", "Fête de l'Hiver"][d.season];
  if (n > 0) transferMoney(state, P.b(manor.id), P.b(tavern.id), n * price);
  state.festival = { day: d.day, alePaid: n, name };
  logEvent(state, {
    type: 'festival', locationId: tavern.locationId, importance: 2,
    text: n > 0
      ? `${name} : l'intendance offre ${n} chopes au ${tavern.name}. Tout le village est invité ce soir.`
      : `${name} : le village se réunit au ${tavern.name}, mais le trésor est trop maigre pour offrir à boire.`,
    witnesses: aliveCharacters(state).map(c => c.id),
  });
}

export function festivalTonight(state: GameState): boolean {
  const d = toDate(state.time);
  return !!state.festival && state.festival.day === d.day && d.hour >= 17;
}

/** Sert une chope payée par l'intendance. Renvoie vrai si servie. */
export function serveFestivalAle(state: GameState, c: Character, tavern: Business): boolean {
  if (!festivalTonight(state) || !state.festival || state.festival.alePaid <= 0 || qty(tavern.stock, 'ale') < 1) return false;
  state.festival.alePaid -= 1;
  addItem(tavern.stock, 'ale', -1);
  addItem(state.ledger.consumed, 'ale', 1);
  c.needs.social = Math.min(100, c.needs.social + 20);
  return true;
}

// ── Réputation par catégories ───────────────────────────────

const TAGS: { tag: string; good: boolean; match: (e: WorldEvent, id: string) => boolean }[] = [
  { tag: 'Voleur', good: false, match: (e, id) => e.type === 'theft_caught' && e.actorId === id },
  { tag: 'Mauvais payeur', good: false, match: (e, id) => e.type === 'default' && e.actorId === id },
  { tag: 'Querelleur', good: false, match: (e, id) => (e.type === 'insult' || e.type === 'argument') && e.actorId === id },
  { tag: 'Calomnié', good: false, match: (e, id) => e.type === 'slander' && e.targetId === id },
  { tag: 'Parole non tenue', good: false, match: (e, id) => e.type === 'order_failed' && e.actorId === id },
  { tag: 'Généreux', good: true, match: (e, id) => (e.type === 'gift' || e.type === 'help') && e.actorId === id },
  { tag: 'Bon payeur', good: true, match: (e, id) => e.type === 'loan_repaid' && e.actorId === id },
  { tag: 'Travailleur', good: true, match: (e, id) => (e.type === 'work_praise' || e.type === 'order_done') && e.actorId === id },
];

/** Ce que les habitants savent de quelqu'un, par catégorie (nombre de personnes au courant). */
export function reputationTags(state: GameState, targetId: string): { tag: string; good: boolean; known: number }[] {
  const out: { tag: string; good: boolean; known: number }[] = [];
  const people = aliveCharacters(state).filter(c => c.id !== targetId && !c.isPlayer);
  for (const t of TAGS) {
    let known = 0;
    for (const c of people) {
      if (c.knownEvents.some(id => { const e = getEvent(state, id); return !!e && t.match(e, targetId); })) known++;
    }
    if (known) out.push({ tag: t.tag, good: t.good, known });
  }
  return out.sort((a, b) => b.known - a.known);
}

/** Dettes connues d'un personnage (pour l'affichage). */
export function debtsSummary(state: GameState, id: string): { owes: number; owed: number } {
  return {
    owes: activeLoans(state, { borrowerId: id }).reduce((s, l) => s + l.remaining, 0),
    owed: activeLoans(state, { lenderId: id }).reduce((s, l) => s + l.remaining, 0),
  };
}

export { ownedBusinesses };

// ─────────────────────────────────────────────────────────────
// Phase 6 — Les PNJ prennent l'initiative. Un PNJ présent au même
// endroit que le joueur peut l'aborder de lui-même selon son état et
// sa relation réelle : un ami partage son pain avec un affamé, un
// créancier relance une échéance manquée, un rival provoque, un
// admirateur se déclare, un patron qui embauche fait signe.
// Chaque initiative a des effets réels (objets, relations) et se
// retrouve dans le journal du joueur.
// ─────────────────────────────────────────────────────────────
import { isHiring, P, transferItem } from './economy';
import { logEvent } from './events';
import { kin } from './family';
import { activeLoans, ownedBusinesses } from './finance';
import { chance, rand } from './rng';
import { getRelation, modifyRelation } from './social';
import type { Character, GameState } from './types';
import { charactersAt, clamp, fullName, hasTrait, qty } from './util';

export type ApproachKind = 'share_food' | 'creditor' | 'provoke' | 'declare' | 'job_offer' | 'invite';

const COOLDOWN_MIN = 4 * 60;

interface Candidate { kind: ApproachKind; npc: Character; weight: number }

function candidatesFor(state: GameState, p: Character): Candidate[] {
  const out: Candidate[] = [];
  const pFood = qty(p.inventory, 'bread') + qty(p.inventory, 'grain');
  const hour = Math.floor(((state.time + 360) % 1440) / 60);
  for (const n of charactersAt(state, p.locationId)) {
    if (n.age < 14 || (n.jailedUntil ?? 0) > state.time) continue;
    const k = n.activity.kind;
    if (k === 'sleep' || k === 'travel' || k === 'jailed') continue;
    const r = getRelation(state, n.id, p.id);
    const working = k === 'work';
    if (p.needs.hunger >= 60 && pFood === 0 && r.affinity >= 30 && qty(n.inventory, 'bread') >= 2) {
      out.push({ kind: 'share_food', npc: n, weight: 5 + (hasTrait(n, 'genereux') ? 4 : 0) - (hasTrait(n, 'avare') ? 4 : 0) });
    }
    const overdue = activeLoans(state, { borrowerId: p.id, lenderId: n.id }).find(l => l.missed > 0);
    if (overdue) out.push({ kind: 'creditor', npc: n, weight: 6 });
    if (r.affinity <= -40 && !working && (hasTrait(n, 'colerique') || hasTrait(n, 'rancunier'))) out.push({ kind: 'provoke', npc: n, weight: 3 });
    if ((r.romance ?? 0) >= 60 && !n.spouseId && !p.spouseId && n.age >= 16 && p.age >= 16 && !kin(state, n, p) && !hasTrait(n, 'timide')) {
      out.push({ kind: 'declare', npc: n, weight: 2 });
    }
    if (!p.employerId && r.affinity >= 10) {
      const b = ownedBusinesses(state, n).find(x => x.kind !== 'manor' && isHiring(state, x));
      if (b) out.push({ kind: 'job_offer', npc: n, weight: 3 });
    }
    if (r.affinity >= 25 && p.needs.social < 45 && !working && hour >= 17 && hour <= 22) out.push({ kind: 'invite', npc: n, weight: 2 + (hasTrait(n, 'sociable') ? 2 : 0) });
  }
  return out.filter(c => c.weight > 0);
}

/** Appelée chaque heure : au plus une initiative toutes les quatre heures. Renvoie le texte produit. */
export function npcApproaches(state: GameState): string | undefined {
  const p = state.characters[state.playerId];
  if (!p?.alive || state.observer || state.encounter || state.pendingSuccession) return undefined;
  if (p.activity.kind === 'sleep' || p.activity.kind === 'travel' || p.activity.kind === 'jailed') return undefined;
  if (state.locations[p.locationId]?.kind === 'road') return undefined;
  if (state.lastApproach !== undefined && state.time - state.lastApproach < COOLDOWN_MIN) return undefined;
  const cands = candidatesFor(state, p);
  if (!cands.length || !chance(state, 0.35)) return undefined;
  // tirage pondéré (déterministe : passe par le PRNG de l'état)
  const total = cands.reduce((s, c) => s + c.weight, 0);
  let roll = rand(state) * total;
  let chosen = cands[0];
  for (const c of cands) { roll -= c.weight; if (roll < 0) { chosen = c; break; } }
  const text = perform(state, p, chosen);
  if (text) state.lastApproach = state.time;
  return text;
}

function perform(state: GameState, p: Character, { kind, npc: n }: Candidate): string | undefined {
  const witnesses = charactersAt(state, p.locationId).map(c => c.id);
  const say = (text: string, importance: 1 | 2 | 3 = 2) => {
    logEvent(state, { type: 'approach', actorId: n.id, targetId: p.id, locationId: p.locationId, importance, text, witnesses, data: { kind } });
    return text;
  };
  switch (kind) {
    case 'share_food': {
      if (!transferItem(state, P.c(n.id), P.c(p.id), 'bread', 1)) return undefined;
      modifyRelation(state, p.id, n.id, 4, 4);
      modifyRelation(state, n.id, p.id, 1, 0);
      return say(`${fullName(n)} remarque ta mine creuse et te glisse une miche de pain : « Tiens, mange donc. »`);
    }
    case 'creditor': {
      const l = activeLoans(state, { borrowerId: p.id, lenderId: n.id }).find(x => x.missed > 0)!;
      modifyRelation(state, n.id, p.id, -1, -2);
      return say(`${fullName(n)} t'interpelle : « Tu me dois encore ${l.remaining} d, et tu as manqué ${l.missed} échéance${l.missed > 1 ? 's' : ''}. Je n'attendrai pas éternellement. »`);
    }
    case 'provoke': {
      modifyRelation(state, n.id, p.id, -2, -1);
      modifyRelation(state, p.id, n.id, -3, -2);
      p.needs.social = clamp(p.needs.social - 8, 0, 100);
      return say(`${fullName(n)} te bouscule exprès et ricane devant tout le monde. La rancune est tenace.`);
    }
    case 'declare': {
      const r = getRelation(state, n.id, p.id);
      r.romance = clamp((r.romance ?? 0) + 5, 0, 100);
      return say(`${fullName(n)} rougit et finit par t'avouer : « Je pense souvent à toi… » (attirance ${r.romance})`, 3);
    }
    case 'job_offer': {
      const b = ownedBusinesses(state, n).find(x => x.kind !== 'manor' && isHiring(state, x));
      if (!b) return undefined;
      return say(`${fullName(n)} t'aborde : « Je cherche des bras à ${b.name}, ${b.wage} d de l'heure. Passe me voir si ça te dit. »`, 1);
    }
    case 'invite': {
      p.needs.social = clamp(p.needs.social + 15, 0, 100);
      modifyRelation(state, n.id, p.id, 1, 1);
      modifyRelation(state, p.id, n.id, 2, 1);
      return say(`${fullName(n)} t'attrape par l'épaule : « Viens donc t'asseoir un moment ! » Vous bavardez de tout et de rien.`, 1);
    }
  }
}

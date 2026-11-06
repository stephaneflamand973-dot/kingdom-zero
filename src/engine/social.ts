// ─────────────────────────────────────────────────────────────
// Relations sociales, interactions entre PNJ, circulation des rumeurs, réputation.
// ─────────────────────────────────────────────────────────────
import { getEvent, learnEvent, logEvent } from './events';
import { chance, rand, shuffled } from './rng';
import type { Character, GameState, Relation, WorldEvent } from './types';
import { clamp, fullName, hasTrait } from './util';

const NEUTRAL: Relation = { affinity: 0, trust: 0, lastInteraction: -1 };

/** Opinion de `fromId` envers `toId` (asymétrique). */
export function getRelation(state: GameState, fromId: string, toId: string): Relation {
  return state.characters[fromId]?.relations[toId] ?? NEUTRAL;
}

export function modifyRelation(state: GameState, fromId: string, toId: string, dAffinity: number, dTrust: number): Relation {
  const c = state.characters[fromId];
  if (!c || fromId === toId) return NEUTRAL;
  const r = c.relations[toId] ?? (c.relations[toId] = { affinity: 0, trust: 0, lastInteraction: -1 });
  r.affinity = Math.round(clamp(r.affinity + dAffinity, -100, 100));
  r.trust = Math.round(clamp(r.trust + dTrust, -100, 100));
  r.lastInteraction = state.time;
  return r;
}

export function relationLabel(r: Relation): string {
  const a = r.affinity;
  if (a >= 60) return 'Ami proche';
  if (a >= 30) return 'Ami';
  if (a >= 10) return 'Cordial';
  if (a > -10) return 'Neutre';
  if (a > -30) return 'Méfiant';
  if (a > -60) return 'Rival';
  return 'Ennemi';
}

/** Compatibilité de tempérament entre deux personnes (-1..1). */
export function compatibility(a: Character, b: Character): number {
  let s = 0;
  if (hasTrait(a, 'sociable') && hasTrait(b, 'sociable')) s += 0.4;
  if (hasTrait(a, 'colerique') || hasTrait(b, 'colerique')) s -= 0.35;
  if (hasTrait(a, 'honnete') && hasTrait(b, 'malhonnete')) s -= 0.3;
  if (hasTrait(b, 'honnete') && hasTrait(a, 'malhonnete')) s -= 0.3;
  if (hasTrait(a, 'genereux') || hasTrait(b, 'genereux')) s += 0.2;
  if (hasTrait(a, 'travailleur') && hasTrait(b, 'paresseux')) s -= 0.2;
  if (a.profession === b.profession) s += 0.15;
  return clamp(s, -1, 1);
}

/** Effet d'un événement appris sur l'opinion du témoin envers l'acteur. */
export function applyBeliefEffect(state: GameState, knowerId: string, ev: WorldEvent): void {
  if (!ev.actorId || ev.actorId === knowerId) return;
  switch (ev.type) {
    case 'theft_caught': modifyRelation(state, knowerId, ev.actorId, -10, -22); break;
    case 'help': case 'gift': if (ev.targetId !== knowerId) modifyRelation(state, knowerId, ev.actorId, 4, 3); break;
    case 'insult': if (ev.targetId !== knowerId) modifyRelation(state, knowerId, ev.actorId, -3, -1); break;
    case 'fire': modifyRelation(state, knowerId, ev.actorId, -2, -1); break;
    case 'unpaid': modifyRelation(state, knowerId, ev.actorId, -2, -4); break;
    case 'fine': break;
    case 'default': modifyRelation(state, knowerId, ev.actorId, -2, -12); break;
    case 'loan_repaid': if (ev.targetId !== knowerId) modifyRelation(state, knowerId, ev.actorId, 0, 4); break;
    case 'work_praise': case 'order_done': modifyRelation(state, knowerId, ev.actorId, 1, 3); break;
    case 'order_failed': modifyRelation(state, knowerId, ev.actorId, 0, -4); break;
    case 'seizure': if (ev.targetId !== knowerId) modifyRelation(state, knowerId, ev.actorId, -3, 0); break; // on n'aime pas les usuriers
    case 'slander':
      // rumeur de seconde main : on croit à moitié le colporteur
      if (ev.targetId && ev.targetId !== knowerId && getRelation(state, knowerId, ev.targetId).affinity < 30) modifyRelation(state, knowerId, ev.targetId, -2, -4);
      break;
  }
}

/** Le locuteur transmet une nouvelle que l'auditeur ignore. Renvoie l'événement partagé. */
export function shareRumor(state: GameState, speaker: Character, listener: Character): WorldEvent | undefined {
  const rel = getRelation(state, speaker.id, listener.id);
  if (rel.affinity < -20) return undefined; // on ne se confie pas à un ennemi
  const candidates = speaker.knownEvents
    .filter(id => !listener.knownEvents.includes(id))
    .map(id => getEvent(state, id))
    .filter((e): e is WorldEvent => !!e && e.importance >= 2 && e.type !== 'rumor')
    // ne pas colporter de ragots sur l'auditeur lui-même
    .filter(e => e.actorId !== listener.id || e.type === 'death');
  if (!candidates.length) return undefined;
  // les nouvelles les plus graves et récentes circulent en priorité
  candidates.sort((a, b) => b.importance - a.importance || b.time - a.time);
  const ev = candidates[Math.min(candidates.length - 1, Math.floor(rand(state) * Math.min(3, candidates.length)))];
  if (learnEvent(state, listener.id, ev.id)) {
    applyBeliefEffect(state, listener.id, ev);
    return ev;
  }
  return undefined;
}

/** Interactions des personnes qui se trouvent ensemble à la taverne (ou en conversation). */
export function socialHour(state: GameState, group: Character[], onPair?: (a: Character, b: Character) => void, bonus = 0): void {
  if (group.length < 2) return;
  const order = shuffled(state, group);
  for (let i = 0; i + 1 < order.length; i += 2) {
    const a = order[i], b = order[i + 1];
    if (a.isPlayer || b.isPlayer) continue; // le joueur agit par ses propres actions
    const comp = compatibility(a, b);
    const roll = rand(state) * 2 - 1;
    const delta = Math.round(3 * comp + 2 * roll + 1 + bonus);
    const before = getRelation(state, a.id, b.id).affinity;
    modifyRelation(state, a.id, b.id, delta, delta > 0 ? 1 : 0);
    modifyRelation(state, b.id, a.id, delta, delta > 0 ? 1 : 0);
    a.needs.social = clamp(a.needs.social + 12, 0, 100);
    b.needs.social = clamp(b.needs.social + 12, 0, 100);
    state.stats.npcActions += 1;
    // Rumeurs (les bavards en colportent davantage)
    shareRumor(state, a, b);
    shareRumor(state, b, a);
    if (hasTrait(a, 'bavard')) shareRumor(state, a, b);
    if (hasTrait(b, 'bavard')) shareRumor(state, b, a);
    onPair?.(a, b);
    onPair?.(b, a);
    const beforeB = before;
    // Dispute : tempéraments explosifs et relation déjà dégradée
    const rab = getRelation(state, a.id, b.id);
    if ((hasTrait(a, 'colerique') || hasTrait(b, 'colerique')) && rab.affinity < -10 && chance(state, 0.25)) {
      modifyRelation(state, a.id, b.id, -10, -5);
      modifyRelation(state, b.id, a.id, -10, -5);
      logEvent(state, {
        type: 'argument', actorId: hasTrait(a, 'colerique') ? a.id : b.id, targetId: hasTrait(a, 'colerique') ? b.id : a.id,
        locationId: a.locationId, importance: 2,
        text: `${fullName(a)} et ${fullName(b)} se disputent violemment à ${state.locations[a.locationId].name}.`,
        witnesses: group.map(g => g.id),
      });
    } else if (beforeB > -30 && rab.affinity <= -30 && !a.knownEvents.some(id => { const e = getEvent(state, id); return e?.type === 'rivalry' && ((e.actorId === a.id && e.targetId === b.id) || (e.actorId === b.id && e.targetId === a.id)); })) {
      logEvent(state, {
        type: 'rivalry', actorId: a.id, targetId: b.id, locationId: a.locationId, importance: 2,
        text: `${fullName(a)} et ${fullName(b)} ne se supportent plus : une rivalité est née.`,
        witnesses: group.map(g => g.id),
      });
    } else if (before < 30 && rab.affinity >= 30) {
      logEvent(state, {
        type: 'friendship', actorId: a.id, targetId: b.id, locationId: a.locationId, importance: 2,
        text: `${fullName(a)} et ${fullName(b)} sont devenus amis au fil des soirées.`,
        witnesses: group.map(g => g.id),
      });
    }
  }
}

/** Réputation locale : moyenne des opinions de ceux qui connaissent la personne. */
export function reputation(state: GameState, targetId: string): { score: number; known: number } {
  let sum = 0, n = 0;
  for (const id of state.characterOrder) {
    const c = state.characters[id];
    if (!c.alive || id === targetId) continue;
    const r = c.relations[targetId];
    if (!r) continue;
    sum += (r.affinity + r.trust) / 2;
    n++;
  }
  return { score: n ? Math.round(sum / n) : 0, known: n };
}

export function reputationLabel(score: number, known: number): string {
  if (known === 0) return 'Inconnu';
  if (score >= 35) return 'Respecté';
  if (score >= 12) return 'Apprécié';
  if (score > -12) return 'Ordinaire';
  if (score > -35) return 'Mal vu';
  return 'Méprisé';
}

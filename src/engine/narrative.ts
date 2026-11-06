// Narration : phrases générées exclusivement à partir de l'état simulé.
import { getEvent } from './events';
import { getRelation, relationLabel } from './social';
import type { Character, GameState, WorldEvent } from './types';
import { fullName } from './util';

/** Raison concrète pour laquelle `who` se méfie du joueur (ou d'un autre). */
export function grievance(state: GameState, who: Character, aboutId: string): string | null {
  const evs = who.knownEvents.map(id => getEvent(state, id)).filter((e): e is WorldEvent => !!e && e.actorId === aboutId);
  evs.sort((a, b) => b.time - a.time);
  for (const e of evs) {
    if (e.type === 'theft_caught') {
      const where = e.businessId ? state.businesses[e.businessId]?.name : 'au village';
      return e.witnesses.includes(who.id) ? `Il t'a vu voler à ${where}` : `On lui a raconté que tu as volé à ${where}`;
    }
    if (e.type === 'insult' && e.targetId === who.id) return 'Depuis que tu l’as insulté, il ne te fait plus confiance';
    if (e.type === 'insult') return 'Il a entendu parler de tes insultes';
  }
  return null;
}

export function pronoun(c: Character): { il: string; le: string; e: string } {
  return c.sex === 'F' ? { il: 'elle', le: 'la', e: 'e' } : { il: 'il', le: 'le', e: '' };
}

export function fem(c: Character, text: string): string {
  if (c.sex !== 'F') return text;
  return text.replace(/\bIl\b/g, 'Elle').replace(/\bil\b/g, 'elle').replace(/\bl'as insulté\b/g, "l'as insultée").replace(/\bl’as insulté\b/g, 'l’as insultée');
}

export function refusalText(state: GameState, owner: Character, verb = 'commercer avec toi'): string {
  const why = grievance(state, owner, state.playerId);
  const r = getRelation(state, owner.id, state.playerId);
  const base = `${fullName(owner)} refuse de ${verb}.`;
  if (why) return fem(owner, `${base} ${why}.`);
  if (r.trust <= -35) return fem(owner, `${base} Il ne te fait pas confiance (confiance ${r.trust}).`);
  return fem(owner, `${base} Il ne te supporte pas (${relationLabel(r).toLowerCase()}).`);
}

export function greeting(state: GameState, npc: Character): string {
  const r = getRelation(state, npc.id, state.playerId);
  const name = npc.firstName;
  if (npc.activity.kind === 'sleep') return `${name} dort profondément.`;
  if (r.lastInteraction < 0 && r.affinity === 0) return `${name} te dévisage : un étranger au village.`;
  if (r.affinity >= 40) return `${name} t'accueille avec un large sourire.`;
  if (r.affinity >= 12) return `${name} te salue amicalement.`;
  if (r.affinity > -12) return `${name} t'adresse un signe de tête.`;
  if (r.affinity > -40) return `${name} te regarde avec méfiance.`;
  return `${name} te toise avec hostilité.`;
}

export function moodOf(c: Character): string {
  if (!c.alive) return 'Décédé';
  if (c.sick > 0) return 'Malade';
  if (c.needs.hunger >= 85) return 'Affamé';
  if (c.needs.energy <= 15) return 'Épuisé';
  if (c.unpaidWages > 0) return 'Amer';
  if (c.needs.hunger >= 60) return 'A faim';
  if (c.needs.social <= 20) return 'Seul';
  if (c.needs.social >= 70 && c.needs.hunger < 40) return 'Content';
  return 'Serein';
}

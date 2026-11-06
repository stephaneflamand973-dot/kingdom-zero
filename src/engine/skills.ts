// Progression des compétences : apprentissage par la pratique, rendements décroissants.
import { logEvent } from './events';
import { SKILL_NAMES } from './data';
import type { Character, GameState, SkillId } from './types';

export function xpForNextLevel(level: number): number { return 6 + level * 0.6; }

export function gainXp(state: GameState, c: Character, skill: SkillId, amount: number): number {
  if (c.skills[skill] >= 100) return 0;
  const learn = amount * (0.6 + c.attributes.intelligence * 0.08);
  c.skillXp[skill] = (c.skillXp[skill] ?? 0) + learn;
  let gained = 0;
  while ((c.skillXp[skill] ?? 0) >= xpForNextLevel(c.skills[skill]) && c.skills[skill] < 100) {
    c.skillXp[skill]! -= xpForNextLevel(c.skills[skill]);
    c.skills[skill] += 1;
    gained++;
  }
  if (gained && c.isPlayer) {
    logEvent(state, { type: 'production', actorId: c.id, importance: 1,
      text: `Ta compétence ${SKILL_NAMES[skill]} progresse (${c.skills[skill]}).` });
  }
  return gained;
}

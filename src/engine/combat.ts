// ─────────────────────────────────────────────────────────────
// Combat au tour par tour (phase 4). Utilisé pour les embuscades, les arrestations,
// les batailles et les complots. Les blessures sont réelles : elles retirent de la santé,
// et un combattant à terre peut mourir si l'affrontement est meurtrier.
// ─────────────────────────────────────────────────────────────
import { rand, randInt } from './rng';
import type { Character, GameState } from './types';
import { clamp, fullName } from './util';
import { gearBonus } from './gear';

export interface Fighter {
  id: string; name: string; hp: number; attack: number; defense: number;
  /** Posture du tour (phase 12) : bonus de précision, multiplicateur de dégâts, garde contre les coups reçus. */
  hitMod?: number; dmgMul?: number; guard?: number; holds?: boolean;
}

export function fighterOf(c: Character): Fighter {
  const fatigue = c.needs.energy < 20 ? 0.8 : 1;
  const gear = gearBonus(c); // armes et armures (phase 10)
  return {
    id: c.id, name: fullName(c), hp: Math.round(c.health),
    attack: (4 + c.skills.combat / 8 + c.attributes.force * 0.8) * fatigue * (c.sick > 0 ? 0.7 : 1) + gear.attack,
    defense: 2 + c.skills.combat / 12 + c.attributes.agilite * 0.5 + gear.defense,
  };
}

/** Force militaire d'un groupe (pour les décisions : comparer avant d'attaquer). */
export function strength(fighters: Fighter[]): number {
  return fighters.reduce((s, f) => s + (f.attack + f.defense) * (f.hp / 100), 0);
}

export interface RoundLog { text: string }

/** Un échange de coups : chaque combattant debout frappe un adversaire debout. */
export function exchange(state: GameState, a: Fighter[], b: Fighter[], log: string[]): void {
  const strike = (atk: Fighter, targets: Fighter[]) => {
    const alive = targets.filter(t => t.hp > 0);
    if (!alive.length || atk.hp <= 0 || atk.holds) return;
    const t = alive[Math.floor(rand(state) * alive.length)];
    const hit = clamp(0.55 + (atk.attack - t.defense) * 0.04 + (atk.hitMod ?? 0) - (t.guard ?? 0), 0.15, 0.9);
    if (rand(state) < hit) {
      const dmg = Math.max(1, Math.round((randInt(state, 3, 8) + atk.attack * 0.4 - t.defense * 0.3) * (atk.dmgMul ?? 1)));
      t.hp = Math.max(0, t.hp - dmg);
      log.push(`${atk.name} touche ${t.name} (−${dmg})${t.hp === 0 ? ` : ${t.name} s'effondre` : ''}.`);
    } else log.push(`${t.name} esquive ${atk.name}.`);
  };
  for (const f of a) strike(f, b);
  for (const f of b) strike(f, a);
}

export interface BattleResult { winner: 'a' | 'b' | 'none'; rounds: number; log: string[] }

/** Combat automatique jusqu'à la déroute (moitié des forces à terre ou en fuite) ou la limite de tours. */
export function autoBattle(state: GameState, a: Fighter[], b: Fighter[], maxRounds = 8): BattleResult {
  const log: string[] = [];
  const startA = a.reduce((s, f) => s + f.hp, 0), startB = b.reduce((s, f) => s + f.hp, 0);
  let r = 0;
  for (; r < maxRounds; r++) {
    exchange(state, a, b, log);
    const hpA = a.reduce((s, f) => s + f.hp, 0), hpB = b.reduce((s, f) => s + f.hp, 0);
    const brokeA = hpA <= startA * 0.5 || a.every(f => f.hp === 0);
    const brokeB = hpB <= startB * 0.5 || b.every(f => f.hp === 0);
    if (brokeA && brokeB) return { winner: hpA >= hpB ? 'a' : 'b', rounds: r + 1, log };
    if (brokeB) return { winner: 'a', rounds: r + 1, log };
    if (brokeA) return { winner: 'b', rounds: r + 1, log };
  }
  return { winner: 'none', rounds: r, log };
}

/**
 * Reporte les blessures du combat sur les personnages.
 * Un combattant à terre meurt avec la probabilité `lethality` ; sinon il reste gravement blessé.
 * Renvoie les identifiants des morts (le décès lui-même est confié à l'appelant).
 */
export function applyWounds(state: GameState, fighters: Fighter[], lethality: number): string[] {
  const dead: string[] = [];
  for (const f of fighters) {
    const c = state.characters[f.id];
    if (!c || !c.alive) continue;
    if (f.hp <= 0 && rand(state) < lethality) { dead.push(c.id); continue; }
    c.health = clamp(Math.max(f.hp, f.hp <= 0 ? 5 : f.hp), 0, 100);
  }
  return dead;
}

// ── Postures (phase 12) ──────────────────────────────────────

export type Stance = 'fight' | 'strike' | 'guard' | 'feint';

export const STANCES: Record<Stance, { label: string; hint: string }> = {
  fight: { label: 'Frapper', hint: 'un échange de coups' },
  strike: { label: 'Coup puissant', hint: 'dégâts ×1,6, moins précis, garde ouverte' },
  guard: { label: 'Parer', hint: 'encaisse moins, frappe à moitié' },
  feint: { label: 'Feinter', hint: 'Agilité, Intelligence : réussie, le coup porte presque à coup sûr' },
};

/**
 * Applique la posture choisie au combattant du joueur pour ce tour. Une feinte se joue
 * contre l'adversaire le plus aguerri : réussie, elle ouvre sa garde ; manquée, elle laisse sans riposte.
 */
export function applyStance(state: GameState, f: Fighter, c: Character, stance: Stance, foes: Character[], log: string[]): void {
  if (stance === 'strike') { f.hitMod = -0.12; f.dmgMul = 1.6; f.guard = -0.08; }
  else if (stance === 'guard') { f.hitMod = -0.05; f.dmgMul = 0.5; f.guard = 0.25; }
  else if (stance === 'feint') {
    const best = Math.max(0, ...foes.map(o => o.skills.combat));
    const p = clamp(0.4 + (c.attributes.agilite + c.attributes.intelligence - 10) * 0.03 + c.skills.combat / 200 - best / 250, 0.15, 0.85);
    if (rand(state) < p) { f.hitMod = 0.3; f.dmgMul = 1.25; f.guard = 0.1; log.push(`${f.name} feinte et trouve l'ouverture.`); }
    else { f.holds = true; f.guard = -0.1; log.push(`La feinte de ${f.name} est éventée.`); }
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 14 — Le savoir-faire compte.
// Les compétences du propriétaire agissent sur toute son affaire (et pas seulement sur ses
// propres heures de travail) ; le commandement sert enfin à mener des hommes.
// Tout reste déterministe (pas de tirage) et l'économie reste fermée : les biens « en plus »
// d'un maître sont comptés dans le registre de production, comme toute fournée.
// ─────────────────────────────────────────────────────────────
import { SKILL_NAMES, WORK_SKILL } from './data';
import type { Business, Character, GameState, SkillId } from './types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function ownerOf(state: GameState, b: Business): Character | undefined {
  const o = b.ownerId ? state.characters[b.ownerId] : undefined;
  return o?.alive ? o : undefined;
}

/** Compétence du métier de l'affaire (artisanat pour un fournil ou une forge, agriculture pour une ferme…). */
export function craftSkillOf(b: Business): SkillId { return WORK_SKILL[b.kind]; }

/** Un maître dirige l'atelier : tout le travail y rend davantage (−8 % pour un novice, jusqu'à +28 % à 100). */
export function masterLabor(state: GameState, b: Business): number {
  const o = ownerOf(state, b);
  if (!o || b.kind === 'manor' || b.kind === 'market') return 1;
  return 1 + clamp((o.skills[craftSkillOf(b)] - 30) / 250, -0.08, 0.28);
}

/** Tour de main : à partir de 50, une fournée sur dix (puis jusqu'à une sur trois à 100) donne une pièce de plus. */
export function masterBonusRate(state: GameState, b: Business): number {
  const o = ownerOf(state, b);
  if (!o || b.kind === 'manor' || b.kind === 'market') return 0;
  const s = o.skills[craftSkillOf(b)];
  return s < 50 ? 0 : 0.1 + (s - 50) * 0.0047; // 10 % à 50, ~33 % à 100
}

/** Qualité : l'ouvrage d'un maître se vend plus cher (jusqu'à +12 % à 100) et les clients le préfèrent. */
export function qualityPremium(state: GameState, b: Business): number {
  const o = ownerOf(state, b);
  if (!o || b.kind === 'manor' || b.kind === 'market') return 0;
  return clamp((o.skills[craftSkillOf(b)] - 30) / 600, -0.03, 0.12);
}

/** Bonne gestion : outils ménagés (usure −35 % au plus) et stocks mieux tenus (pertes −60 % au plus). */
export function gestionWear(state: GameState, b: Business): number {
  const o = ownerOf(state, b);
  return o ? 1 - clamp((o.skills.gestion - 20) / 230, 0, 0.35) : 1;
}
export function gestionSpoil(state: GameState, b: Business): number {
  const o = ownerOf(state, b);
  return o ? 1 - clamp((o.skills.gestion - 20) / 130, 0, 0.6) : 1;
}

/** Sens du négoce : le propriétaire vend un peu plus cher et rachète un peu moins cher (±5 % au plus). */
export function commerceMargin(state: GameState, b: Business): number {
  const o = ownerOf(state, b);
  if (!o) return 0;
  return clamp((o.skills.commerce - 30) / 1400, -0.02, 0.05);
}

/** Commandement : les hommes qu'on mène frappent plus fort et tiennent mieux. */
export function commandBonus(leader: Character | undefined): { attack: number; defense: number } {
  if (!leader?.alive) return { attack: 0, defense: 0 };
  const c = leader.skills.commandement;
  return { attack: Math.round(c / 20 * 10) / 10, defense: Math.round(c / 40 * 10) / 10 }; // +5 / +2,5 à 100
}

/** Hommes supplémentaires qu'un chef peut mener (escorte et garnison) : un par tranche de 25 en commandement. */
export function commandExtra(c: Character): number { return Math.floor(c.skills.commandement / 25); }

/** Un forgeron aguerri (artisanat 50) forge lui-même ses armes : il ne paie que le métal et l'usage de la forge. */
export const SELF_FORGE_SKILL = 50;

/** Ce que les compétences du propriétaire apportent à cette affaire, en clair. */
export function masteryNotes(state: GameState, b: Business): string[] {
  const o = ownerOf(state, b);
  if (!o) return [];
  const out: string[] = [];
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)} %`;
  if (b.kind !== 'market' && b.kind !== 'manor') {
    const s = craftSkillOf(b);
    const rate = masterBonusRate(state, b);
    out.push(`${SKILL_NAMES[s]} ${o.skills[s]} : rendement de l’atelier ${pct(masterLabor(state, b) - 1)}, qualité ${pct(qualityPremium(state, b))} sur le prix${qualityPremium(state, b) > 0 ? ' (les clients la préfèrent)' : qualityPremium(state, b) < 0 ? ' (un ouvrage de novice : les clients vont ailleurs à prix égal)' : ''}${rate > 0 ? `, une pièce de plus toutes les ${Math.max(1, Math.round(1 / rate))} fournées` : ' (tour de main à 50)'}`);
    out.push(`Gestion ${o.skills.gestion} : usure des outils ${pct(gestionWear(state, b) - 1)}, pertes en réserve ${pct(gestionSpoil(state, b) - 1)}`);
  } else out.push(`Gestion ${o.skills.gestion} : pertes en réserve ${pct(gestionSpoil(state, b) - 1)}`);
  out.push(`Commerce ${o.skills.commerce} : prix de vente ${pct(commerceMargin(state, b))}, prix de rachat ${pct(-commerceMargin(state, b))}`);
  return out;
}

/** Ce que chaque compétence apporte au personnage (affiché dans sa fiche). */
export const SKILL_EFFECTS: Record<SkillId, string> = {
  agriculture: 'Rendement aux champs, au bois et à la mine ; propriétaire d’une ferme : tout l’atelier rend plus ; cueillette.',
  artisanat: 'Rendement au fournil et à la forge ; propriétaire : rendement de l’atelier et pièces en plus dès 50 ; dès 50, tu forges tes armes au prix du métal.',
  commerce: 'Meilleurs prix à l’achat et à la vente ; propriétaire : ton affaire vend plus cher et rachète moins cher.',
  combat: 'Attaque, défense, feintes ; tournois ; entrée dans les garnisons.',
  diplomatie: 'Conversations, parlementer, audiences, cour ; augmentations de salaire.',
  discretion: 'Larcins sans être vu.',
  gestion: 'Promotion au rang de contremaître ; propriétaire : outils ménagés, moins de pertes en réserve.',
  commandement: 'Tes hommes d’armes, tes soldats et ta maison frappent plus fort et tiennent mieux ; un homme de plus par 25 points.',
};

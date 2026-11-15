// ─────────────────────────────────────────────────────────────
// Phase 8 — Carrière. Un métier se gravit : apprenti, compagnon, maître,
// contremaître. L'apprentissage ouvre tous les ateliers (même sans
// expérience), chaque grade augmente nettement le salaire, on peut demander
// une augmentation, et le contremaître reprend l'affaire d'un patron mort
// sans héritier. Tout repose sur la compétence réelle, l'ancienneté et la
// relation avec le patron.
// ─────────────────────────────────────────────────────────────
import { MIN_SKILL_FOR_DAYWORK, SKILL_NAMES, WORK_SKILL } from './data';
import { P, reserveFor, transferMoney } from './economy';
import { logEvent } from './events';
import { finish } from './player';
import { getRelation, modifyRelation } from './social';
import { rand } from './rng';
import { xpForNextLevel } from './skills';
import { toDate } from './time';
import type { ActionResult, Business, Character, GameState, Grade, JobContract, SkillId } from './types';
import { fullName } from './util';

export const GRADES: Grade[] = ['apprenti', 'compagnon', 'maitre', 'contremaitre'];
export const GRADE_NAMES: Record<Grade, string> = { apprenti: 'Apprenti', compagnon: 'Compagnon', maitre: 'Maître', contremaitre: 'Contremaître' };
export const MASTER_SKILL = 45;
export const FOREMAN_SKILL = 65;
export const FOREMAN_GESTION = 12;
export const RAISE_COOLDOWN_DAYS = 28;

/** Compétence à partir de laquelle un atelier vous prend comme compagnon (en dessous : apprenti). */
export function journeymanSkill(b: Business): number { return MIN_SKILL_FOR_DAYWORK[b.kind] + 5; }

export function gradeOf(k: JobContract): Grade { return k.grade ?? 'compagnon'; }

/** Grade mérité : compétence réelle, semaines de travail satisfaisantes, et sens de la gestion pour diriger. */
export function eligibleGrade(b: Business, p: Character, goodWeeks: number): Grade {
  const s = p.skills[WORK_SKILL[b.kind]];
  if (s < journeymanSkill(b)) return 'apprenti';
  if (s >= FOREMAN_SKILL && goodWeeks >= 10 && p.skills.gestion >= FOREMAN_GESTION) return 'contremaitre';
  if (s >= MASTER_SKILL && goodWeeks >= 4) return 'maitre';
  return 'compagnon';
}

/** Salaire horaire d'un grade : il double à peu près entre le compagnon débutant et le contremaître. */
export function gradeWage(b: Business, p: Character, grade: Grade): number {
  const s = p.skills[WORK_SKILL[b.kind]];
  const base = Math.max(3, b.wage); // les gages d'un homme de métier ne suivent pas les creux du salaire journalier
  switch (grade) {
    case 'apprenti': return Math.max(1, Math.round(base * 0.5));
    case 'compagnon': return Math.max(2, Math.round(base * (0.85 + s / 100)));
    case 'maitre': return Math.max(5, Math.round(base * (1.6 + s / 100)));
    case 'contremaitre': return Math.max(7, Math.round(base * (2.3 + s / 100)));
  }
}

/** Grade accordé à l'embauche : celui que la compétence justifie, sans redescendre sous un grade déjà obtenu (jusqu'à maître). */
export function hiringGrade(b: Business, p: Character): Grade {
  const earned = eligibleGrade(b, p, 0);
  if (earned === 'apprenti') return 'apprenti';
  const held = p.gradeHeld?.[WORK_SKILL[b.kind]];
  return (held === 'maitre' || held === 'contremaitre') && p.skills[WORK_SKILL[b.kind]] >= MASTER_SKILL ? 'maitre' : earned;
}

/** Vitesse d'apprentissage au travail : l'apprenti apprend vite, et l'on apprend mieux auprès d'un maître. */
export function learningRate(state: GameState, c: Character, b: Business): number {
  if (!c.isPlayer) return 1;
  const k = state.contracts.find(x => x.status === 'active' && x.workerId === c.id && x.businessId === b.id);
  if (!k) return 1;
  const owner = b.ownerId && b.ownerId !== c.id ? state.characters[b.ownerId] : undefined;
  const skill = WORK_SKILL[b.kind];
  const taught = !!owner?.alive && owner.skills[skill] >= c.skills[skill] + 10;
  return gradeOf(k) === 'apprenti' ? (taught ? 1.8 : 1.5) : taught ? 1.3 : 1;
}

export interface CareerStatus {
  contract: JobContract; business: Business; grade: Grade; skill: SkillId; level: number; xp: number; xpNeeded: number;
  wage: number; rate: number; next?: { grade: Grade; wage: number; needs: { label: string; ok: boolean }[] };
  raiseInDays: number;
}

/** Tout ce que l'interface affiche de la carrière du joueur : grade, progression, étape suivante. */
export function careerStatus(state: GameState): CareerStatus | undefined {
  const p = state.characters[state.playerId];
  const k = state.contracts.find(x => x.status === 'active' && x.workerId === p.id);
  if (!k) return undefined;
  const b = state.businesses[k.businessId];
  const skill = WORK_SKILL[b.kind];
  const grade = gradeOf(k);
  const level = p.skills[skill];
  const day = toDate(state.time).day;
  const idx = GRADES.indexOf(grade);
  let next: CareerStatus['next'];
  if (idx < GRADES.length - 1) {
    const g = GRADES[idx + 1];
    const needs = g === 'compagnon' ? [{ label: `${SKILL_NAMES[skill]} ${level}/${journeymanSkill(b)}`, ok: level >= journeymanSkill(b) }]
      : g === 'maitre' ? [{ label: `${SKILL_NAMES[skill]} ${level}/${MASTER_SKILL}`, ok: level >= MASTER_SKILL }, { label: `semaines satisfaisantes ${k.goodWeeks}/4`, ok: k.goodWeeks >= 4 }]
      : [{ label: `${SKILL_NAMES[skill]} ${level}/${FOREMAN_SKILL}`, ok: level >= FOREMAN_SKILL }, { label: `semaines satisfaisantes ${k.goodWeeks}/10`, ok: k.goodWeeks >= 10 }, { label: `Gestion ${p.skills.gestion}/${FOREMAN_GESTION} (s'apprend en secondant le patron, une fois maître)`, ok: p.skills.gestion >= FOREMAN_GESTION }];
    next = { grade: g, wage: gradeWage(b, p, g) + (k.raises ?? 0), needs };
  }
  return { contract: k, business: b, grade, skill, level, xp: p.skillXp[skill] ?? 0, xpNeeded: xpForNextLevel(level), wage: k.wage, rate: learningRate(state, p, b), next,
    raiseInDays: Math.max(0, (k.lastRaiseDay ?? k.startDay) + RAISE_COOLDOWN_DAYS - day) };
}

/** Revue hebdomadaire d'une bonne semaine : promotion éventuelle, salaire remis à niveau, prime du contremaître. */
export function careerReview(state: GameState, k: JobContract, b: Business, w: Character, chronicleFn?: (text: string) => void): void {
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  const boss = owner ? fullName(owner) : "L'intendance";
  const before = gradeOf(k);
  const earned = eligibleGrade(b, w, k.goodWeeks);
  if (GRADES.indexOf(earned) > GRADES.indexOf(before)) {
    k.grade = earned;
    (w.gradeHeld ??= {})[WORK_SKILL[b.kind]] = earned;
    const wage = gradeWage(b, w, earned) + (k.raises ?? 0);
    const text = `${boss} élève ${fullName(w)} au grade de ${GRADE_NAMES[earned].toLowerCase()} à ${b.name} (${Math.max(k.wage, wage)} d de l'heure).`;
    logEvent(state, { type: 'promotion', actorId: w.id, targetId: owner?.id, businessId: b.id, importance: 3, locationId: b.locationId, text, witnesses: [...b.employees, ...(owner ? [owner.id] : [])] });
    chronicleFn?.(text);
    if (owner) modifyRelation(state, w.id, owner.id, 6, 6);
  } else k.grade = before;
  const fair = gradeWage(b, w, gradeOf(k)) + (k.raises ?? 0);
  if (fair > k.wage) {
    k.wage = fair;
    logEvent(state, { type: 'contract', actorId: w.id, businessId: b.id, importance: 1, text: `Ton salaire à ${b.name} passe à ${fair} d de l'heure.` });
  }
  // prime du contremaître : une part des bénéfices qui dépassent la réserve de l'affaire
  if (gradeOf(k) === 'contremaitre') {
    const bonus = Math.floor(Math.max(0, b.treasury - reserveFor(b) * 1.5) * 0.05);
    if (bonus > 0 && transferMoney(state, P.b(b.id), P.c(w.id), bonus)) {
      logEvent(state, { type: 'dividend', actorId: w.id, businessId: b.id, importance: 2, text: `Prime de contremaître : ${bonus} d sur les bénéfices de ${b.name}.`, witnesses: owner ? [owner.id] : [] });
    }
  }
}

/** Demander une augmentation : dépend de la confiance du patron, de l'ancienneté, de la diplomatie et de la caisse. */
export function raiseChance(state: GameState, k: JobContract): number {
  const b = state.businesses[k.businessId];
  const p = state.characters[k.workerId];
  const rel = b.ownerId ? getRelation(state, b.ownerId, p.id) : { trust: 10, affinity: 0 };
  const score = rel.trust * 0.5 + rel.affinity * 0.2 + k.goodWeeks * 3 + p.skills.diplomatie * 0.4 + (b.treasury > reserveFor(b) * 2 ? 15 : b.treasury < reserveFor(b) ? -25 : 0) - (k.raises ?? 0) * 14;
  return Math.max(0.03, Math.min(0.95, (score - 20) / 40));
}

export function askRaise(state: GameState): ActionResult {
  if (state.gameOver || state.pendingSuccession || state.encounter) return { ok: false, message: 'Ce n’est pas le moment.', minutes: 0 };
  const p = state.characters[state.playerId];
  const k = state.contracts.find(x => x.status === 'active' && x.workerId === p.id);
  if (!k) return { ok: false, message: 'Tu n’as pas de place.', minutes: 0 };
  const b = state.businesses[k.businessId];
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  if (gradeOf(k) === 'apprenti') return { ok: false, message: 'Un apprenti ne discute pas ses gages : deviens d’abord compagnon.', minutes: 0 };
  const day = toDate(state.time).day;
  const wait = (k.lastRaiseDay ?? k.startDay) + RAISE_COOLDOWN_DAYS - day;
  if (wait > 0) return { ok: false, message: `Trop tôt pour en reparler : attends encore ${wait} jour${wait > 1 ? 's' : ''}.`, minutes: 0 };
  if (owner && (!owner.alive || owner.locationId !== p.locationId)) return { ok: false, message: `Il faut en parler à ${owner.firstName} en personne.`, minutes: 0 };
  k.lastRaiseDay = day;
  const boss = owner ? owner.firstName : "L'intendant";
  if (rand(state) < raiseChance(state, k)) {
    k.raises = (k.raises ?? 0) + 1;
    k.wage += 1;
    logEvent(state, { type: 'contract', actorId: p.id, targetId: owner?.id, businessId: b.id, importance: 2, text: `${fullName(p)} obtient une augmentation à ${b.name} : ${k.wage} d de l'heure.`, witnesses: owner ? [owner.id] : [] });
    finish(state, p, 10);
    return { ok: true, message: `${boss} accepte : tes gages passent à ${k.wage} d de l’heure.`, minutes: 10 };
  }
  if (owner) modifyRelation(state, owner.id, p.id, -1, -2);
  finish(state, p, 10);
  return { ok: true, message: `${boss} refuse : « Pas maintenant. » Fais tes preuves et reviens dans quelques semaines.`, minutes: 10 };
}

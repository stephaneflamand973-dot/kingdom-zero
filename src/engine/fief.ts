// ─────────────────────────────────────────────────────────────
// Phase 12 — Gouverner son fief.
// Le seigneur d'une localité (le joueur à la tête de sa maison, ou un seigneur PNJ)
// fixe l'impôt, commande des aménagements payés par le trésor de sa maison
// (l'argent va réellement aux artisans et aux journaliers du lieu) et tient audience.
// ─────────────────────────────────────────────────────────────
import { P, transferMoney } from './economy';
import { logEvent } from './events';
import { orgList } from './orgs';
import { finish, guard } from './player';
import { chronicle } from './quests';
import { chance } from './rng';
import { gainXp } from './skills';
import { getRelation, modifyRelation } from './social';
import { toDate } from './time';
import type { ActionResult, GameState, Organization, Settlement, WorkId } from './types';
import { businessesIn, fullName, hasWork, residents, settlementIdOf } from './util';
import { houseOfPlayer } from './warband';

const ok = (message: string, minutes: number): ActionResult => ({ ok: true, message, minutes });
const no = (message: string): ActionResult => ({ ok: false, message, minutes: 0 });

export interface WorkDef { id: WorkId; name: string; cost: number; days: number; effect: string }

export const WORKS: Record<WorkId, WorkDef> = {
  palissade: { id: 'palissade', name: 'Palissade', cost: 250, days: 21, effect: 'les défenseurs gagnent +3 en défense quand on se bat pour la localité' },
  moulin: { id: 'moulin', name: 'Moulin banal', cost: 300, days: 28, effect: 'les fermes et le fournil du lieu produisent 15 % de plus' },
  chapelle: { id: 'chapelle', name: 'Chapelle', cost: 200, days: 21, effect: 'la grogne baisse durablement de 8 points' },
  paves: { id: 'paves', name: 'Chemins pavés', cost: 150, days: 14, effect: 'les chemins s’usent deux fois moins vite (+20 d’entretien tout de suite)' },
};
export const WORK_IDS = Object.keys(WORKS) as WorkId[];

export const TAX_MIN = 0.02, TAX_MAX = 0.15;

/** Multiplicateur de rendement dû aux aménagements (moulin banal). */
export function worksYield(state: GameState, settlementId: string, kind: string): number {
  return (kind === 'farm' || kind === 'bakery') && hasWork(state, settlementId, 'moulin') ? 1.15 : 1;
}

/** Une localité tenue par la maison du joueur, où il se trouve. */
function playerFief(state: GameState, settlementId?: string): { house?: Organization; st?: Settlement; error?: string } {
  const house = houseOfPlayer(state);
  if (!house) return { error: 'Il faut d’abord fonder ta maison et tenir une terre.' };
  const p = state.characters[state.playerId];
  const st = state.settlements[settlementId ?? settlementIdOf(state, p.locationId)];
  if (!st || st.lordHouseId !== house.id) return { error: `${st?.name ?? 'Cette localité'} ne relève pas de ${house.name}.` };
  return { house, st };
}

/** Terres de la maison du joueur. */
export function playerLands(state: GameState): Settlement[] {
  const house = houseOfPlayer(state);
  return house ? state.settlementOrder.map(id => state.settlements[id]).filter(s => s.lordHouseId === house.id) : [];
}

// ── Impôt ────────────────────────────────────────────────────

export function setFiefTax(state: GameState, settlementId: string, rate: number): ActionResult {
  const g = guard(state); if (g) return g;
  const { st, house, error } = playerFief(state, settlementId);
  if (!st || !house) return no(error!);
  const r = Math.round(Math.max(TAX_MIN, Math.min(TAX_MAX, rate)) * 100) / 100;
  if (r === st.taxRate) return no(`L’impôt de ${st.name} est déjà de ${Math.round(r * 100)} %.`);
  const p = state.characters[state.playerId];
  const old = st.taxRate;
  st.taxRate = r;
  const pop = residents(state, st.id);
  // une baisse réjouit, une hausse fâche : chaque habitant s'en souvient
  for (const c of pop) modifyRelation(state, c.id, p.id, r < old ? 2 : -3, r < old ? 1 : -1);
  logEvent(state, { type: 'tax_change', actorId: p.id, locationId: st.squareId, importance: 2,
    text: `${fullName(p)} fait passer l'impôt de ${st.name} de ${Math.round(old * 100)} % à ${Math.round(r * 100)} %.`, witnesses: pop.map(c => c.id) });
  return ok(`L’impôt de ${st.name} passe à ${Math.round(r * 100)} %. ${r > old ? 'Le trésor y gagnera, la grogne aussi.' : 'Les habitants respirent ; le trésor recevra moins.'}`, 0);
}

// ── Aménagements ─────────────────────────────────────────────

/**
 * Paie un chantier : la moitié au fournisseur de matériaux (bois, pierre, fer) du lieu,
 * l'autre aux bras sans emploi engagés pour l'occasion ; le reste à l'intendance.
 */
function payWorks(state: GameState, house: Organization, st: Settlement, cost: number): string[] {
  const supplier = businessesIn(state, st.id).filter(b => b.kind === 'woodlot' || b.kind === 'mine' || b.kind === 'forge').sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const half = Math.floor(cost / 2);
  transferMoney(state, P.o(house.id), supplier ? P.b(supplier.id) : P.b(st.manorId), half);
  const hands = residents(state, st.id).filter(c => !c.employerId && c.age >= 16 && c.age < 60 && c.health > 40 && !c.isPlayer).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 6);
  const rest = cost - half;
  const each = hands.length ? Math.floor(rest / hands.length) : 0;
  for (const c of hands) { transferMoney(state, P.o(house.id), P.c(c.id), each); c.needs.energy = Math.max(0, c.needs.energy - 10); }
  const left = rest - each * hands.length;
  if (left > 0) transferMoney(state, P.o(house.id), P.b(st.manorId), left);
  return hands.map(c => c.id);
}

/** Commande un aménagement (joueur ou seigneur PNJ). Renvoie un message d'erreur, ou rien. */
export function orderWork(state: GameState, house: Organization, st: Settlement, id: WorkId): string | undefined {
  const w = WORKS[id];
  if (st.works?.some(x => x.id === id)) return `${st.name} a déjà ${w.name.toLowerCase() === 'chemins pavés' ? 'ses chemins pavés' : `son ${w.name.toLowerCase()}`}.`;
  if (house.treasury < w.cost) return `Le trésor de ${house.name} n’a que ${house.treasury} d : il en faut ${w.cost}.`;
  const hands = payWorks(state, house, st, w.cost);
  const day = toDate(state.time).day;
  (st.works ??= []).push({ id, ready: day + w.days });
  if (id === 'paves') st.infrastructure = Math.min(100, st.infrastructure + 20);
  const lord = house.leaderId ? state.characters[house.leaderId] : undefined;
  logEvent(state, { type: 'work', actorId: lord?.id, locationId: st.squareId, importance: 2,
    text: `${lord ? fullName(lord) : house.name} fait bâtir ${id === 'paves' ? 'des chemins pavés' : `un${id === 'chapelle' || id === 'palissade' ? 'e' : ''} ${w.name.toLowerCase()}`} à ${st.name} (${w.cost} d, ${hands.length} journaliers engagés).`,
    witnesses: residents(state, st.id).map(c => c.id) });
  return undefined;
}

export function buildWork(state: GameState, id: WorkId): ActionResult {
  const g = guard(state); if (g) return g;
  const { st, house, error } = playerFief(state);
  if (!st || !house) return no(error!);
  const err = orderWork(state, house, st, id);
  if (err) return no(err);
  const p = state.characters[state.playerId];
  chronicle(state, `${fullName(p)} fait bâtir ${WORKS[id].name.toLowerCase()} à ${st.name}.`);
  finish(state, p, 60);
  return ok(`Le chantier ${id === 'paves' ? 'des chemins pavés' : `de ${WORKS[id].name.toLowerCase()}`} commence à ${st.name} (${WORKS[id].cost} d du trésor) : prêt dans ${WORKS[id].days} jours. Effet : ${WORKS[id].effect}.`, 60);
}

/** Aménagements des seigneurs PNJ : quand le trésor déborde, ils bâtissent ce qui manque le plus. */
export function npcWorks(state: GameState): void {
  for (const house of orgList(state, 'house')) {
    const lord = house.leaderId ? state.characters[house.leaderId] : undefined;
    if (!lord?.alive || lord.isPlayer || lord.traits.includes('avare')) continue;
    for (const st of state.settlementOrder.map(id => state.settlements[id]).filter(s => s.lordHouseId === house.id)) {
      const has = (id: WorkId) => !!st.works?.some(w => w.id === id);
      const threatened = orgList(state, 'house').some(h => h.claimId === st.id && h.id !== house.id);
      const want: WorkId | undefined = st.unrest >= 45 && !has('chapelle') ? 'chapelle'
        : threatened && !has('palissade') ? 'palissade'
        : st.infrastructure < 50 && !has('paves') ? 'paves'
        : !has('moulin') && st.prosperity < 65 ? 'moulin' : undefined;
      if (!want || house.treasury < WORKS[want].cost + 400 || !chance(state, 0.2)) continue;
      orderWork(state, house, st, want);
      return; // un chantier à la fois dans la région
    }
  }
}

// ── Audience ─────────────────────────────────────────────────

/** Audience récente : la grogne s'apaise pendant deux semaines. */
export function audienceRelief(state: GameState, st: Settlement): number {
  const day = toDate(state.time).day;
  return st.audienceDay !== undefined && day - st.audienceDay < 14 ? 6 : 0;
}

/**
 * Tenir audience (2 h, à l'intendance, une fois par semaine) : le seigneur écoute les plaintes,
 * arbitre la pire querelle du lieu et fait l'aumône aux plus pauvres sur le trésor de sa maison.
 */
export function holdAudience(state: GameState): ActionResult {
  const g = guard(state); if (g) return g;
  const { st, house, error } = playerFief(state);
  if (!st || !house) return no(error!);
  const p = state.characters[state.playerId];
  if (state.businesses[st.manorId]?.locationId !== p.locationId) return no(`On tient audience à l’intendance de ${st.name}.`);
  const day = toDate(state.time).day;
  if (st.audienceDay !== undefined && day - st.audienceDay < 7) return no(`Tu as déjà tenu audience cette semaine (prochaine dans ${7 - (day - st.audienceDay)} jours).`);
  const hour = toDate(state.time).hour;
  if (hour < 8 || hour > 17) return no('On ne tient pas audience à cette heure.');
  st.audienceDay = day;
  const pop = residents(state, st.id).filter(c => c.age >= 14);
  const notes: string[] = [];
  // 1. la pire querelle du lieu
  let worst: [string, string, number] | undefined;
  for (const a of pop) for (const b of pop) {
    if (a.id >= b.id) continue;
    const v = getRelation(state, a.id, b.id).affinity + getRelation(state, b.id, a.id).affinity;
    if (v < -40 && (!worst || v < worst[2])) worst = [a.id, b.id, v];
  }
  if (worst) {
    const [a, b] = [state.characters[worst[0]], state.characters[worst[1]]];
    const wise = chance(state, 0.35 + p.skills.diplomatie / 120 + p.attributes.charisme * 0.03);
    if (wise) {
      modifyRelation(state, a.id, b.id, 15, 10); modifyRelation(state, b.id, a.id, 15, 10);
      modifyRelation(state, a.id, p.id, 4, 4); modifyRelation(state, b.id, p.id, 4, 4);
      notes.push(`tu réconcilies ${fullName(a)} et ${fullName(b)}`);
    } else {
      modifyRelation(state, a.id, b.id, 5, 0); modifyRelation(state, b.id, a.id, 5, 0);
      modifyRelation(state, b.id, p.id, -4, 0);
      notes.push(`tu tranches la querelle de ${fullName(a)} et ${fullName(b)} ; ${b.firstName} repart mécontent`);
    }
  }
  // 2. l'aumône aux plus pauvres
  const poor = pop.filter(c => c.money < 8 && !c.isPlayer).sort((a, b) => a.money - b.money || (a.id < b.id ? -1 : 1)).slice(0, 5);
  let given = 0;
  for (const c of poor) {
    if (house.treasury < 5) break;
    transferMoney(state, P.o(house.id), P.c(c.id), 5);
    modifyRelation(state, c.id, p.id, 6, 3);
    given += 5;
  }
  if (given) notes.push(`${given} d d’aumône à ${poor.length > 1 ? `${Math.round(given / 5)} pauvres gens` : 'un pauvre'}`);
  // 3. chacun a été entendu
  for (const c of pop) modifyRelation(state, c.id, p.id, 2, 1);
  gainXp(state, p, 'diplomatie', 2);
  logEvent(state, { type: 'help', actorId: p.id, locationId: st.squareId, importance: 2,
    text: `${fullName(p)} tient audience à ${st.name}${notes.length ? ` : ${notes.join(', ')}` : ''}.`, witnesses: pop.map(c => c.id) });
  finish(state, p, 120);
  return ok(`Tu tiens audience à ${st.name}. ${notes.length ? `${notes.join(' ; ')}.`.replace(/^./, m => m.toUpperCase()) : 'Peu de plaintes : chacun repart content d’avoir été entendu.'} La grogne s’apaise pour deux semaines.`, 120);
}

// ─────────────────────────────────────────────────────────────
// Phase 11 — Hors-la-loi et hommes d'armes.
// Le joueur peut entrer dans la bande (part du butin, embuscades de
// caravanes, risque d'être reconnu et recherché) et lever ses propres
// hommes d'armes (payés chaque jour, ils le suivent, combattent à ses
// côtés et peuvent être menés à la bataille pour une maison en guerre).
// ─────────────────────────────────────────────────────────────
import { applyWounds, autoBattle, fighterOf, type Fighter } from './combat';
import { ITEMS, ITEM_IDS } from './data';
import { P, transferMoney } from './economy';
import { logEvent } from './events';
import { freeMembers, lawOnRoad } from './gangs';
import { addWanted } from './justice';
import { houseOf, isJailed, joinOrg, leaveOrg, orgsOf } from './orgs';
import { finish, guard } from './player';
import { chronicle } from './quests';
import { chance } from './rng';
import { killCharacter } from './sim';
import { getRelation, modifyRelation } from './social';
import { toDate } from './time';
import type { ActionResult, Character, GameState, Organization } from './types';
import { addItem, clamp, fullName, qty, residents, settlementIdOf } from './util';

const ok = (message: string, minutes: number): ActionResult => ({ ok: true, message, minutes });
const no = (message: string): ActionResult => ({ ok: false, message, minutes: 0 });

// ── La bande ─────────────────────────────────────────────────

export function gangOf(state: GameState, c: Character = state.characters[state.playerId]): Organization | undefined {
  return orgsOf(state, c.id, 'gang')[0];
}

/** Ce PNJ peut-il faire entrer le joueur dans sa bande ? (membre libre, et il lui fait assez confiance) */
export function gangContact(state: GameState, npcId: string): Organization | undefined {
  const n = state.characters[npcId];
  const p = state.characters[state.playerId];
  if (!n?.alive || gangOf(state, p)) return undefined;
  const g = gangOf(state, n);
  if (!g || isJailed(state, n)) return undefined;
  const r = getRelation(state, n.id, p.id);
  return r.affinity >= 20 && r.trust >= 5 ? g : undefined;
}

export function joinGang(state: GameState, npcId: string): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  const n = state.characters[npcId];
  const g = gangContact(state, npcId);
  if (!g) return no('Personne ici ne peut — ou ne veut — t’introduire.');
  if (n.locationId !== p.locationId) return no('Il faut en parler de vive voix.');
  if (p.title) return no('Un homme titré ne se mêle pas aux brigands : ta charge te l’interdit.');
  if (orgsOf(state, p.id, 'house').some(h => h.roles[p.id] === 'soldat')) return no('Tu portes la livrée d’une garnison : quitte-la d’abord.');
  joinOrg(state, g, p, 'membre');
  for (const id of g.members) if (id !== p.id) modifyRelation(state, id, p.id, 8, 6);
  // secret : seuls les membres le savent
  logEvent(state, { type: 'recruit', actorId: n.id, targetId: p.id, importance: 2, text: `${fullName(n)} fait entrer ${fullName(p)} dans ${g.name}.`, witnesses: g.members.slice() });
  chronicle(state, `${fullName(p)} rejoint en secret ${g.name}.`);
  finish(state, p, 30);
  return ok(`${n.firstName} te serre l’avant-bras : te voilà de la bande (${g.name}). Tu toucheras ta part du butin chaque lundi, la bande ne t’attaquera plus, et tu peux guetter les caravanes avec elle (depuis ${state.settlements[g.seatId]?.name ?? 'son repaire'}). Si l’on te reconnaît, tu seras recherché.`, 30);
}

export function leaveGang(state: GameState): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  const g = gangOf(state, p);
  if (!g) return no('Tu n’appartiens à aucune bande.');
  for (const id of g.members) if (id !== p.id) modifyRelation(state, id, p.id, -12, -20);
  leaveOrg(state, g, p);
  chronicle(state, `${fullName(p)} quitte ${g.name}.`);
  return ok(`Tu quittes ${g.name}. Tes anciens compagnons ne te le pardonnent pas vraiment.`, 0);
}

/** Part hebdomadaire du joueur sur le trésor de la bande (appelée après le partage entre PNJ). */
export function playerGangShare(state: GameState, g: Organization): number {
  const p = state.characters[state.playerId];
  if (!p?.alive || !g.members.includes(p.id) || isJailed(state, p)) return 0;
  const share = Math.floor(g.treasury / (2 * Math.max(2, g.members.length)));
  if (share <= 0 || !transferMoney(state, P.o(g.id), P.c(p.id), share)) return 0;
  logEvent(state, { type: 'dividend', actorId: p.id, importance: 2, text: `Ta part du butin de ${g.name} : ${share} d.`, witnesses: [p.id] });
  return share;
}

/** Guetter la route avec la bande : s'il passe une caravane, on l'attaque. */
export function gangRaid(state: GameState): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  const g = gangOf(state, p);
  if (!g) return no('Tu n’appartiens à aucune bande.');
  if (settlementIdOf(state, p.locationId) !== g.seatId) return no(`La bande opère depuis ${state.settlements[g.seatId]?.name ?? 'son repaire'} : rejoins-la là-bas.`);
  if (p.needs.energy < 25) return no('Tu es trop épuisé pour une nuit à l’affût.');
  const mates = freeMembers(state, g).slice(0, 2);
  if (!mates.length) return no('Aucun compagnon n’est libre pour t’accompagner.');
  const HOURS = 6;
  // une caravane en route sur un chemin qui touche le repaire, pas encore attaquée
  const cv = state.caravans.find(c => {
    if (c.status !== 'en_route' || c.ambushed) return false;
    const m = state.characters[c.merchantId];
    const road = state.roads.find(r => r.locationId === m?.locationId);
    return !!road && (road.a === g.seatId || road.b === g.seatId);
  });
  if (!cv) {
    finish(state, p, HOURS * 60);
    return ok(`Six heures à l’affût avec ${mates.map(m => m.firstName).join(' et ')} : personne ne passe. La route est vide cette fois.`, HOURS * 60);
  }
  const m = state.characters[cv.merchantId];
  const road = state.roads.find(r => r.locationId === m.locationId)!;
  cv.ambushed = true;
  const defenders = [m, ...lawOnRoad(state, road)];
  const A: Fighter[] = [p, ...mates].map(fighterOf), D = defenders.map(fighterOf);
  const r = autoBattle(state, A, D, 6);
  // les blessures du joueur sont réelles, mais on ne meurt pas d'un coup de main manqué
  const pf = A[0];
  const dead = applyWounds(state, [...A.slice(1), ...D], 0.15);
  p.health = clamp(Math.max(pf.hp, 8), 0, 100);
  let text: string, mine = 0;
  if (r.winner === 'a') {
    const loot: string[] = [];
    for (const it of ITEM_IDS) {
      const n = Math.floor(qty(cv.cargo, it) / 2);
      if (n > 0) { addItem(cv.cargo, it, -n); addItem(g.stash, it, n); loot.push(`${n} ${ITEMS[it].plural}`); }
    }
    const cash = Math.floor(m.money / 2);
    if (cash > 0) transferMoney(state, P.c(m.id), P.o(g.id), cash);
    mine = Math.floor(cash * 0.3);
    if (mine > 0) transferMoney(state, P.o(g.id), P.c(p.id), mine);
    g.heat += 20;
    text = `Des brigands attaquent la caravane de ${fullName(m)} sur ${state.locations[road.locationId].name} et emportent ${[...loot, cash ? `${cash} d` : ''].filter(Boolean).join(', ') || 'presque rien'}.`;
  } else {
    g.heat += 10;
    text = `La caravane de ${fullName(m)} repousse des brigands sur ${state.locations[road.locationId].name}.`;
  }
  // le marchand reconnaît-il le joueur sous son masque ?
  const known = m.alive && chance(state, (m.relations[p.id] !== undefined ? 0.3 : 0.12) + m.attributes.perception * 0.03);
  logEvent(state, { type: 'ambush', actorId: known ? p.id : undefined, targetId: m.id, locationId: road.locationId, importance: 3,
    text: known ? `${text} ${fullName(m)} a reconnu ${fullName(p)}.` : text, witnesses: defenders.map(d => d.id).concat(mates.map(b => b.id), p.id), data: { gang: g.id } });
  for (const id of dead) killCharacter(state, state.characters[id], 'dans une embuscade');
  if (known) {
    addWanted(state, p.id, cv.to, 'brigandage', 80);
    modifyRelation(state, m.id, p.id, -40, -50);
    chronicle(state, `${fullName(p)} est reconnu lors d'une embuscade : le voilà recherché.`);
  }
  const house = houseOf(state, cv.to);
  if (house) { if (!house.patrolRoads.includes(road.locationId)) house.patrolRoads.push(road.locationId); house.heat += 15; }
  finish(state, p, HOURS * 60);
  return ok(`${r.winner === 'a' ? `Le coup réussit${mine ? ` : ${mine} d pour toi tout de suite, le reste au trésor de la bande` : ', mais le marchand n’avait presque rien'}.` : 'La caravane se défend et vous repousse.'} ${text}${known ? ` ${m.firstName} t’a reconnu : tu es recherché pour brigandage.` : ''} Santé : ${Math.round(p.health)}.`, HOURS * 60);
}

// ── Hommes d'armes ───────────────────────────────────────────

export const RETINUE_PAY = 6;       // deniers par jour et par homme
export const RETINUE_BOUNTY = 15;   // prime d'engagement

export function retinue(state: GameState, c: Character = state.characters[state.playerId]): Character[] {
  return state.characterOrder.map(id => state.characters[id]).filter(x => x.alive && x.captainId === c.id);
}
export function retinueCap(c: Character): number { return c.title === 'conseiller' ? 6 : c.title === 'ecuyer' ? 4 : 2; }

/** Qui peut être engagé ici : un adulte valide sans emploi, présent, qui ne déteste pas le joueur. */
export function recruitsHere(state: GameState): Character[] {
  const p = state.characters[state.playerId];
  return residents(state, settlementIdOf(state, p.locationId)).filter(c => c.locationId === p.locationId && !c.employerId && !c.masterId && !c.captainId
    && c.age >= 16 && c.age < 55 && c.sick === 0 && c.health > 60 && c.profession !== 'seigneur' && !isJailed(state, c)
    && !state.orgOrder.some(id => state.orgs[id].members.includes(c.id))
    && !state.businessOrder.some(id => state.businesses[id].ownerId === c.id)
    && getRelation(state, c.id, p.id).affinity >= -5);
}

export function hireManAtArms(state: GameState, npcId: string): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  const c = state.characters[npcId];
  if (!c || !recruitsHere(state).some(x => x.id === npcId)) return no('Cette personne ne peut pas s’engager à ton service.');
  if (retinue(state, p).length >= retinueCap(p)) return no(`Tu ne peux pas commander plus de ${retinueCap(p)} hommes${p.title ? '' : ' sans titre (un écuyer en mène quatre, un conseiller six)'}.`);
  if (p.money < RETINUE_BOUNTY + RETINUE_PAY) return no(`Il te faut ${RETINUE_BOUNTY} d de prime d’engagement et de quoi payer la première journée (${RETINUE_PAY} d).`);
  transferMoney(state, P.c(p.id), P.c(c.id), RETINUE_BOUNTY);
  c.captainId = p.id;
  c.profession = 'soldat';
  c.goal = { kind: 'servir' };
  modifyRelation(state, c.id, p.id, 8, 8);
  logEvent(state, { type: 'hire', actorId: p.id, targetId: c.id, importance: 2, locationId: p.locationId,
    text: `${fullName(p)} engage ${fullName(c)} comme homme d'armes (${RETINUE_BOUNTY} d de prime, ${RETINUE_PAY} d par jour).`, witnesses: [c.id] });
  finish(state, p, 20);
  return ok(`${c.firstName} entre à ton service : ${RETINUE_BOUNTY} d de prime, puis ${RETINUE_PAY} d par jour. Il te suit et se battra à tes côtés.`, 20);
}

function release(state: GameState, c: Character, why: string): void {
  const cap = c.captainId ? state.characters[c.captainId] : undefined;
  c.captainId = undefined;
  if (c.alive && c.profession === 'soldat' && !state.orgOrder.some(id => state.orgs[id].roles[c.id] === 'soldat')) c.profession = 'sans_emploi';
  if (c.alive) {
    c.goal = { kind: 'trouver_emploi' };
    c.activity = { kind: 'idle', locationId: c.locationId, since: state.time, note: 'Rendu à la vie civile' };
    logEvent(state, { type: 'quit', actorId: c.id, targetId: cap?.id, importance: 2, text: `${fullName(c)} quitte le service de ${cap ? fullName(cap) : 'son capitaine'} : ${why}.`, witnesses: cap ? [cap.id, c.id] : [c.id] });
  }
}

export function dismissManAtArms(state: GameState, npcId: string): ActionResult {
  const p = state.characters[state.playerId];
  const c = state.characters[npcId];
  if (!c || c.captainId !== p.id) return no('Cet homme n’est pas à ton service.');
  release(state, c, 'congédié');
  return ok(`Tu congédies ${c.firstName}.`, 0);
}

/** Chaque jour : la solde, ou le départ faute de solde ; un capitaine mort ou remplacé libère ses hommes. */
export function dailyRetinue(state: GameState): void {
  for (const c of state.characterOrder.map(id => state.characters[id])) {
    if (!c.captainId) continue;
    if (!c.alive) { c.captainId = undefined; continue; }
    const cap = state.characters[c.captainId];
    if (!cap?.alive || !cap.isPlayer) { release(state, c, 'son capitaine n’est plus'); continue; }
    if (state.observer) continue;
    if (!transferMoney(state, P.c(cap.id), P.c(c.id), RETINUE_PAY)) release(state, c, 'la solde n’est pas payée');
  }
}

/** Un homme d'armes suit son capitaine tant qu'il n'a ni faim ni sommeil. Renvoie vrai s'il est occupé à escorter. */
export function followsCaptain(state: GameState, c: Character, hour: number): boolean {
  const cap = c.captainId ? state.characters[c.captainId] : undefined;
  if (!cap?.alive) return false;
  if (c.needs.hunger >= 55 || c.needs.energy < 25 || hour >= 22 || hour < 6) return false;
  if (cap.activity.kind === 'sleep' || isJailed(state, cap)) return false;
  c.locationId = cap.locationId;
  c.activity = { kind: 'patrol', locationId: cap.locationId, since: state.time, note: `Escorte ${fullName(cap)}` };
  return true;
}

/** Les hommes présents aux côtés du joueur (ils le rejoignent sur la route quand il est attaqué). */
export function alliesAtHand(state: GameState): Character[] {
  const p = state.characters[state.playerId];
  return retinue(state, p).filter(c => !isJailed(state, c) && c.health > 25 && (c.locationId === p.locationId || c.activity.kind === 'patrol'));
}

/** L'escorte dissuade les brigands. */
export function escortFactor(state: GameState): number {
  return Math.max(0.3, 1 - 0.2 * alliesAtHand(state).length);
}

// ── Mener ses hommes à la bataille ───────────────────────────

/** Le joueur promet son épée (et ses hommes) à une maison en guerre pour la prochaine bataille. */
export function muster(state: GameState, houseId: string): ActionResult {
  const p = state.characters[state.playerId];
  const house = state.orgs[houseId];
  const war = state.wars.find(w => w.status === 'active' && (w.attackerId === houseId || w.defenderId === houseId));
  if (!house || !war) return no('Cette maison n’est pas en guerre.');
  state.muster = { houseId, day: toDate(state.time).day };
  const n = retinue(state, p).length;
  return ok(`Tu promets ton épée à ${house.name}${n ? ` avec ${n} homme${n > 1 ? 's' : ''} d’armes` : ''} pour la prochaine bataille (lundi).`, 0);
}

/** Combattants que le joueur apporte à un camp (lui-même et ses hommes), si sa promesse tient encore. */
export function musteredFor(state: GameState, houseId: string): Character[] {
  const m = state.muster;
  const p = state.characters[state.playerId];
  if (!m || m.houseId !== houseId || !p?.alive || state.observer || isJailed(state, p)) return [];
  if (toDate(state.time).day - m.day > 8) return [];
  return [p, ...retinue(state, p).filter(c => !isJailed(state, c) && c.health > 25)];
}

/** Après la bataille : la maison récompense le joueur, la promesse est tenue. */
export function afterBattle(state: GameState, houseId: string, won: boolean): void {
  const m = state.muster;
  if (!m || m.houseId !== houseId) return;
  state.muster = undefined;
  const p = state.characters[state.playerId];
  const house = state.orgs[houseId];
  if (!p?.alive || !house) return;
  const lord = house.leaderId ? state.characters[house.leaderId] : undefined;
  const pay = Math.min(won ? 60 : 20, house.treasury);
  if (pay > 0) transferMoney(state, P.o(house.id), P.c(p.id), pay);
  if (lord?.alive) modifyRelation(state, lord.id, p.id, won ? 12 : 6, won ? 12 : 6);
  const text = `${fullName(p)} combat pour ${house.name}${won ? ' et partage la victoire' : ''}${pay ? ` (${pay} d de récompense)` : ''}.`;
  logEvent(state, { type: 'battle', actorId: p.id, importance: 3, text, witnesses: lord ? [lord.id, p.id] : [p.id] });
  chronicle(state, text);
}

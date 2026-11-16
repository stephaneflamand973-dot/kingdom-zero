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
import { roadPath } from './util';
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
  const share = Math.floor(g.treasury / (2 * Math.max(2, g.members.length))) * (g.leaderId === p.id ? 2 : 1); // le chef : double part
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
  if (!m || m.houseId !== houseId || !p?.alive || state.observer || isJailed(state, p) || state.orgs[houseId]?.leaderId === p.id) return [];
  if (toDate(state.time).day - m.day > 8) return [];
  return [p, ...retinue(state, p).filter(c => !isJailed(state, c) && c.health > 25)];
}

/** Après la bataille : la maison récompense le joueur, la promesse est tenue. */
export function afterBattle(state: GameState, houseId: string, won: boolean): void {
  const m = state.muster;
  if (!m || m.houseId !== houseId) return;
  state.muster = undefined;
  if (state.orgs[houseId]?.leaderId === state.playerId) return; // on ne se paie pas soi-même
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

// ── Phase 11 bis : chef de bande, maison du joueur, guerres déclarées ──

/** Défier le chef de la bande en duel (un contre un). Vainqueur : on prend la tête de la bande. */
export function challengeGangLeader(state: GameState): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  const g = gangOf(state, p);
  if (!g) return no('Tu n’appartiens à aucune bande.');
  if (g.leaderId === p.id) return no('Tu mènes déjà la bande.');
  const chief = g.leaderId ? state.characters[g.leaderId] : undefined;
  if (chief && (!chief.alive || isJailed(state, chief))) {
    g.leaderId = p.id; g.roles[p.id] = 'chef';
    chronicle(state, `${fullName(p)} prend la tête de ${g.name}, son chef étant hors d'état.`);
    return ok(`${chief.firstName} n’est plus là pour mener la bande : tu en prends la tête.`, 0);
  }
  if (!chief) { g.leaderId = p.id; g.roles[p.id] = 'chef'; return ok(`La bande n’avait plus de chef : tu en prends la tête.`, 0); }
  if (chief.locationId !== p.locationId) return no(`Il faut défier ${chief.firstName} en face, là où il se trouve (${state.locations[chief.locationId]?.name}).`);
  if (p.needs.energy < 30 || p.health < 50) return no('Tu n’es pas en état de te battre.');
  const A = [fighterOf(p)], B = [fighterOf(chief)];
  const r = autoBattle(state, A, B, 10);
  p.health = clamp(Math.max(A[0].hp, 10), 0, 100);
  chief.health = clamp(Math.max(B[0].hp, 10), 0, 100);
  finish(state, p, 30);
  const won = r.winner === 'a' || (r.winner === 'none' && A[0].hp > B[0].hp);
  if (won) {
    g.leaderId = p.id; g.roles[p.id] = 'chef'; g.roles[chief.id] = 'membre';
    for (const id of g.members) if (id !== p.id && id !== chief.id) modifyRelation(state, id, p.id, 6, 4);
    modifyRelation(state, chief.id, p.id, -35, -20);
    const text = `${fullName(p)} défie ${fullName(chief)} et prend la tête de ${g.name}.`;
    logEvent(state, { type: 'succession', actorId: p.id, targetId: chief.id, importance: 3, text, witnesses: g.members.slice() });
    chronicle(state, text);
    return ok(`Tu terrasses ${chief.firstName} : la bande est à toi. Tu touches désormais une double part, et la bande rançonne les commerces sur ton ordre.`, 30);
  }
  modifyRelation(state, chief.id, p.id, -15, -15);
  for (const id of g.members) if (id !== p.id && id !== chief.id) modifyRelation(state, id, p.id, -4, -4);
  return ok(`${chief.firstName} a le dessus. Tu restes dans la bande, humilié. Santé : ${Math.round(p.health)}.`, 30);
}

export const HOUSE_FOUNDING = 400;

export function houseOfPlayer(state: GameState): Organization | undefined {
  return Object.values(state.orgs).find(o => o.kind === 'house' && !o.dissolved && o.leaderId === state.playerId);
}

/** Fonder sa maison : il faut un titre (écuyer ou conseiller) et 400 d pour son trésor. */
export function foundHouse(state: GameState): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  if (houseOfPlayer(state)) return no('Ta maison existe déjà.');
  if (!p.title) return no('Seul un homme titré (écuyer ou conseiller) peut lever bannière et fonder une maison.');
  if (gangOf(state, p)) return no('Un chef de maison ne peut appartenir à une bande : quitte-la d’abord.');
  if (p.money < HOUSE_FOUNDING) return no(`Il te faut ${HOUSE_FOUNDING} d pour doter le trésor de ta maison.`);
  const sid = settlementIdOf(state, p.locationId);
  // on quitte la garnison ou la maison que l'on servait
  for (const o of orgsOf(state, p.id, 'house')) leaveOrg(state, o, p);
  state.idSeq += 1;
  const id = `h_p${state.idSeq}`;
  const house: Organization = {
    id, name: `Maison ${p.lastName.startsWith('de ') ? p.lastName : `de ${p.lastName}`}`, kind: 'house', leaderId: p.id, members: [p.id], roles: { [p.id]: 'seigneur' },
    treasury: 0, stash: {}, seatId: sid, founded: toDate(state.time).day, relations: {}, heat: 0, dues: 0, patrolRoads: [], service: {},
  };
  for (const o of Object.values(state.orgs)) if (o.kind === 'house' && !o.dissolved) { house.relations[o.id] = -10; o.relations[id] = -10; }
  state.orgs[id] = house;
  state.orgOrder.push(id);
  transferMoney(state, P.c(p.id), P.o(id), HOUSE_FOUNDING);
  // les hommes d'armes du joueur deviennent les soldats de sa maison
  // (désormais soldés chaque semaine par le trésor de la maison, et non plus chaque jour par le joueur)
  for (const c of retinue(state, p)) { joinOrg(state, house, c, 'soldat'); c.captainId = undefined; }
  // le conjoint et les enfants adultes en sont membres ; l'héritier désigné en est l'héritier
  const heirId = state.dynasty.designatedHeir ?? p.childIds.find(k => state.characters[k]?.alive);
  if (p.spouseId && state.characters[p.spouseId]?.alive) joinOrg(state, house, state.characters[p.spouseId], 'vassal');
  if (heirId && state.characters[heirId]?.alive) joinOrg(state, house, state.characters[heirId], 'heritier');
  const text = `${fullName(p)} lève bannière et fonde la ${house.name}, à ${state.settlements[sid].name}.`;
  logEvent(state, { type: 'title', actorId: p.id, importance: 3, locationId: state.settlements[sid].squareId, text, witnesses: residents(state, sid).map(c => c.id) });
  chronicle(state, text);
  finish(state, p, 120);
  return ok(`${text} Ses ${house.members.length - 1} premiers membres te suivent. Sans terre, ta maison ne perçoit pas de tribut : il faudra conquérir un fief.`, 120);
}

/** Le joueur, seigneur de sa maison, déclare la guerre pour prendre une localité voisine de son siège. */
export function declareWar(state: GameState, targetSettlementId: string): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  const house = houseOfPlayer(state);
  if (!house) return no('Il faut d’abord fonder ta maison.');
  if (state.wars.some(w => w.status === 'active')) return no('Une guerre est déjà en cours dans la région.');
  const st = state.settlements[targetSettlementId];
  const def = st ? state.orgs[st.lordHouseId] : undefined;
  if (!st || !def || def.id === house.id || def.dissolved) return no('Cette localité n’a pas de seigneur à défier.');
  const near = st.id === house.seatId || state.settlementOrder.some(o => (o === house.seatId || state.settlements[o].lordHouseId === house.id) && roadPath(state, o, st.id)?.roads.length === 1);
  if (!near) return no('Trop loin de tes terres pour mener campagne.');
  const lastEnd = Math.max(-999, ...state.wars.filter(w => [w.attackerId, w.defenderId].includes(house.id) && [w.attackerId, w.defenderId].includes(def.id)).map(w => w.endDay ?? -999));
  if (toDate(state.time).day - lastEnd < 112) return no('Une trêve d’un an court encore avec cette maison.');
  state.idSeq += 1;
  state.wars.push({ id: `w${state.idSeq}`, attackerId: house.id, defenderId: def.id, targetSettlementId: st.id, startDay: toDate(state.time).day, victories: { attacker: 0, defender: 0 }, battles: 0, status: 'active' });
  house.relations[def.id] = -80; def.relations[house.id] = -80;
  const lord = def.leaderId ? state.characters[def.leaderId] : undefined;
  const text = `${fullName(p)} déclare la guerre à ${def.name} et revendique ${st.name}.`;
  logEvent(state, { type: 'war', actorId: p.id, targetId: lord?.id, locationId: st.squareId, importance: 3, text, witnesses: state.characterOrder.filter(id => state.characters[id].alive) });
  chronicle(state, text);
  return ok(`${text} Une bataille chaque lundi devant ${st.name} ; deux victoires emportent la place. Toi et tes soldats combattrez.`, 0);
}

/** Combattants qu'une maison menée par le joueur apporte en personne : lui et ses hommes d'armes qui ne sont pas déjà soldats. */
export function ownHost(state: GameState, house: Organization): Character[] {
  const p = state.characters[state.playerId];
  if (!p?.alive || house.leaderId !== p.id || isJailed(state, p) || state.observer) return [];
  return [p, ...retinue(state, p).filter(c => !house.members.includes(c.id) && !isJailed(state, c) && c.health > 25)];
}

/** Verser ou reprendre de l'argent au trésor de sa maison (soldes des soldats, guerres). */
export function houseTreasury(state: GameState, amount: number): ActionResult {
  const p = state.characters[state.playerId];
  const h = houseOfPlayer(state);
  if (!h) return no('Tu n’as pas de maison.');
  if (amount > 0) {
    const n = Math.min(amount, p.money);
    if (n <= 0) return no('Ta bourse est vide.');
    transferMoney(state, P.c(p.id), P.o(h.id), n);
    return ok(`Tu verses ${n} d au trésor de ${h.name} (${h.treasury} d).`, 0);
  }
  const n = Math.min(-amount, h.treasury);
  if (n <= 0) return no('Le trésor de ta maison est vide.');
  transferMoney(state, P.o(h.id), P.c(p.id), n);
  return ok(`Tu prends ${n} d au trésor de ${h.name}.`, 0);
}

/** Localités que la maison du joueur peut revendiquer (son siège, ou voisines de ses terres). */
export function warTargets(state: GameState): string[] {
  const h = houseOfPlayer(state);
  if (!h) return [];
  return state.settlementOrder.filter(id => {
    const st = state.settlements[id];
    if (st.lordHouseId === h.id) return false;
    return id === h.seatId || state.settlementOrder.some(o => (o === h.seatId || state.settlements[o].lordHouseId === h.id) && roadPath(state, o, id)?.roads.length === 1);
  });
}

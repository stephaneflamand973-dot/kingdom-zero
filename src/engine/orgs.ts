// ─────────────────────────────────────────────────────────────
// Organisations (phase 4) : maisons nobles, guildes, bandes.
// Adhésion, rôles, forces de l'ordre, succession du chef, dissolution.
// ─────────────────────────────────────────────────────────────
import { logEvent } from './events';
import type { Character, GameState, OrgKind, OrgRole, Organization } from './types';
import { aliveCharacters, fullName, settlementIdOf } from './util';

export function orgList(state: GameState, kind?: OrgKind): Organization[] {
  return (state.orgOrder ?? []).map(id => state.orgs[id]).filter(o => !o.dissolved && (!kind || o.kind === kind));
}

export function orgsOf(state: GameState, charId: string, kind?: OrgKind): Organization[] {
  return orgList(state, kind).filter(o => o.members.includes(charId));
}

export function roleIn(o: Organization, charId: string): OrgRole | undefined {
  return o.members.includes(charId) ? o.roles[charId] : undefined;
}

/** Maison noble qui tient une localité. */
export function houseOf(state: GameState, settlementId: string): Organization | undefined {
  const id = state.settlements[settlementId]?.lordHouseId;
  return id ? state.orgs[id] : undefined;
}

export function lordOf(state: GameState, house: Organization): Character | undefined {
  return house.leaderId ? state.characters[house.leaderId] : undefined;
}

export function joinOrg(_state: GameState, o: Organization, c: Character, role: OrgRole): void {
  if (!o.members.includes(c.id)) o.members.push(c.id);
  o.roles[c.id] = role;
}

export function leaveOrg(state: GameState, o: Organization, c: Character): void {
  o.members = o.members.filter(id => id !== c.id);
  delete o.roles[c.id];
  delete o.service[c.id];
  if (o.leaderId === c.id) succession(state, o, `${fullName(c)} a quitté ${o.name}`);
}

export function isJailed(state: GameState, c: Character): boolean {
  return (c.jailedUntil ?? 0) > state.time;
}

/** Garde ou soldat en service, libre : peut intervenir contre un crime. */
export function isLawman(state: GameState, c: Character): boolean {
  if (!c.alive || isJailed(state, c)) return false;
  if (c.profession === 'garde' || c.profession === 'soldat') return c.activity.kind === 'work' || c.activity.kind === 'patrol';
  return false;
}

/** Soldats d'une maison (gardes des intendances de ses terres compris), libres. */
export function soldiersOf(state: GameState, house: Organization): Character[] {
  const lands = new Set(state.settlementOrder.filter(id => state.settlements[id].lordHouseId === house.id));
  return aliveCharacters(state).filter(c => !c.isPlayer && !isJailed(state, c) && (
    (house.members.includes(c.id) && house.roles[c.id] === 'soldat') ||
    (c.profession === 'garde' && lands.has(settlementIdOf(state, c.homeId)))));
}

/** Choisit un nouveau chef ; sans successeur, l'organisation se dissout. */
export function succession(state: GameState, o: Organization, cause: string): Character | undefined {
  const alive = o.members.map(id => state.characters[id]).filter(c => c && c.alive && !isJailed(state, c) && c.id !== o.leaderId);
  let heir: Character | undefined;
  if (o.kind === 'house') {
    heir = alive.find(c => o.roles[c.id] === 'heritier')
      ?? alive.filter(c => o.roles[c.id] === 'vassal' || o.roles[c.id] === 'conseiller').sort((a, b) => b.age - a.age)[0];
  } else if (o.kind === 'gang') {
    heir = alive.sort((a, b) => b.skills.combat - a.skills.combat || (a.id < b.id ? -1 : 1))[0];
  } else {
    heir = alive.sort((a, b) => b.money - a.money || (a.id < b.id ? -1 : 1))[0];
  }
  if (!heir) { dissolve(state, o, cause); return undefined; }
  o.leaderId = heir.id;
  o.roles[heir.id] = o.kind === 'house' ? 'seigneur' : 'chef';
  if (o.kind === 'house') heir.profession = 'seigneur';
  logEvent(state, {
    type: 'succession', actorId: heir.id, locationId: state.settlements[o.seatId]?.squareId, importance: 3,
    text: `${cause} : ${fullName(heir)} prend la tête de ${o.name}.`,
    witnesses: o.kind === 'gang' ? o.members.slice() : aliveCharacters(state).map(c => c.id),
  });
  return heir;
}

export function dissolve(state: GameState, o: Organization, cause: string): void {
  o.dissolved = state.time;
  o.leaderId = null;
  logEvent(state, {
    type: 'succession', importance: o.kind === 'gang' ? 2 : 3, locationId: state.settlements[o.seatId]?.squareId,
    text: `${o.name} disparaît (${cause}).`,
    witnesses: o.kind === 'gang' ? o.members.slice() : aliveCharacters(state).map(c => c.id),
  });
  // Les terres d'une maison éteinte reviennent à la maison voisine la plus forte
  if (o.kind === 'house') {
    const heirHouse = orgList(state, 'house').sort((a, b) => b.treasury - a.treasury)[0];
    for (const sid of state.settlementOrder) if (state.settlements[sid].lordHouseId === o.id && heirHouse) state.settlements[sid].lordHouseId = heirHouse.id;
  }
  // Le trésor et la réserve restent dans l'organisation dissoute (bilan exact) ; ils sont récupérés plus bas
  const heir = o.kind === 'house' ? orgList(state, 'house')[0] : undefined;
  if (heir) {
    heir.treasury += o.treasury; o.treasury = 0;
    for (const [k, v] of Object.entries(o.stash)) { heir.stash[k as keyof typeof heir.stash] = (heir.stash[k as keyof typeof heir.stash] ?? 0) + v!; }
    o.stash = {};
  }
  o.members = [];
  o.roles = {};
}

/** À la mort d'un personnage : il quitte ses organisations, et un chef est remplacé. */
export function onDeathOrgs(state: GameState, c: Character): void {
  for (const o of orgsOf(state, c.id)) {
    const wasLeader = o.leaderId === c.id;
    o.members = o.members.filter(id => id !== c.id);
    delete o.roles[c.id];
    if (wasLeader) succession(state, o, `Mort de ${fullName(c)}`);
  }
  state.wanted = (state.wanted ?? []).filter(w => w.characterId !== c.id);
}

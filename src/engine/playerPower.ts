// ─────────────────────────────────────────────────────────────
// Actions de pouvoir du joueur (phase 4) : embuscades et arrestations au tour par tour,
// requêtes auprès des seigneurs, service dans la garnison, dénonciations.
// ─────────────────────────────────────────────────────────────
import { applyWounds, exchange, fighterOf, type Fighter } from './combat';
import { ITEMS, ITEM_IDS } from './data';
import { P, transferItem, transferMoney } from './economy';
import { getEvent, logEvent } from './events';
import { ambushRisk, freeMembers, gangsOnRoad } from './gangs';
import { addWanted, arrestNpc, jail, payBounty, wantedFor } from './justice';
import { activeWar } from './nobility';
import { houseOf, joinOrg, orgList, orgsOf } from './orgs';
import { finish, guard } from './player';
import { chance, rand } from './rng';
import { advanceTime, killCharacter, recordPrices } from './sim';
import { compatibility, getRelation, modifyRelation } from './social';
import { kin, wed } from './family';
import { MIN_PER_DAY, formatDuration } from './time';
import type { ActionResult, Character, GameState, Organization } from './types';
import { activeContract } from './contracts';
import { charactersAt, clamp, fullName, player, qty, roadPath, settlementIdOf } from './util';

const ok = (message: string, minutes: number): ActionResult => ({ ok: true, message, minutes });
const no = (message: string): ActionResult => ({ ok: false, message, minutes: 0 });

// ── Embuscade pendant un voyage ─────────────────────────────

/** Tire au sort une embuscade sur les routes du trajet ; crée la rencontre si elle a lieu. */
export function rollTravelAmbush(state: GameState, from: string, to: string, minutes: number): ActionResult | undefined {
  if (state.observer) return undefined;
  const sa = settlementIdOf(state, from), sb = settlementIdOf(state, to);
  if (sa === sb) return undefined;
  const path = roadPath(state, sa, sb);
  if (!path) return undefined;
  const p = player(state);
  let elapsed = 0;
  for (const road of path.roads) {
    const risk = ambushRisk(state, road);
    const pAmbush = 1 - Math.pow(1 - risk, road.hours);
    if (risk > 0 && rand(state) < pAmbush) {
      const gang = gangsOnRoad(state, road).find(g => freeMembers(state, g).length >= 2)!;
      const bandits = freeMembers(state, gang).slice(0, 3);
      // le joueur marche jusqu'au milieu de cette route
      const until = elapsed + Math.round(road.hours * 30);
      p.activity = { kind: 'travel', locationId: p.locationId, since: state.time, note: 'En route' };
      advanceTime(state, until);
      p.locationId = road.locationId;
      for (const b of bandits) { b.locationId = road.locationId; b.activity = { kind: 'ambush', locationId: road.locationId, since: state.time, note: 'Guette sur la route' }; }
      const demand = Math.max(10, Math.floor(p.money * 0.6));
      state.encounter = {
        kind: 'bandits', enemies: bandits.map(b => b.id), hp: Object.fromEntries(bandits.map(b => [b.id, Math.round(b.health)])),
        demand, orgId: gang.id, destination: to, remainingMinutes: Math.max(0, minutes - until), roadId: road.locationId,
        log: [`Sur ${state.locations[road.locationId].name}, ${bandits.length} brigands masqués te barrent le chemin : « La bourse ou la vie ! ${demand} deniers, et tu passes. »`], round: 0,
      };
      return { ok: true, message: `Embuscade sur ${state.locations[road.locationId].name} !`, minutes: until };
    }
    elapsed += road.hours * 60;
  }
  return undefined;
}

function enemyFighters(state: GameState): Fighter[] {
  const e = state.encounter!;
  // des brigands masqués restent anonymes dans le récit du combat
  return e.enemies.map((id, i) => ({ ...fighterOf(state.characters[id]), hp: e.hp[id] ?? 0, ...(e.kind === 'bandits' ? { name: `le brigand ${['au foulard', 'balafré', 'à la hache'][i] ?? i + 1}` } : {}) }));
}
function startHp(state: GameState): number {
  return state.encounter!.enemies.reduce((s, id) => s + Math.round(state.characters[id].health), 0);
}

/** Fin de rencontre : les bandits regagnent leurs foyers, le joueur reprend sa route. */
function endEncounter(state: GameState, continueJourney: boolean): number {
  const e = state.encounter!;
  for (const id of e.enemies) {
    const c = state.characters[id];
    if (c.alive && e.kind === 'bandits' && (c.jailedUntil ?? 0) <= state.time) { c.locationId = c.homeId; c.activity = { kind: 'idle', locationId: c.homeId, since: state.time, note: 'Rentre discrètement' }; }
  }
  state.encounter = undefined;
  const p = player(state);
  if (continueJourney && e.destination && p.alive) {
    p.activity = { kind: 'travel', locationId: p.locationId, since: state.time, note: 'Reprend la route' };
    p.locationId = e.destination;
    finish(state, p, e.remainingMinutes);
    recordPrices(state, settlementIdOf(state, e.destination));
    return e.remainingMinutes;
  }
  return 0;
}

export type EncounterChoice = 'fight' | 'flee' | 'pay' | 'parley' | 'surrender';

export function encounterAction(state: GameState, choice: EncounterChoice): ActionResult {
  if (state.gameOver) return no('La partie est terminée.');
  const e = state.encounter;
  if (!e) return no('Aucune rencontre en cours.');
  const p = player(state);
  e.round += 1;
  const log: string[] = [];
  const pf = fighterOf(p);
  const foes = enemyFighters(state);
  const settle = () => { p.health = clamp(pf.hp, 0, 100); for (const f of foes) e.hp[f.id] = f.hp; };
  const enemyVolley = () => { exchange(state, foes, [pf], log); /* l'adversaire frappe ; le joueur ne riposte pas */ };

  if (e.kind === 'bandits') {
    const gang = state.orgs[e.orgId!];
    switch (choice) {
      case 'pay': {
        const cash = Math.min(p.money, e.demand);
        transferMoney(state, P.c(p.id), P.o(gang.id), cash);
        let goods = '';
        if (cash < e.demand) goods = takeHalfGoods(state, p, gang);
        logEvent(state, { type: 'ambush', targetId: p.id, locationId: e.roadId, importance: 2, text: `Des brigands rançonnent ${fullName(p)} sur la route (${cash} d${goods ? `, ${goods}` : ''}).`, witnesses: [p.id] });
        const m = endEncounter(state, true);
        return ok(`Tu paies ${cash} d${goods ? ` et abandonnes ${goods}` : ''}. Les brigands s'écartent et tu reprends ta route.`, m);
      }
      case 'surrender': {
        const cash = p.money;
        transferMoney(state, P.c(p.id), P.o(gang.id), cash);
        const goods = takeHalfGoods(state, p, gang);
        const m = endEncounter(state, true);
        return ok(`Tu te rends. Ils prennent ${cash} d${goods ? ` et ${goods}` : ''}, puis te laissent repartir.`, m);
      }
      case 'parley': {
        const friend = e.enemies.map(id => state.characters[id]).find(c => getRelation(state, c.id, p.id).affinity >= 20);
        if (friend) {
          const m = endEncounter(state, true);
          return ok(`${friend.firstName} te reconnaît sous son masque et fait signe aux autres de te laisser passer. (Tu sais désormais qu'il est des leurs.)`, m);
        }
        if (chance(state, 0.15 + p.skills.diplomatie / 150 + p.attributes.charisme * 0.02)) {
          e.demand = Math.ceil(e.demand / 2);
          return ok(`Tu parlementes habilement : ils se contenteraient de ${e.demand} d.`, 0);
        }
        enemyVolley(); settle();
        e.log.push(...log);
        return checkPlayerDown(state, `Ils n'ont pas envie de discuter. ${log.join(' ')}`);
      }
      case 'flee': {
        if (chance(state, clamp(0.35 + p.attributes.agilite * 0.04 - (e.enemies.length - 1) * 0.08, 0.1, 0.85))) {
          const m = endEncounter(state, true);
          return ok('Tu t’échappes à travers les fourrés et rejoins la route plus loin.', m);
        }
        enemyVolley(); settle();
        e.log.push(...log);
        return checkPlayerDown(state, `Ils te rattrapent ! ${log.join(' ')}`);
      }
      case 'fight': {
        exchange(state, [pf], foes, log); settle();
        e.log.push(...log);
        const left = foes.reduce((s, f) => s + f.hp, 0);
        if (left <= startHp(state) * 0.5 || foes.every(f => f.hp === 0)) return banditsRouted(state, foes, log);
        return checkPlayerDown(state, log.join(' '));
      }
    }
  }
  // Arrestation
  const w = wantedFor(state, p.id);
  const sid = settlementIdOf(state, p.locationId);
  switch (choice) {
    case 'surrender': {
      state.encounter = undefined;
      jail(state, p, sid, 3, w?.reason ?? 'trouble à l’ordre public');
      // trois jours de geôle passent
      advanceTime(state, 3 * MIN_PER_DAY);
      return ok(`Tu te rends. Trois jours de prison passent ; on te relâche, ta dette envers la justice est réglée.`, 3 * MIN_PER_DAY);
    }
    case 'pay': {
      const bribe = Math.ceil((w?.bounty ?? 20) / 2);
      const honest = e.enemies.some(id => state.characters[id].traits.includes('honnete'));
      if (!honest && p.money >= bribe) {
        const taker = state.characters[e.enemies[0]];
        transferMoney(state, P.c(p.id), P.c(taker.id), bribe);
        state.wanted = state.wanted.filter(x => x.characterId !== p.id);
        state.encounter = undefined;
        logEvent(state, { type: 'arrest', actorId: taker.id, targetId: p.id, importance: 2, text: `${fullName(taker)} empoche ${bribe} d et laisse filer ${fullName(p)}.`, witnesses: e.enemies.slice() });
        return ok(`${taker.firstName} empoche tes ${bribe} d et regarde ailleurs. Ton avis de recherche disparaît… des registres de ce garde, du moins.`, 0);
      }
      if (w) w.bounty += 15;
      enemyVolley(); settle();
      return checkPlayerDown(state, honest ? `« Tu crois m'acheter ? » La prime sur ta tête augmente. ${log.join(' ')}` : `Tu n'as pas de quoi les corrompre. ${log.join(' ')}`);
    }
    case 'flee': {
      if (chance(state, clamp(0.3 + p.attributes.agilite * 0.04, 0.1, 0.8))) {
        state.encounter = undefined;
        p.locationId = state.settlements[sid].squareId;
        if (w) w.bounty += 10;
        return ok('Tu files entre les étals et sèmes les gardes. La prime sur ta tête augmente.', 0);
      }
      enemyVolley(); settle();
      return checkPlayerDown(state, `Ils t'agrippent ! ${log.join(' ')}`);
    }
    case 'parley': {
      return ok('« Explique-toi devant l’intendant. » Ils ne lâchent pas prise.', 0);
    }
    case 'fight': {
      exchange(state, [pf], foes, log); settle();
      const left = foes.reduce((s, f) => s + f.hp, 0);
      if (left <= startHp(state) * 0.5 || foes.every(f => f.hp === 0)) {
        for (const id of applyWounds(state, foes, 0.1)) killCharacter(state, state.characters[id], 'en tentant une arrestation');
        if (w) w.bounty += 40; else addWanted(state, p.id, sid, 'violences contre la garde', 60);
        for (const f of foes) modifyRelation(state, f.id, p.id, -30, -30);
        state.encounter = undefined;
        logEvent(state, { type: 'arrest', actorId: p.id, importance: 3, locationId: p.locationId, text: `${fullName(p)} se débat et met les gardes en déroute.`, witnesses: e.enemies.slice() });
        return ok(`Tu mets les gardes en déroute et prends la fuite. ${log.join(' ')} Tu es plus recherché que jamais.`, 0);
      }
      return checkPlayerDown(state, log.join(' '), true);
    }
  }
}

function takeHalfGoods(state: GameState, p: Character, gang: Organization): string {
  const taken: string[] = [];
  for (const it of ITEM_IDS) {
    const n = Math.floor(qty(p.inventory, it) / 2);
    if (n > 0 && transferItem(state, P.c(p.id), P.o(gang.id), it, n)) taken.push(`${n} ${n > 1 ? ITEMS[it].plural : ITEMS[it].name}`);
  }
  return taken.join(', ');
}

/** Le joueur à terre : arrestation (non mortelle) ou brigands (peut-être mortel, et dépouillé). */
function checkPlayerDown(state: GameState, text: string, arrest = false): ActionResult {
  const p = player(state);
  const e = state.encounter!;
  if (p.health > 0) return ok(text, 0);
  if (arrest || e.kind === 'arrest') {
    p.health = 10;
    const sid = settlementIdOf(state, p.locationId);
    state.encounter = undefined;
    jail(state, p, sid, 5, wantedFor(state, p.id)?.reason ?? 'rébellion');
    advanceTime(state, 5 * MIN_PER_DAY);
    return ok(`${text} Tu t'effondres. Tu te réveilles en prison, où tu passes cinq jours.`, 5 * MIN_PER_DAY);
  }
  if (rand(state) < 0.3) {
    killCharacter(state, p, 'sous les coups de brigands');
    state.encounter = undefined;
    return ok(`${text} Tu t'effondres sur la route…`, 0);
  }
  p.health = 8;
  const gang = state.orgs[e.orgId!];
  const cash = p.money;
  transferMoney(state, P.c(p.id), P.o(gang.id), cash);
  const goods = takeHalfGoods(state, p, gang);
  const m = endEncounter(state, true);
  return ok(`${text} Tu perds connaissance. À ton réveil, ta bourse (${cash} d)${goods ? ` et ${goods}` : ''} a disparu. Tu reprends péniblement la route.`, m);
}

/** Les brigands s'enfuient : les blessés restent à terre, prisonniers ou morts ; primes versées. */
function banditsRouted(state: GameState, foes: Fighter[], log: string[]): ActionResult {
  const p = player(state);
  const e = state.encounter!;
  const downed = foes.filter(f => f.hp <= 0).map(f => state.characters[f.id]);
  const dead = applyWounds(state, foes, 0.3);
  let bounty = 0;
  const notes: string[] = [];
  const dest = e.destination ? settlementIdOf(state, e.destination) : settlementIdOf(state, p.homeId);
  for (const c of downed) {
    if (dead.includes(c.id)) { bounty += payBounty(state, p, c); killCharacter(state, c, `tué par ${fullName(p)}`); notes.push(`${c.firstName} est mort`); continue; }
    bounty += payBounty(state, p, c);
    const house = houseOf(state, dest);
    const reward = house ? Math.min(15, house.treasury) : 0; // récompense pour un brigand livré vivant
    if (house && reward > 0 && transferMoney(state, P.o(house.id), P.c(p.id), reward)) bounty += reward;
    jail(state, c, dest, 14, 'brigandage');
    notes.push(`tu livres ${fullName(c)} aux gardes`);
  }
  // les fuyards sont désormais connus
  for (const c of e.enemies.map(id => state.characters[id]).filter(c => c.alive && !downed.includes(c))) {
    if (chance(state, 0.4 + p.attributes.perception * 0.04)) { addWanted(state, c.id, dest, 'brigandage', 40); notes.push(`tu as reconnu ${fullName(c)}`); }
  }
  logEvent(state, { type: 'ambush', actorId: e.enemies[0], targetId: p.id, locationId: e.roadId, importance: 3,
    text: `${fullName(p)} met en fuite des brigands sur ${state.locations[e.roadId!].name}.`, witnesses: [p.id, ...e.enemies] });
  const gang = state.orgs[e.orgId!];
  gang.heat += 20;
  const m = endEncounter(state, true);
  return ok(`${log.join(' ')} Les brigands s'enfuient ! ${notes.join(' ; ')}${bounty ? `. Primes perçues.` : '.'}`, m);
}

// ── Requêtes auprès d'un seigneur ───────────────────────────

export type PetitionKind = 'ecuyer' | 'conseiller' | 'enlist' | 'denounce' | 'lower_tax' | 'raise_tax' | 'peace';

export function houseLedBy(state: GameState, lordId: string): Organization | undefined {
  return orgList(state, 'house').find(h => h.leaderId === lordId);
}

export function petition(state: GameState, lordId: string, kind: PetitionKind): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const lord = state.characters[lordId];
  const house = houseLedBy(state, lordId);
  if (!house || !lord?.alive) return no('Seul un seigneur peut accorder cela.');
  if (lord.locationId !== p.locationId || lord.activity.kind === 'sleep') return no(`${lord.firstName} n'est pas là pour t'entendre.`);
  const r = getRelation(state, lord.id, p.id);
  const wanted = wantedFor(state, p.id);
  const done = (msg: string, mins = 30) => { finish(state, p, mins); return ok(msg, mins); };
  if (wanted && kind !== 'denounce') return done(`${lord.firstName} te fait chasser : on te recherche pour ${wanted.reason}.`, 10);
  switch (kind) {
    case 'ecuyer': {
      if (p.title) return no('Tu portes déjà un titre.');
      const worthy = p.skills.combat >= 25 && r.affinity >= 20;
      const fee = 200;
      if (!worthy && !(p.money >= fee && r.affinity >= 0)) return done(`${lord.firstName} refuse : il faut avoir fait ses preuves (combat 25, son estime) ou s'acquitter de ${fee} d de droits.`, 15);
      if (!worthy) transferMoney(state, P.c(p.id), P.o(house.id), fee);
      p.title = 'ecuyer';
      joinOrg(state, house, p, 'vassal');
      modifyRelation(state, lord.id, p.id, 5, 10);
      logEvent(state, { type: 'title', actorId: p.id, targetId: lord.id, importance: 3, text: `${fullName(lord)} fait de ${fullName(p)} un écuyer de ${house.name}.`, witnesses: [lord.id] });
      return done(`${lord.firstName} te fait écuyer de ${house.name}${worthy ? '' : ` (${fee} d de droits)`}. Tu es désormais vassal de la maison.`);
    }
    case 'conseiller': {
      if (p.title !== 'ecuyer' || !house.members.includes(p.id)) return no('Il faut d’abord être écuyer de cette maison.');
      if (r.affinity < 35 || r.trust < 30) return done(`${lord.firstName} ne t'accorde pas encore assez de confiance (affinité ${r.affinity}/35, confiance ${r.trust}/30).`, 15);
      p.title = 'conseiller';
      house.roles[p.id] = 'conseiller';
      logEvent(state, { type: 'title', actorId: p.id, targetId: lord.id, importance: 3, text: `${fullName(p)} entre au conseil de ${fullName(lord)}.`, witnesses: [lord.id] });
      return done(`Te voilà conseiller de ${fullName(lord)}. Il écoutera tes avis sur l'impôt et la guerre.`);
    }
    case 'enlist': {
      if (orgsOf(state, p.id, 'house').some(h => h.roles[p.id] === 'soldat')) return no('Tu sers déjà.');
      if (activeContract(state, p.id)) return no('Quitte d’abord ta place actuelle.');
      if (r.trust < -10) return done(`${lord.firstName} ne veut pas de toi dans sa garnison.`, 10);
      joinOrg(state, house, p, 'soldat');
      p.profession = 'soldat';
      return done(`Tu t'engages dans la garnison de ${house.name} : 40 d par semaine si tu patrouilles au moins 12 heures. Les soldats en patrouille peuvent arrêter les recherchés.`, 15);
    }
    case 'denounce': {
      const reported: string[] = [];
      for (const id of p.knownEvents) {
        const ev = getEvent(state, id);
        if (!ev || !ev.actorId || ev.actorId === p.id) continue;
        if (!['ambush', 'racket', 'theft_caught', 'plot', 'recruit'].includes(ev.type)) continue;
        const culprit = state.characters[ev.actorId];
        if (!culprit?.alive || wantedFor(state, culprit.id) || culprit.id === lord.id) continue;
        addWanted(state, culprit.id, settlementIdOf(state, p.locationId), ev.type === 'plot' ? 'complot' : ev.type === 'recruit' ? 'appartenance à une bande' : 'brigandage', ev.type === 'plot' ? 100 : 40);
        reported.push(fullName(culprit));
      }
      if (!reported.length) return done('Tu ne sais rien que la justice ignore.', 10);
      modifyRelation(state, lord.id, p.id, 3, 6);
      return done(`Sur ta dénonciation, ${lord.firstName} fait afficher des avis de recherche : ${reported.join(', ')}.`, 20);
    }
    case 'lower_tax': case 'raise_tax': {
      if (p.title !== 'conseiller') return no('Seul un conseiller peut parler de l’impôt.');
      const sid = settlementIdOf(state, p.locationId);
      const st = state.settlements[sid];
      if (st.lordHouseId !== house.id) return no('Cette localité ne relève pas de ce seigneur.');
      const agree = kind === 'lower_tax' ? (st.unrest >= 45 || r.affinity >= 55) && st.taxRate > 0.02 : (house.treasury < 300 || r.affinity >= 55) && st.taxRate < 0.12;
      if (!agree) return done(`${lord.firstName} écoute, puis décide de ne rien changer.`, 20);
      const old = st.taxRate;
      st.taxRate = Math.round((st.taxRate + (kind === 'lower_tax' ? -0.01 : 0.01)) * 100) / 100;
      logEvent(state, { type: 'tax_change', actorId: lord.id, locationId: st.squareId, importance: 2, text: `Sur le conseil de ${fullName(p)}, ${fullName(lord)} fait passer l'impôt de ${st.name} de ${Math.round(old * 100)} % à ${Math.round(st.taxRate * 100)} %.` });
      return done(`${lord.firstName} suit ton conseil : l'impôt de ${st.name} passe à ${Math.round(st.taxRate * 100)} %.`, 20);
    }
    case 'peace': {
      if (p.title !== 'conseiller') return no('Seul un conseiller peut parler de paix.');
      const war = activeWar(state, house.id);
      if (!war) return no('Aucune guerre en cours.');
      const losing = (war.attackerId === house.id ? war.victories.defender : war.victories.attacker) > 0;
      if (!(losing || r.affinity >= 60)) return done(`${lord.firstName} veut encore se battre.`, 20);
      war.status = 'ended';
      war.outcome = `paix blanche négociée par ${fullName(p)}`;
      logEvent(state, { type: 'peace', actorId: p.id, importance: 3, text: `Sur le conseil de ${fullName(p)}, ${house.name} signe une paix blanche.`, witnesses: [lord.id] });
      return done(`Ton conseil l'emporte : ${house.name} signe la paix.`, 30);
    }
  }
}

/** Patrouiller (soldat) : présence dissuasive, arrestations possibles, heures de service comptées. */
export function patrol(state: GameState, hours: number): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const house = orgsOf(state, p.id, 'house').find(h => h.roles[p.id] === 'soldat');
  if (!house) return no('Il faut être soldat d’une maison.');
  const loc = state.locations[p.locationId];
  const own = loc.kind === 'road' ? true : state.settlements[loc.settlementId]?.lordHouseId === house.id;
  if (!own || (loc.kind !== 'square' && loc.kind !== 'road')) return no('On patrouille sur la place d’une localité de ta maison.');
  p.activity = { kind: 'patrol', locationId: p.locationId, since: state.time, note: 'Patrouille' };
  // Un recherché croisé pendant la ronde : tentative d'arrestation (prime à la clé)
  let caught = '';
  const sid = loc.kind === 'road' ? settlementIdOf(state, p.homeId) : loc.settlementId;
  const suspect = state.wanted.map(w => state.characters[w.characterId])
    .find(c => c && c.alive && !c.isPlayer && c.locationId === p.locationId && (c.jailedUntil ?? 0) <= state.time);
  if (suspect) {
    const law = [p, ...charactersAt(state, p.locationId).filter(c => c.id !== suspect.id && (c.profession === 'garde' || c.profession === 'soldat'))];
    const w = wantedFor(state, suspect.id)!;
    const bounty = w.bounty;
    const before = p.money;
    const jailedNow = arrestNpc(state, suspect, law, sid);
    if (jailedNow) {
      // la prime promise revient à celui qui a procédé à l'arrestation
      const house2 = state.orgs[w.houseId];
      const pay = Math.min(bounty, house2.treasury);
      if (pay > 0) transferMoney(state, P.o(house2.id), P.c(p.id), pay);
      caught = ` Tu arrêtes ${fullName(suspect)} : ${p.money - before} d de prime.`;
    } else caught = ` ${fullName(suspect)} t'échappe après une rixe.`;
  }
  const h = Math.max(1, Math.min(8, Math.floor(hours)));
  finish(state, p, h * 60);
  return ok(`Tu patrouilles ${formatDuration(h * 60)} (${house.service[p.id] ?? 0} h cette semaine).${caught}`, h * 60);
}

// ── Famille du joueur (phase 5) ─────────────────────────────

/** Faire la cour : l'attirance grandit selon le charme, la conversation et l'entente. */
export function court(state: GameState, npcId: string): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const n = state.characters[npcId];
  if (!n?.alive || n.locationId !== p.locationId || n.activity.kind === 'sleep') return no('Cette personne n’est pas là.');
  if (p.age < 16 || n.age < 16) return no('Vous êtes trop jeunes.');
  if (p.spouseId) return no('Tu es marié.');
  if (n.spouseId) return no(`${n.firstName} est déjà marié${n.sex === 'F' ? 'e' : ''}.`);
  if (kin(state, p, n)) return no('Ce serait inconvenant : vous êtes de la même famille.');
  const r = getRelation(state, n.id, p.id);
  if (r.affinity < 25) {
    modifyRelation(state, n.id, p.id, -3, -1);
    finish(state, p, 15);
    return ok(`${n.firstName} trouve tes avances déplacées : vous vous connaissez à peine. (affinité −3)`, 15);
  }
  const gain = Math.max(0, Math.round(4 + (p.attributes.charisme - 5) * 1.5 + p.skills.diplomatie / 15 + compatibility(p, n) * 6 + (r.affinity - 25) / 8 + rand(state) * 4 - 2));
  const rel = n.relations[p.id] ?? (n.relations[p.id] = { affinity: 0, trust: 0, lastInteraction: state.time });
  rel.romance = Math.min(100, (rel.romance ?? 0) + gain);
  modifyRelation(state, n.id, p.id, 2, 1);
  p.needs.social = clamp(p.needs.social + 10, 0, 100);
  finish(state, p, 30);
  const rm = rel.romance;
  const mood = rm >= 70 ? 'rougit et ne cache plus son inclination' : rm >= 40 ? 'sourit volontiers à tes attentions' : rm >= 15 ? 'semble flatté' + (n.sex === 'F' ? 'e' : '') : 'reste sur la réserve';
  return ok(`Tu fais la cour à ${n.firstName}, qui ${mood}. (attirance ${rm}/100)`, 30);
}

export function proposeMarriage(state: GameState, npcId: string): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const n = state.characters[npcId];
  if (!n?.alive || n.locationId !== p.locationId) return no('Cette personne n’est pas là.');
  if (p.spouseId || n.spouseId || kin(state, p, n) || p.age < 16 || n.age < 16) return no('Ce mariage est impossible.');
  const r = getRelation(state, n.id, p.id);
  if ((r.romance ?? 0) < 70 || r.affinity < 50 || r.trust < 30) {
    finish(state, p, 15);
    return ok(`${n.firstName} décline : « Pas encore. » (attirance ${r.romance ?? 0}/70, affinité ${r.affinity}/50, confiance ${r.trust}/30)`, 15);
  }
  wed(state, p, n);
  finish(state, p, 120);
  return ok(`${n.firstName} accepte ! Les noces sont célébrées. Vous partagez désormais un foyer${p.homeId === n.homeId ? ` (${state.locations[p.homeId].name})` : ''}.`, 120);
}

/** Vivre au jour le jour : l'IA conduit le joueur ; s'interrompt en cas de rencontre, de mort ou de fin. */
export function liveDays(state: GameState, days: number): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const money0 = p.money, t0 = state.time, seq0 = state.eventSeq;
  state.autopilotUntil = state.time + days * MIN_PER_DAY;
  for (let i = 0; i < days * 24; i++) {
    advanceTime(state, 60);
    if (state.encounter || state.gameOver || state.pendingSuccession) break;
  }
  state.autopilotUntil = undefined;
  const elapsed = state.time - t0;
  const mine = state.events.filter(e => Number(e.id.slice(1)) > seq0 && e.importance >= 2 && (e.actorId === p.id || e.targetId === p.id || p.knownEvents.includes(e.id)));
  const why = state.encounter ? ' Un imprévu interrompt le cours des jours.' : state.pendingSuccession ? ' La mort t’a surpris.' : '';
  return ok(`${formatDuration(elapsed)} passent au fil des jours. Bourse : ${money0} → ${p.money} d.${mine.length ? ` Faits marquants : ${mine.slice(-4).map(e => e.text).join(' ')}` : ''}${why}`, elapsed);
}

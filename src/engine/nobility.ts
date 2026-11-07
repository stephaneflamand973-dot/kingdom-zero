// ─────────────────────────────────────────────────────────────
// Noblesse et gouvernement (phase 4) : tribut, garnison, impôts, grogne et révoltes,
// diplomatie entre maisons, guerres et conquêtes, complots, guilde des marchands.
// ─────────────────────────────────────────────────────────────
import { applyWounds, autoBattle, fighterOf, strength } from './combat';
import { P, reserveFor, transferMoney } from './economy';
import { logEvent } from './events';
import { addWanted, jail } from './justice';
import { freeMembers, lordKnowsAmbushes } from './gangs';
import { isJailed, joinOrg, leaveOrg, orgList, soldiersOf } from './orgs';
import { chance } from './rng';
import { killCharacter } from './sim';
import { modifyRelation } from './social';
import { toDate } from './time';
import type { GameState, Organization, Settlement, War } from './types';
import { aliveCharacters, businessesIn, fullName, hasTrait, manorOf, newId, residents, roadPath, settlementIdOf } from './util';

export const SOLDIER_PAY = 40;

export function landsOf(state: GameState, house: Organization): Settlement[] {
  return state.settlementOrder.map(id => state.settlements[id]).filter(s => s.lordHouseId === house.id);
}

export function militaryStrength(state: GameState, house: Organization): number {
  return strength(soldiersOf(state, house).map(fighterOf));
}

export function activeWar(state: GameState, houseId?: string): War | undefined {
  return state.wars.find(w => w.status === 'active' && (!houseId || w.attackerId === houseId || w.defenderId === houseId));
}

// ── Grogne ───────────────────────────────────────────────────

/** Grogne d'une localité, calculée à partir de faits réels. */
export function computeUnrest(state: GameState, st: Settlement): number {
  const pop = residents(state, st.id);
  if (!pop.length) return 0;
  const hunger = pop.reduce((s, c) => s + c.needs.hunger, 0) / pop.length;
  const day = toDate(state.time).day;
  const crimes = state.events.filter(e => (e.type === 'ambush' || e.type === 'racket' || e.type === 'vandalism' || e.type === 'theft')
    && toDate(e.time).day >= day - 28 && e.locationId && settlementIdOf(state, e.locationId) === st.id).length;
  const war = activeWar(state, st.lordHouseId) ? 15 : 0;
  const v = hunger * 0.35 + st.taxRate * 250 + Math.min(20, crimes * 1.5) + (100 - st.prosperity) * 0.25 + war;
  return Math.round(Math.max(0, Math.min(100, v)));
}

// ── Gouvernement hebdomadaire ───────────────────────────────

export function weeklyGovernance(state: GameState): void {
  const day = toDate(state.time).day;
  for (const house of orgList(state, 'house')) {
    const lord = house.leaderId ? state.characters[house.leaderId] : undefined;
    if (!lord) continue;
    const lands = landsOf(state, house);
    // 1. Tribut des intendances (sauf en révolte)
    for (const st of lands) {
      if ((st.revoltUntilDay ?? -1) >= day) continue;
      const manor = manorOf(state, st.id);
      const t = Math.floor(Math.max(0, manor.treasury - 300) * 0.3);
      if (t > 0) {
        transferMoney(state, P.b(manor.id), P.o(house.id), t);
        logEvent(state, { type: 'tribute', businessId: manor.id, importance: 1, text: `${manor.name} verse ${t} d de tribut à ${house.name}.` });
      }
    }
    // 1 bis. Train de vie : le seigneur et sa famille vivent sur le trésor de la maison
    for (const id of house.members) {
      const role = house.roles[id], c = state.characters[id];
      if (!c?.alive || (role !== 'seigneur' && role !== 'heritier') || c.money >= 60) continue;
      transferMoney(state, P.o(house.id), P.c(id), Math.min(role === 'seigneur' ? 35 : 25, house.treasury));
    }
    // 1 ter. Secours en cas de disette : la maison renfloue l'intendance pour nourrir les affamés
    for (const st of lands) {
      const pop = residents(state, st.id);
      const hungry = pop.filter(c => c.needs.hunger > 60 && c.money < 10).length;
      if (hungry >= 2 && house.treasury > 150 && !hasTrait(lord, 'avare')) {
        const aid = Math.min(120, Math.floor(house.treasury / 3));
        transferMoney(state, P.o(house.id), P.b(st.manorId), aid);
        logEvent(state, { type: 'help', actorId: lord.id, locationId: st.squareId, importance: 2,
          text: `${fullName(lord)} envoie ${aid} d à l'intendance de ${st.name} pour nourrir ${hungry} affamés.`, witnesses: pop.map(c => c.id) });
      }
    }
    // 2. Solde des soldats ; sans solde, ils désertent
    for (const id of house.members.slice()) {
      if (house.roles[id] !== 'soldat') continue;
      const s = state.characters[id];
      if (!s?.alive || (s.profession !== 'soldat' && !s.isPlayer)) continue; // les gardes sont payés par l'intendance
      const served = house.service[id] ?? 0;
      house.service[id] = 0;
      if (s.isPlayer && served < 12) {
        logEvent(state, { type: 'title', actorId: s.id, importance: 1, text: `Pas de solde cette semaine : ${served} h de patrouille sur 12 exigées.` });
        continue;
      }
      if (!transferMoney(state, P.o(house.id), P.c(id), SOLDIER_PAY)) {
        leaveOrg(state, house, s);
        if (s.profession === 'soldat') s.profession = 'sans_emploi';
        logEvent(state, { type: 'title', actorId: s.id, importance: 2, text: `${fullName(s)} déserte ${house.name}, faute de solde.`, witnesses: [s.id, lord.id] });
      }
    }
    // 3. Recrutement selon la menace (brigands connus, guerre) et les moyens
    const threat = lordKnowsAmbushes(state, house).length + (activeWar(state, house.id) ? 3 : 0) + (house.heat > 30 ? 1 : 0);
    const wanted = 2 + Math.min(4, threat);
    const affordable = Math.floor(house.treasury / (SOLDIER_PAY * 6));
    const soldiers = house.members.filter(id => house.roles[id] === 'soldat' && state.characters[id]?.alive).length;
    if (soldiers < Math.min(wanted, affordable)) {
      const recruit = lands.flatMap(st => residents(state, st.id))
        .filter(c => !c.employerId && c.age >= 17 && c.age < 45 && c.health > 60 && !isJailed(state, c)
          && !orgList(state).some(o => o.members.includes(c.id)) && !state.wanted.some(w => w.characterId === c.id))
        .sort((a, b) => b.skills.combat + b.attributes.force * 3 - (a.skills.combat + a.attributes.force * 3) || (a.id < b.id ? -1 : 1))[0];
      if (recruit) {
        joinOrg(state, house, recruit, 'soldat');
        recruit.profession = 'soldat';
        recruit.goal = { kind: 'servir' };
        logEvent(state, { type: 'title', actorId: recruit.id, importance: 2, text: `${fullName(recruit)} s'engage comme soldat de ${house.name} (${SOLDIER_PAY} d la semaine).`, witnesses: [recruit.id, lord.id] });
      }
    }
    // 4. Patrouilles sur les routes où l'on sait que des brigands frappent
    house.patrolRoads = [...new Set([...house.patrolRoads, ...lordKnowsAmbushes(state, house)])].slice(-2);
    house.heat = Math.max(0, house.heat - 5);
    // 5. Impôts selon la grogne et les besoins du trésor
    for (const st of lands) {
      st.unrest = computeUnrest(state, st);
      st.unrestWeeks = st.unrest >= 70 ? st.unrestWeeks + 1 : 0;
      const old = st.taxRate;
      if (st.unrest >= 60 && st.taxRate > 0.02) st.taxRate = Math.round((st.taxRate - 0.01) * 100) / 100;
      else if (house.treasury < 150 && st.unrest < 40 && st.taxRate < 0.12 && !hasTrait(lord, 'genereux')) st.taxRate = Math.round((st.taxRate + (activeWar(state, house.id) ? 0.02 : 0.01)) * 100) / 100;
      if (st.taxRate !== old) {
        logEvent(state, { type: 'tax_change', actorId: lord.id, locationId: st.squareId, importance: 2,
          text: `${fullName(lord)} ${st.taxRate > old ? 'relève' : 'abaisse'} l'impôt de ${st.name} à ${Math.round(st.taxRate * 100)} %${st.taxRate > old ? ' : le trésor de la maison est vide' : ' pour apaiser la grogne'}.`,
          witnesses: residents(state, st.id).map(c => c.id) });
      }
      // 6. Révolte après deux semaines de forte grogne
      if (st.unrestWeeks >= 2 && (st.revoltUntilDay ?? -1) < day) {
        st.revoltUntilDay = day + 14;
        st.taxRate = Math.max(0.02, Math.round((st.taxRate - 0.02) * 100) / 100);
        for (const c of residents(state, st.id)) modifyRelation(state, c.id, lord.id, -10, -10);
        logEvent(state, { type: 'revolt', actorId: lord.id, locationId: st.squareId, importance: 3,
          text: `Révolte à ${st.name} (grogne ${st.unrest}) : les habitants refusent l'impôt pour deux semaines. ${fullName(lord)} abaisse la taxe à ${Math.round(st.taxRate * 100)} %.`,
          witnesses: aliveCharacters(state).map(c => c.id) });
      }
    }
  }
  diplomacy(state);
  warWeek(state);
  guildWeek(state);
}

// ── Diplomatie et guerre ────────────────────────────────────

function relation(a: Organization, b: Organization): number { return a.relations[b.id] ?? 0; }
function setRelation(a: Organization, b: Organization, v: number): void {
  const x = Math.max(-100, Math.min(100, Math.round(v)));
  a.relations[b.id] = x; b.relations[a.id] = x;
}

function diplomacy(state: GameState): void {
  const houses = orgList(state, 'house');
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) {
    const a = houses[i], b = houses[j];
    const la = a.leaderId ? state.characters[a.leaderId] : undefined, lb = b.leaderId ? state.characters[b.leaderId] : undefined;
    if (!la || !lb) continue;
    let d = 0;
    if (hasTrait(la, 'ambitieux') || hasTrait(lb, 'ambitieux')) d -= 2;
    if (hasTrait(la, 'colerique') || hasTrait(lb, 'colerique')) d -= 1;
    if (hasTrait(la, 'honnete') && hasTrait(lb, 'honnete')) d += 2;
    if (!activeWar(state)) d += 1; // la paix use les rancunes
    setRelation(a, b, relation(a, b) + d);
    // Déclaration de guerre : rancune profonde, chef belliqueux, nette supériorité, cible voisine
    if (activeWar(state)) continue;
    for (const [att, def, lord] of [[a, b, la], [b, a, lb]] as const) {
      if (relation(att, def) > -60 || !(hasTrait(lord, 'ambitieux') || hasTrait(lord, 'colerique'))) continue;
      const sa = militaryStrength(state, att) + att.treasury / 100, sd = militaryStrength(state, def) + def.treasury / 100;
      if (sa < sd * 1.1) continue;
      const target = landsOf(state, def).find(st => landsOf(state, att).some(own => roadPath(state, own.id, st.id)?.roads.length === 1));
      if (!target) continue;
      const war: War = { id: newId(state, 'w'), attackerId: att.id, defenderId: def.id, targetSettlementId: target.id, startDay: toDate(state.time).day, victories: { attacker: 0, defender: 0 }, battles: 0, status: 'active' };
      state.wars.push(war);
      logEvent(state, { type: 'war', actorId: lord.id, locationId: target.squareId, importance: 3,
        text: `${fullName(lord)} déclare la guerre à ${def.name} et revendique ${target.name}.`, witnesses: aliveCharacters(state).map(c => c.id) });
      break;
    }
  }
}

/** Une bataille par semaine devant la localité disputée. Deux victoires décident de la guerre. */
function warWeek(state: GameState): void {
  const war = activeWar(state);
  if (!war) return;
  const att = state.orgs[war.attackerId], def = state.orgs[war.defenderId];
  const target = state.settlements[war.targetSettlementId];
  const A = soldiersOf(state, att), D = soldiersOf(state, def);
  war.battles += 1;
  let winner: 'a' | 'b' | 'none';
  let dead: string[] = [];
  if (!A.length && !D.length) winner = 'none';
  else if (!D.length) winner = 'a';
  else if (!A.length) winner = 'b';
  else {
    const fa = A.map(fighterOf), fd = D.map(fighterOf);
    winner = autoBattle(state, fa, fd, 8).winner;
    dead = applyWounds(state, [...fa, ...fd], 0.3);
  }
  if (winner === 'a') war.victories.attacker += 1;
  if (winner === 'b') war.victories.defender += 1;
  logEvent(state, { type: 'battle', locationId: target.squareId, importance: 3,
    text: `Bataille devant ${target.name} : ${A.length} soldats de ${att.name} contre ${D.length} de ${def.name}. ${winner === 'a' ? `${att.name} l'emporte` : winner === 'b' ? `${def.name} tient bon` : 'Aucun vainqueur'}${dead.length ? ` ; ${dead.length} mort${dead.length > 1 ? 's' : ''}` : ''}.`,
    witnesses: residents(state, target.id).map(c => c.id).concat(A.map(c => c.id), D.map(c => c.id)) });
  for (const id of dead) killCharacter(state, state.characters[id], 'au combat');
  // Issue
  if (war.victories.attacker >= 2) {
    war.status = 'ended';
    war.outcome = `${att.name} s'empare de ${target.name}`;
    target.lordHouseId = att.id;
    setRelation(att, def, -70);
    const lord = att.leaderId ? state.characters[att.leaderId] : undefined;
    for (const c of residents(state, target.id)) if (lord) modifyRelation(state, c.id, lord.id, -10, -15);
    logEvent(state, { type: 'conquest', locationId: target.squareId, importance: 3,
      text: `${target.name} passe sous la domination de ${att.name}. Le tribut ira désormais à ${lord ? fullName(lord) : att.name}.`, witnesses: aliveCharacters(state).map(c => c.id) });
  } else if (war.victories.defender >= 2 || war.battles >= 6 || att.treasury < 20) {
    war.status = 'ended';
    const indemnity = Math.floor(att.treasury * 0.25);
    if (indemnity > 0) transferMoney(state, P.o(att.id), P.o(def.id), indemnity);
    war.outcome = `paix ; ${att.name} verse ${indemnity} d`;
    setRelation(att, def, -30);
    logEvent(state, { type: 'peace', locationId: target.squareId, importance: 3,
      text: `Paix entre ${att.name} et ${def.name} : ${target.name} reste à ${def.name}${indemnity ? `, ${att.name} paie ${indemnity} d d'indemnité` : ''}.`, witnesses: aliveCharacters(state).map(c => c.id) });
  }
}

// ── Complots ────────────────────────────────────────────────

/** Une fois par mois : un héritier ambitieux et sans scrupule peut faire assassiner son seigneur. */
export function monthlyIntrigues(state: GameState): void {
  for (const house of orgList(state, 'house')) {
    const lord = house.leaderId ? state.characters[house.leaderId] : undefined;
    const heir = house.members.map(id => state.characters[id]).find(c => c?.alive && house.roles[c.id] === 'heritier');
    if (!lord || !heir || isJailed(state, heir)) continue;
    if (!hasTrait(heir, 'ambitieux') || !(hasTrait(heir, 'malhonnete') || hasTrait(heir, 'rancunier'))) continue;
    if ((lord.relations[heir.id]?.affinity ?? 0) > 20 && (heir.relations[lord.id]?.affinity ?? 0) > 0) continue;
    const gang = orgList(state, 'gang').find(g => freeMembers(state, g).length >= 2);
    const fee = Math.min(heir.money, 40);
    if (!gang || fee < 25 || !chance(state, 0.35)) continue;
    transferMoney(state, P.c(heir.id), P.o(gang.id), fee);
    const plot = logEvent(state, { type: 'plot', actorId: heir.id, targetId: lord.id, importance: 3,
      text: `${fullName(heir)} paie ${fee} d à ${gang.name} pour faire assassiner ${fullName(lord)}.`,
      witnesses: [heir.id, ...(gang.leaderId ? [gang.leaderId] : [])] });
    // La nuit même : les assassins contre le seigneur et ses gardes présents
    const assassins = freeMembers(state, gang).slice(0, 2);
    const guards = soldiersOf(state, house).filter(s => s.locationId === lord.locationId);
    const A = assassins.map(fighterOf), D = [lord, ...guards].map(fighterOf);
    const r = autoBattle(state, A, D, 6);
    const downed = A.filter(f => f.hp <= 0).map(f => f.id);
    const dead = applyWounds(state, [...A, ...D], 0.5);
    const lordDead = dead.includes(lord.id);
    for (const id of dead) killCharacter(state, state.characters[id], id === lord.id ? 'assassiné' : 'lors d’un attentat');
    const captured = downed.map(id => state.characters[id]).find(c => c?.alive);
    if (captured) {
      // l'assassin capturé avoue : le complot devient public
      logEvent(state, { type: 'plot', actorId: heir.id, targetId: lord.id, importance: 3, causeIds: [plot.id],
        text: `Un assassin capturé, ${fullName(captured)}, avoue avoir été payé par ${fullName(heir)}.`, witnesses: aliveCharacters(state).map(c => c.id) });
      const sid = settlementIdOf(state, lord.homeId);
      jail(state, captured, sid, 21, 'tentative d’assassinat');
      if (house.members.includes(heir.id)) { leaveOrg(state, house, heir); }
      addWanted(state, heir.id, sid, 'complot contre son seigneur', 120);
    } else if (!lordDead && r.winner !== 'a') {
      logEvent(state, { type: 'assassination', targetId: lord.id, importance: 3, text: `${fullName(lord)} échappe à des assassins dans la nuit.`, witnesses: aliveCharacters(state).map(c => c.id) });
    }
  }
}

// ── Guilde ──────────────────────────────────────────────────

/** Cotisations, puis secours aux affaires de membres en difficulté. */
function guildWeek(state: GameState): void {
  for (const g of orgList(state, 'guild')) {
    for (const id of g.members) {
      const c = state.characters[id];
      if (c?.alive && c.money >= g.dues) transferMoney(state, P.c(id), P.o(g.id), g.dues);
    }
    for (const id of g.members) {
      const c = state.characters[id];
      if (!c?.alive) continue;
      const biz = businessesIn(state, settlementIdOf(state, c.homeId)).find(b => b.ownerId === id);
      if (!biz || biz.treasury >= reserveFor(biz) / 2 || g.treasury < 40) continue;
      const aid = Math.min(80, Math.floor(g.treasury / 2));
      transferMoney(state, P.o(g.id), P.b(biz.id), aid);
      logEvent(state, { type: 'help', actorId: g.leaderId ?? undefined, targetId: id, businessId: biz.id, importance: 2,
        text: `${g.name} renfloue ${biz.name} de ${aid} d pour secourir ${fullName(c)}.`, witnesses: g.members.slice() });
    }
  }
}


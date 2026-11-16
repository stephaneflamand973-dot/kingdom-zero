// ─────────────────────────────────────────────────────────────
// Phase 12 — Tournois de saison.
// Chaque maison qui en a les moyens annonce, le jour de la fête de saison, un tournoi
// dans sa localité-siège dix jours plus tard. Les meilleurs combattants de la région
// s'affrontent en duels courtois (premier à perdre 25 points de vie) ; le joueur
// peut entrer en lice et livre ses assauts lui-même, posture par posture.
// Le prix vient réellement du trésor de la maison et des droits d'inscription.
// ─────────────────────────────────────────────────────────────
import { applyStance, exchange, fighterOf, type Fighter, type Stance } from './combat';
import { P, transferMoney } from './economy';
import { logEvent } from './events';
import { GEAR, wearGear } from './gear';
import { wantedFor } from './justice';
import { activeWar, landsOf } from './nobility';
import { isJailed, joinOrg, orgList } from './orgs';
import { finish, guard } from './player';
import { chronicle } from './quests';
import { rand } from './rng';
import { gainXp } from './skills';
import { modifyRelation } from './social';
import { toDate } from './time';
import type { ActionResult, Character, GameState, Tourney } from './types';
import { aliveCharacters, clamp, fullName, newId, residents, settlementIdOf } from './util';

const ok = (message: string, minutes: number): ActionResult => ({ ok: true, message, minutes });
const no = (message: string): ActionResult => ({ ok: false, message, minutes: 0 });

export const TOURNEY_FEE = 10;
export const BOUT_LOSS = 25;   // un assaut est perdu quand on a encaissé 25 points
const FIELD = 8;               // tableau de huit

function ofHouse(name: string): string { return /^Maison/.test(name) ? `de la ${name}` : `de ${name}`; }

export function tourneyName(state: GameState, t: Tourney): string {
  return `Tournoi ${ofHouse(state.orgs[t.houseId]?.name ?? 'Maison')} à ${state.settlements[t.settlementId].name}`;
}

/** Le jour de la fête de saison : chaque maison qui le peut annonce son tournoi pour le dixième jour. */
export function announceTourneys(state: GameState): void {
  const d = toDate(state.time);
  state.tourneys = (state.tourneys ?? []).filter(t => t.status !== 'done' || d.day - t.day < 60);
  for (const house of orgList(state, 'house')) {
    const lord = house.leaderId ? state.characters[house.leaderId] : undefined;
    const lands = landsOf(state, house);
    if (!lord?.alive || !lands.length || house.treasury < 120 || activeWar(state, house.id)) continue;
    const seat = lands.find(s => s.id === house.seatId) ?? lands[0];
    if (state.tourneys.some(t => t.settlementId === seat.id && t.status === 'announced')) continue;
    const t: Tourney = { id: newId(state, 'tn'), houseId: house.id, settlementId: seat.id, day: d.day + 9, fee: TOURNEY_FEE,
      purse: Math.min(80, Math.floor(house.treasury * 0.15)), fees: 0, status: 'announced', next: [], queue: [], round: 0, log: [] };
    state.tourneys.push(t);
    logEvent(state, { type: 'festival', actorId: lord.id, locationId: seat.squareId, importance: 2,
      text: `${fullName(lord)} annonce un tournoi à ${seat.name} dans neuf jours, au matin : ${t.purse} d au vainqueur, plus les droits d'inscription (${t.fee} d).`,
      witnesses: aliveCharacters(state).map(c => c.id) });
  }
}

/** Tournoi annoncé dans cette localité, pour aujourd'hui ou plus tard. */
export function upcomingTourney(state: GameState, settlementId?: string): Tourney | undefined {
  return (state.tourneys ?? []).filter(t => t.status !== 'done' && (!settlementId || t.settlementId === settlementId)).sort((a, b) => a.day - b.day)[0];
}

export function tourneyOpen(state: GameState, t: Tourney): boolean {
  const d = toDate(state.time);
  return t.status === 'announced' && t.day === d.day && d.hour >= 8 && d.hour < 13;
}

/** Les meilleurs combattants de la région, hors joueur. */
function contenders(state: GameState, n: number): Character[] {
  const lords = new Set(orgList(state, 'house').map(h => h.leaderId)); // les seigneurs président, ils ne joutent pas
  return aliveCharacters(state)
    .filter(c => !c.isPlayer && !lords.has(c.id) && c.age >= 17 && c.age <= 50 && c.health >= 60 && !isJailed(state, c) && !wantedFor(state, c.id)
      && (c.profession === 'soldat' || c.profession === 'garde' || c.skills.combat >= 25))
    .sort((a, b) => b.skills.combat + b.attributes.force * 3 - (a.skills.combat + a.attributes.force * 3) || (a.id < b.id ? -1 : 1))
    .slice(0, n);
}

function shuffle<T>(state: GameState, xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(state) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Inscrit les concurrents ; ceux qui en ont les moyens paient leurs droits à la maison. */
function openLists(state: GameState, t: Tourney, withPlayer: boolean): boolean {
  const field = contenders(state, withPlayer ? FIELD - 1 : FIELD);
  if (field.length + (withPlayer ? 1 : 0) < 2) return false;
  for (const c of field) {
    if (c.money >= t.fee + 30 && transferMoney(state, P.c(c.id), P.o(t.houseId), t.fee)) t.fees += t.fee;
  }
  t.status = 'running';
  t.round = 0;
  t.next = shuffle(state, [...field.map(c => c.id), ...(withPlayer ? [state.playerId] : [])]);
  t.queue = [];
  t.log.push(`${field.length + (withPlayer ? 1 : 0)} concurrents entrent en lice.`);
  return true;
}

/** En lice, on joute à armes émoussées : la moitié seulement du mordant d'une arme forgée compte. */
function courteous(c: Character): Fighter {
  const f = fighterOf(c);
  if (c.gear?.weapon) f.attack -= GEAR[c.gear.weapon.id].attack / 2;
  return f;
}

/** Assaut courtois entre deux PNJ. */
function npcBout(state: GameState, aId: string, bId: string): [string, string] {
  const a = state.characters[aId], b = state.characters[bId];
  const fa = courteous(a), fb = courteous(b);
  const a0 = fa.hp, b0 = fb.hp;
  for (let r = 0; r < 6; r++) {
    exchange(state, [fa], [fb], []);
    if (a0 - fa.hp >= BOUT_LOSS || b0 - fb.hp >= BOUT_LOSS || fa.hp <= 15 || fb.hp <= 15) break;
  }
  a.health = clamp(Math.max(fa.hp, 15), 0, 100);
  b.health = clamp(Math.max(fb.hp, 15), 0, 100);
  const la = a0 - fa.hp, lb = b0 - fb.hp;
  const aWins = la !== lb ? la < lb : a.skills.combat !== b.skills.combat ? a.skills.combat > b.skills.combat : a.id < b.id;
  const [w, l] = aWins ? [a, b] : [b, a];
  gainXp(state, w, 'combat', 0.4);
  return [w.id, `${fullName(w)} l'emporte sur ${fullName(l)}.`];
}

/**
 * Fait avancer le tableau jusqu'au prochain assaut du joueur, ou jusqu'à la fin.
 * Renvoie le texte des assauts livrés entre-temps.
 */
function proceed(state: GameState, t: Tourney): string[] {
  const out: string[] = [];
  try {
    for (;;) {
      if (!t.queue.length) {
        const pool = t.next;
        t.next = [];
        if (pool.length <= 1) { out.push(...finishTourney(state, t, pool[0])); return out; }
        t.round += 1;
        for (let i = 0; i < pool.length; i += 2) t.queue.push(pool.slice(i, i + 2));
        out.push(pool.length === 2 ? 'La finale commence.' : pool.length <= 4 ? 'Les demi-finales commencent.' : `Le tour ${t.round} commence.`);
      }
      const pair = t.queue[0];
      if (pair.length === 1) { t.next.push(pair[0]); t.queue.shift(); continue; }
      if (pair.includes(state.playerId)) {
        const opp = state.characters[pair[0] === state.playerId ? pair[1] : pair[0]];
        startBout(state, t, opp);
        out.push(`À toi : tu affrontes ${fullName(opp)} (combat ${opp.skills.combat}).`);
        return out;
      }
      const [w, line] = npcBout(state, pair[0], pair[1]);
      t.next.push(w);
      t.queue.shift();
      // on ne raconte au joueur que les assauts qui le concernent ou le dernier carré
      if (t.playerIn && (t.queue.length <= 2 || t.next.length + t.queue.length <= 4)) out.push(line);
    }
  } finally { t.log.push(...out); }
}

function startBout(state: GameState, t: Tourney, opp: Character): void {
  const p = state.characters[state.playerId];
  state.encounter = {
    kind: 'duel', tourneyId: t.id, enemies: [opp.id], hp: { [opp.id]: Math.round(opp.health) },
    duelStart: { [p.id]: Math.round(p.health), [opp.id]: Math.round(opp.health) },
    demand: 0, remainingMinutes: 0, log: [`${tourneyName(state, t)} — ${t.queue.length === 1 && t.next.length === 0 ? 'finale' : `tour ${t.round}`} : ${fullName(opp)} salue et lève son arme.`], round: 0,
  };
}

function finishTourney(state: GameState, t: Tourney, championId?: string): string[] {
  t.status = 'done';
  t.championId = championId;
  const house = state.orgs[t.houseId];
  const st = state.settlements[t.settlementId];
  const champ = championId ? state.characters[championId] : undefined;
  if (!champ || !house) return ['Le tournoi s’achève sans vainqueur.'];
  const prize = Math.max(0, Math.min(house.treasury, t.purse + t.fees));
  if (prize > 0) transferMoney(state, P.o(house.id), P.c(champ.id), prize);
  const lord = house.leaderId ? state.characters[house.leaderId] : undefined;
  const out = [champ.isPlayer ? `Tu remportes le tournoi et ${prize} d !` : `${fullName(champ)} remporte le tournoi et ${prize} d.`];
  const witnesses = residents(state, st.id).map(c => c.id);
  logEvent(state, { type: 'festival', actorId: champ.id, locationId: st.squareId, importance: 3,
    text: `${fullName(champ)} remporte le tournoi ${ofHouse(house.name)} à ${st.name} (${prize} d).`, witnesses: [...witnesses, ...(lord ? [lord.id] : [])] });
  if (lord && lord.id !== champ.id) modifyRelation(state, lord.id, champ.id, 8, 5);
  if (champ.isPlayer) {
    for (const id of house.members) if (id !== champ.id) modifyRelation(state, id, champ.id, 6, 3);
    for (const id of witnesses) if (id !== champ.id) modifyRelation(state, id, champ.id, 4, 2);
    gainXp(state, champ, 'combat', 3);
    chronicle(state, `${fullName(champ)} remporte le tournoi ${ofHouse(house.name)} à ${st.name}.`);
    // un champion sans titre est armé écuyer par le seigneur qui donnait le tournoi
    if (!champ.title && lord && !lord.isPlayer && lord.alive && !wantedFor(state, champ.id)) {
      champ.title = 'ecuyer';
      joinOrg(state, house, champ, 'vassal');
      logEvent(state, { type: 'title', actorId: champ.id, targetId: lord.id, importance: 3, text: `${fullName(lord)} arme ${fullName(champ)} écuyer de ${house.name} au soir du tournoi.`, witnesses: [lord.id, ...witnesses] });
      chronicle(state, `${fullName(lord)} arme ${fullName(champ)} écuyer de ${house.name}.`);
      out.push(`${lord.firstName} t’arme écuyer de ${house.name} : te voilà vassal de la maison.`);
    }
  }
  return out;
}

/** Entrer en lice (8 h – 13 h, le jour du tournoi, dans la localité). */
export function enterTourney(state: GameState): ActionResult {
  const g = guard(state); if (g) return g;
  const p = state.characters[state.playerId];
  const sid = settlementIdOf(state, p.locationId);
  const t = upcomingTourney(state, sid);
  if (!t) return no('Aucun tournoi n’est annoncé ici.');
  const d = toDate(state.time);
  if (t.day !== d.day) return no(`Le tournoi aura lieu dans ${t.day - d.day} jour${t.day - d.day > 1 ? 's' : ''}, au matin.`);
  if (!tourneyOpen(state, t)) return no('Les lices sont ouvertes de 8 h à 13 h.');
  if (wantedFor(state, p.id)) return no('Un homme recherché ne se montre pas en lice devant tout le pays.');
  if (p.health < 50 || p.needs.energy < 30) return no('Tu n’es pas en état de jouter (santé 50 et énergie 30 au moins).');
  if (p.money < t.fee) return no(`Les droits d’inscription sont de ${t.fee} d.`);
  transferMoney(state, P.c(p.id), P.o(t.houseId), t.fee);
  t.fees += t.fee;
  t.playerIn = true;
  if (!openLists(state, t, true)) { t.status = 'done'; return ok('Personne ne se présente contre toi : le tournoi est annulé.', 0); }
  finish(state, p, 30);
  const lines = proceed(state, t);
  return ok(`Tu verses ${t.fee} d et entres en lice. ${lines.join(' ')}`, 30);
}

/** À 13 h, un tournoi que le joueur n'a pas rejoint se joue sans lui. */
export function hourlyTourneys(state: GameState): void {
  const d = toDate(state.time);
  for (const t of state.tourneys ?? []) {
    if (t.status !== 'announced' || t.day > d.day) continue;
    if (t.day < d.day || d.hour >= 13) {
      if (!openLists(state, t, false)) { t.status = 'done'; continue; }
      proceed(state, t);
    }
  }
}

/** Un tour d'assaut du joueur (posture choisie, ou abandon). */
export function boutAction(state: GameState, choice: Stance | 'surrender'): ActionResult {
  const e = state.encounter;
  if (!e || e.kind !== 'duel') return no('Aucun assaut en cours.');
  const t = (state.tourneys ?? []).find(x => x.id === e.tourneyId);
  const p = state.characters[state.playerId];
  const opp = state.characters[e.enemies[0]];
  if (!t || !opp) { state.encounter = undefined; return no('Le tournoi n’a plus lieu.'); }
  e.round += 1;
  const log: string[] = [];
  let playerWins: boolean | undefined;
  if (choice === 'surrender') {
    playerWins = false;
    log.push(`Tu lèves la main : tu cèdes l'assaut à ${opp.firstName}.`);
  } else {
    const pf = courteous(p), of = { ...courteous(opp), hp: e.hp[opp.id] ?? Math.round(opp.health) };
    const hp0 = pf.hp;
    applyStance(state, pf, p, choice, [opp], log);
    exchange(state, [pf], [of], log);
    p.health = clamp(Math.max(pf.hp, 5), 0, 100); // on ne meurt pas en lice
    e.hp[opp.id] = Math.max(of.hp, 5);
    log.push(...wearGear(state, p, !pf.holds, pf.hp < hp0));
    const lossP = (e.duelStart?.[p.id] ?? 100) - p.health, lossO = (e.duelStart?.[opp.id] ?? 100) - e.hp[opp.id];
    if (lossO >= BOUT_LOSS || e.hp[opp.id] <= 15) playerWins = true;
    else if (lossP >= BOUT_LOSS || p.health <= 15) playerWins = false;
    else if (e.round >= 8) { playerWins = lossP < lossO; log.push(`Les juges arrêtent l'assaut et le donnent à ${playerWins ? 'toi' : opp.firstName}.`); }
  }
  e.log.push(...log);
  if (playerWins === undefined) return ok(log.join(' '), 0);
  // fin de l'assaut
  opp.health = clamp(Math.max(e.hp[opp.id] ?? opp.health, 15), 0, 100);
  gainXp(state, p, 'combat', playerWins ? 1.5 : 1);
  state.encounter = undefined;
  t.queue.shift();
  t.next.push(playerWins ? p.id : opp.id);
  const verdict = playerWins ? `Tu remportes l'assaut contre ${fullName(opp)} !` : `${fullName(opp)} remporte l'assaut. Tu es éliminé.`;
  const rest = proceed(state, t);
  return ok(`${log.join(' ')} ${verdict} ${rest.join(' ')}`.trim(), 0);
}

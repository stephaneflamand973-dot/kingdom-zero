// ─────────────────────────────────────────────────────────────
// Familles et générations (phase 5) : anniversaires, cour, mariage, naissances, enfance,
// succession (dettes, partage, biens, tutelle des orphelins) et continuité de la lignée du joueur.
// ─────────────────────────────────────────────────────────────
import { FIRST_NAMES_F, FIRST_NAMES_M, ITEM_IDS } from './data';
import { askPrice, P, trade, transferItem, transferMoney } from './economy';
import { logEvent } from './events';
import { ownedBusinesses } from './finance';
import { eat } from './npc';
import { orgList, orgsOf } from './orgs';
import { chance, pick, rand, randInt } from './rng';
import { compatibility, getRelation, modifyRelation } from './social';
import { initialAmbition } from './society';
import { DAYS_PER_YEAR, toDate } from './time';
import type { AttrId, Character, GameState, ItemId, SkillId, TraitId } from './types';
import { aliveCharacters, businessesIn, clamp, fullName, newId, npcs, qty, residents, settlementIdOf } from './util';

export const ADULT_AGE = 14;
export const PREGNANCY_DAYS = 70;

export const isChild = (c: Character) => c.age < ADULT_AGE;

/** Date de naissance cohérente avec l'âge (le jour dans l'année varie selon l'identifiant). */
export function birthDayFor(id: string, age: number): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return -(age * DAYS_PER_YEAR) - (h % DAYS_PER_YEAR);
}

export function kin(_state: GameState, a: Character, b: Character): boolean {
  if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) return true;
  return a.parentIds.some(p => b.parentIds.includes(p)); // frères et sœurs
}

export function siblings(state: GameState, c: Character): Character[] {
  const ids = new Set<string>();
  for (const pid of c.parentIds) for (const k of state.characters[pid]?.childIds ?? []) if (k !== c.id) ids.add(k);
  return [...ids].map(id => state.characters[id]).filter(Boolean);
}

/** Liens familiaux du monde de départ. */
export function seedFamilies(state: GameState): void {
  const parent = (p: string, k: string) => {
    const a = state.characters[p], b = state.characters[k];
    if (!a || !b) return;
    if (!a.childIds.includes(k)) a.childIds.push(k);
    if (!b.parentIds.includes(p)) b.parentIds.push(p);
  };
  const marry = (a: string, b: string) => {
    if (!state.characters[a] || !state.characters[b]) return;
    state.characters[a].spouseId = b; state.characters[b].spouseId = a;
  };
  parent('gautier', 'martin'); parent('perrine', 'jehan'); parent('guerin', 'gaucher'); parent('alienor', 'berald');
  parent('yolande', 'evrard'); parent('hugo', 'pernelle');
  marry('amaury', 'mahaut'); marry('jacquot', 'tiphaine');
}

// ── Anniversaires et majorité ────────────────────────────────

export function birthdays(state: GameState): void {
  const day = toDate(state.time).day;
  if (state.birthdaysDoneDay === day) return;
  state.birthdaysDoneDay = day;
  for (const c of aliveCharacters(state)) {
    if (day <= c.birthDay || (day - c.birthDay) % DAYS_PER_YEAR !== 0) continue;
    c.age += 1;
    if (c.age === ADULT_AGE) {
      c.guardianId = undefined;
      if (!c.isPlayer) {
        c.goal = { kind: 'trouver_emploi' };
        c.ambition = initialAmbition(state, c);
      }
      logEvent(state, { type: 'coming_of_age', actorId: c.id, importance: 2, locationId: c.locationId,
        text: `${fullName(c)} a ${ADULT_AGE} ans : l'enfance est finie, il faut désormais gagner son pain.`,
        witnesses: [...c.parentIds, c.id] });
    }
  }
}

// ── Cour et mariage ─────────────────────────────────────────

function eligible(state: GameState, c: Character): boolean {
  return c.alive && !c.spouseId && c.age >= 16 && c.age <= 60 && (c.jailedUntil ?? 0) <= state.time;
}

/** Chaque semaine : l'attirance grandit entre adultes libres qui s'apprécient ; à son comble, ils se marient. */
export function weeklyCourtship(state: GameState): void {
  const singles = npcs(state).filter(c => eligible(state, c));
  for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) {
    const a = singles[i], b = singles[j];
    if (a.spouseId || b.spouseId || kin(state, a, b)) continue;
    const ab = getRelation(state, a.id, b.id), ba = getRelation(state, b.id, a.id);
    if (ab.affinity < 40 || ba.affinity < 40 || ab.trust < 15 || ba.trust < 15) continue;
    if (Math.abs(a.age - b.age) > 15) continue;
    const comp = compatibility(a, b);
    const grow = (aff: number) => Math.max(0, (aff - 35) / 4 + comp * 4 + rand(state) * 3);
    const before = a.relations[b.id]?.romance ?? 0;
    a.relations[b.id].romance = Math.min(100, (a.relations[b.id].romance ?? 0) + grow(ab.affinity));
    b.relations[a.id].romance = Math.min(100, (b.relations[a.id].romance ?? 0) + grow(ba.affinity));
    if (before < 50 && (a.relations[b.id].romance ?? 0) >= 50) {
      logEvent(state, { type: 'courtship', actorId: a.id, targetId: b.id, importance: 2, locationId: a.locationId,
        text: `${fullName(a)} fait la cour à ${fullName(b)}.`, witnesses: [a.id, b.id] });
    }
    if ((a.relations[b.id].romance ?? 0) >= 80 && (b.relations[a.id].romance ?? 0) >= 80) wed(state, a, b);
  }
  // Les époux mettent une partie de leurs ressources en commun
  for (const c of npcs(state)) {
    const s = c.spouseId ? state.characters[c.spouseId] : undefined;
    if (!s?.alive || c.money <= s.money + 40) continue;
    transferMoney(state, P.c(c.id), P.c(s.id), Math.floor((c.money - s.money) / 4));
  }
}

/** Mariage : foyer commun, noce payée par le plus aisé, alliance si deux maisons nobles s'unissent. */
export function wed(state: GameState, a: Character, b: Character): void {
  a.spouseId = b.id; b.spouseId = a.id;
  const [rich, poor] = a.money >= b.money ? [a, b] : [b, a];
  // l'époux le moins aisé rejoint le foyer de l'autre (sauf si le joueur a sa propre maison)
  const mover = poor.isPlayer && state.properties.some(pr => pr.ownerId === poor.id || pr.tenantId === poor.id) ? rich : poor;
  const host = mover === rich ? poor : rich;
  mover.homeId = host.homeId;
  const sid = settlementIdOf(state, host.homeId);
  const tavern = businessesIn(state, sid).find(x => x.kind === 'tavern');
  const feast = Math.min(30, rich.money);
  if (tavern && feast > 0) transferMoney(state, P.c(rich.id), P.b(tavern.id), feast);
  modifyRelation(state, a.id, b.id, 15, 15);
  modifyRelation(state, b.id, a.id, 15, 15);
  for (const c of [a, b]) if (!c.isPlayer && c.ambition.kind === 'vie_paisible') c.goal = { kind: 'prosperer' };
  logEvent(state, { type: 'wedding', actorId: a.id, targetId: b.id, importance: 3, locationId: state.settlements[sid].squareId,
    text: `Noces de ${fullName(a)} et ${fullName(b)} à ${state.settlements[sid].name}${feast ? ` ; ${rich.firstName} offre ${feast} d de festin` : ''}.`,
    witnesses: residents(state, sid).map(c => c.id).concat(a.id, b.id) });
  // Alliance matrimoniale entre deux maisons
  const ha = orgsOf(state, a.id, 'house')[0], hb = orgsOf(state, b.id, 'house')[0];
  if (ha && hb && ha.id !== hb.id) {
    const v = Math.min(100, (ha.relations[hb.id] ?? 0) + 35);
    ha.relations[hb.id] = v; hb.relations[ha.id] = v;
    logEvent(state, { type: 'diplomacy', importance: 3, text: `Ce mariage scelle une alliance entre ${ha.name} et ${hb.name}.`, witnesses: aliveCharacters(state).map(c => c.id) });
  }
}

// ── Naissances ──────────────────────────────────────────────

export function dailyFamily(state: GameState): void {
  const day = toDate(state.time).day;
  for (const mother of aliveCharacters(state)) {
    // Accouchement
    if (mother.pregnantUntil !== undefined && mother.pregnantUntil <= day) {
      const father = mother.pregnancyFather ? state.characters[mother.pregnancyFather] : undefined;
      mother.pregnantUntil = undefined; mother.pregnancyFather = undefined;
      const child = createChild(state, mother, father);
      logEvent(state, { type: 'birth', actorId: child.id, targetId: mother.id, importance: 2, locationId: mother.locationId,
        text: `${fullName(mother)}${father ? ` et ${fullName(father)}` : ''} accueillent ${child.sex === 'F' ? 'une fille' : 'un fils'}, ${child.firstName}.`,
        witnesses: residents(state, settlementIdOf(state, mother.homeId)).map(c => c.id).concat(mother.id) });
      if (chance(state, 0.015)) mother.health = 0; // l'accouchement reste un danger (le décès est constaté à l'heure suivante)
      continue;
    }
    // Conception (couple mari et femme, mère en âge, foyer qui mange à sa faim)
    if (mother.sex !== 'F' || !mother.spouseId || mother.pregnantUntil !== undefined) continue;
    const father = state.characters[mother.spouseId];
    if (!father?.alive || father.sex !== 'M' || mother.age < 16 || mother.age > 42) continue;
    if ((mother.jailedUntil ?? 0) > state.time || (father.jailedUntil ?? 0) > state.time) continue;
    if (mother.needs.hunger > 60 || mother.money + father.money < 15) continue;
    const st = state.settlements[settlementIdOf(state, mother.homeId)];
    const crowd = residents(state, st.id).length >= st.popCap * 1.3 ? 0.3 : 1;
    const young = mother.childIds.filter(id => state.characters[id]?.alive && isChild(state.characters[id])).length;
    if (!chance(state, 0.012 * crowd / (1 + young * 0.5))) continue;
    mother.pregnantUntil = day + PREGNANCY_DAYS;
    mother.pregnancyFather = father.id;
    logEvent(state, { type: 'pregnancy', actorId: mother.id, targetId: father.id, importance: 2,
      text: `${fullName(mother)} attend un enfant.`, witnesses: [mother.id, father.id] });
  }
  ensureHeirs(state);
}

const ATTRS: AttrId[] = ['force', 'endurance', 'agilite', 'intelligence', 'charisme', 'perception', 'volonte'];
const SKILLS: SkillId[] = ['agriculture', 'artisanat', 'commerce', 'combat', 'diplomatie', 'discretion', 'gestion', 'commandement'];

export function createChild(state: GameState, mother: Character, father?: Character): Character {
  const sex = chance(state, 0.5) ? 'M' : 'F';
  const id = newId(state, 'c');
  const day = toDate(state.time).day;
  const attributes = {} as Record<AttrId, number>;
  for (const a of ATTRS) attributes[a] = clamp(Math.round(((mother.attributes[a] + (father?.attributes[a] ?? mother.attributes[a])) / 2) + randInt(state, -1, 1)), 1, 10);
  const skills = {} as Record<SkillId, number>;
  for (const k of SKILLS) skills[k] = 0;
  const inherited = [...mother.traits, ...(father?.traits ?? [])];
  const traits: TraitId[] = inherited.length ? [pick(state, inherited)] : [];
  if (chance(state, 0.6)) {
    const t = pick(state, ['travailleur', 'sociable', 'timide', 'honnete', 'genereux', 'colerique', 'paresseux', 'ambitieux'] as const);
    if (!traits.includes(t)) traits.push(t);
  }
  const c: Character = {
    id, firstName: pick(state, sex === 'M' ? FIRST_NAMES_M : FIRST_NAMES_F), lastName: father?.lastName ?? mother.lastName,
    age: 0, sex, isPlayer: false, alive: true, profession: 'sans_emploi', homeId: mother.homeId, locationId: mother.homeId,
    money: 0, inventory: {}, health: 90, sick: 0, needs: { hunger: 10, energy: 100, social: 60 },
    attributes, skills, skillXp: {}, traits, goal: { kind: 'survivre' }, relations: {}, knownEvents: [],
    activity: { kind: 'sleep', locationId: mother.homeId, since: state.time, note: 'Nourrisson' },
    unpaidWages: 0, hoursWorkedToday: 0, lastMealTime: state.time, forageProgress: 0,
    ambition: { kind: 'vie_paisible', since: state.time },
    birthDay: day, parentIds: [mother.id, ...(father ? [father.id] : [])], childIds: [],
  };
  state.characters[id] = c;
  state.characterOrder.push(id);
  mother.childIds.push(id);
  if (father) father.childIds.push(id);
  for (const p of [mother, father]) if (p) { modifyRelation(state, p.id, id, 60, 50); modifyRelation(state, id, p.id, 60, 50); }
  // un enfant de maison noble appartient à la maison
  for (const h of orgList(state, 'house')) {
    if ((h.members.includes(mother.id) || (father && h.members.includes(father.id))) && !h.members.includes(id)) { h.members.push(id); h.roles[id] = 'membre'; }
  }
  return c;
}

/** Une maison sans héritier désigne l'aîné des enfants vivants du seigneur. */
export function ensureHeirs(state: GameState): void {
  for (const h of orgList(state, 'house')) {
    const lord = h.leaderId ? state.characters[h.leaderId] : undefined;
    if (!lord || h.members.some(id => h.roles[id] === 'heritier' && state.characters[id]?.alive)) continue;
    const heir = lord.childIds.map(id => state.characters[id]).filter(c => c?.alive).sort((a, b) => b.age - a.age)[0];
    if (!heir) continue;
    if (!h.members.includes(heir.id)) h.members.push(heir.id);
    h.roles[heir.id] = 'heritier';
    logEvent(state, { type: 'succession', actorId: heir.id, importance: 2, text: `${fullName(heir)} devient l'héritier${heir.sex === 'F' ? 'e' : ''} de ${h.name}.`, witnesses: h.members.slice() });
  }
}

// ── Enfance : ce sont les parents (ou le tuteur) qui nourrissent les enfants ──

export function providersOf(state: GameState, child: Character): Character[] {
  return [...child.parentIds, ...(child.guardianId ? [child.guardianId] : [])]
    .map(id => state.characters[id]).filter(p => p?.alive && (p.jailedUntil ?? 0) <= state.time);
}

/** Deux fois par jour, les enfants affamés reçoivent à manger de leur famille (pain du foyer ou acheté). */
export function feedChildren(state: GameState): void {
  for (const child of aliveCharacters(state)) {
    if (!isChild(child) || child.needs.hunger < 35) continue;
    if (eat(state, child)) continue;
    for (const p of providersOf(state, child)) {
      const food = (['bread', 'grain'] as ItemId[]).find(f => qty(p.inventory, f) > 0);
      if (food && transferItem(state, P.c(p.id), P.c(child.id), food, 1)) { eat(state, child); break; }
      // sinon le parent achète une miche pour l'enfant dans sa localité
      const sid = settlementIdOf(state, child.homeId);
      const baker = businessesIn(state, sid).filter(b => b.sells.includes('bread') && qty(b.stock, 'bread') > 0 && b.kind !== 'manor')
        .sort((x, y) => askPrice(state, x, 'bread') - askPrice(state, y, 'bread'))[0];
      if (!baker) continue;
      const price = askPrice(state, baker, 'bread');
      if (p.money >= price && trade(state, P.c(p.id), P.b(baker.id), 'bread', 1, price) && transferItem(state, P.c(p.id), P.c(child.id), 'bread', 1)) { eat(state, child); break; }
    }
  }
}

// ── Succession ──────────────────────────────────────────────

/** Héritiers par ordre : enfants adultes (aîné d'abord), conjoint, enfants mineurs, parents, frères et sœurs. */
export function heirsOf(state: GameState, c: Character): Character[] {
  const alive = (ids: string[]) => ids.map(id => state.characters[id]).filter(x => x?.alive && x.id !== c.id);
  const kids = alive(c.childIds).sort((a, b) => b.age - a.age);
  const spouse = c.spouseId ? alive([c.spouseId]) : [];
  const out = [...kids.filter(k => !isChild(k)), ...spouse, ...kids.filter(k => isChild(k))];
  if (out.length) return out;
  const parents = alive(c.parentIds);
  if (parents.length) return parents;
  return siblings(state, c).filter(s => s.alive);
}

/**
 * Règle la succession d'un défunt : dettes d'abord, puis partage de l'argent, transmission des biens,
 * des maisons, des entreprises et des créances ; tutelle des orphelins. Renvoie vrai si un héritier existe.
 */
export function settleEstate(state: GameState, c: Character): boolean {
  // 1. Les créanciers sont payés sur la succession
  for (const l of state.loans) {
    if (l.status !== 'active' || l.borrowerId !== c.id) continue;
    const pay = Math.min(l.remaining, c.money);
    if (pay > 0) transferMoney(state, P.c(c.id), P.c(l.lenderId), pay);
    l.remaining -= pay;
    l.status = l.remaining > 0 ? 'defaulted' : 'repaid';
  }
  // 2. Veuvage
  const spouse = c.spouseId ? state.characters[c.spouseId] : undefined;
  if (spouse) {
    spouse.spouseId = undefined;
    logEvent(state, { type: 'widowhood', actorId: spouse.id, targetId: c.id, importance: 2, text: `${fullName(spouse)} est désormais veu${spouse.sex === 'F' ? 've' : 'f'}.`, witnesses: [spouse.id] });
  }
  // 3. Tutelle des enfants mineurs devenus orphelins
  for (const k of c.childIds.map(id => state.characters[id]).filter(x => x?.alive && isChild(x))) {
    if (providersOf(state, k).some(p => p.id !== c.id)) continue;
    const sid = settlementIdOf(state, k.homeId);
    const steward = state.settlements[sid].stewardId ? state.characters[state.settlements[sid].stewardId!] : undefined;
    const guardian = siblings(state, k).filter(s => s.alive && !isChild(s)).sort((a, b) => b.age - a.age)[0]
      ?? residents(state, sid).filter(x => x.spouseId && x.money >= 60 && !isChild(x)).sort((a, b) => b.money - a.money)[0]
      ?? residents(state, sid).filter(x => !isChild(x) && x.money >= 40 && (x.relations[c.id]?.affinity ?? 0) >= 0).sort((a, b) => b.money - a.money)[0]
      ?? (steward?.alive ? steward : undefined); // pupille de l'intendance
    if (guardian) {
      k.guardianId = guardian.id;
      k.homeId = guardian.homeId;
      logEvent(state, { type: 'adoption', actorId: guardian.id, targetId: k.id, importance: 2, text: `${fullName(guardian)} recueille ${fullName(k)}, orphelin${k.sex === 'F' ? 'e' : ''}.`, witnesses: [guardian.id, k.id] });
    }
  }
  const heirs = heirsOf(state, c);
  if (!heirs.length) return false;
  const main = heirs[0];
  // 4. Partage de l'argent (le reste à l'héritier principal)
  const share = Math.floor(c.money / heirs.length);
  for (const h of heirs) if (share > 0) transferMoney(state, P.c(c.id), P.c(h.id), share);
  if (c.money > 0) transferMoney(state, P.c(c.id), P.c(main.id), c.money);
  // 5. Biens portés, logements, créances, entreprises : à l'héritier principal
  for (const it of ITEM_IDS) if (qty(c.inventory, it) > 0) transferItem(state, P.c(c.id), P.c(main.id), it, qty(c.inventory, it));
  for (const pr of state.properties) {
    if (pr.ownerId === c.id) pr.ownerId = main.id;
    if (pr.tenantId === c.id) { pr.tenantId = undefined; pr.rentDueDay = undefined; }
  }
  for (const l of state.loans) if (l.status === 'active' && l.lenderId === c.id) l.lenderId = main.id;
  for (const b of ownedBusinesses(state, c)) {
    b.employees = b.employees.filter(id => id !== main.id);
    if (main.employerId === b.id) main.employerId = undefined;
    b.ownerId = main.id;
  }
  logEvent(state, { type: 'estate', actorId: main.id, targetId: c.id, importance: 2,
    text: `Succession de ${fullName(c)} : ${heirs.map(h => fullName(h)).join(', ')} hérite${heirs.length > 1 ? 'nt' : ''}${share ? ` (${share} d chacun)` : ''} ; ${fullName(main)} reprend ses biens.`,
    witnesses: heirs.map(h => h.id) });
  return true;
}

// ── Lignée du joueur ────────────────────────────────────────

/** Qui peut reprendre le flambeau : descendants et proches adultes, puis amis fidèles. */
export function successionCandidates(state: GameState, dead: Character): string[] {
  const adult = (x?: Character) => !!x && x.alive && !x.isPlayer && x.age >= ADULT_AGE;
  const family = [...heirsOf(state, dead), ...siblings(state, dead)].filter(adult);
  const friends = npcs(state).filter(x => adult(x) && x.age >= 16 && (x.relations[dead.id]?.affinity ?? 0) >= 30)
    .sort((a, b) => (b.relations[dead.id]?.affinity ?? 0) - (a.relations[dead.id]?.affinity ?? 0)).slice(0, 3);
  return [...new Set([...family, ...friends].map(x => x.id))];
}

/** Le joueur incarne désormais ce personnage ; le monde continue sans réinitialisation. */
export function continueAs(state: GameState, id: string): { ok: boolean; message: string; minutes: number } {
  const pending = state.pendingSuccession;
  if (!pending || !pending.candidates.includes(id)) return { ok: false, message: 'Ce personnage ne peut pas reprendre ta lignée.', minutes: 0 };
  const prev = state.characters[pending.deceasedId];
  const next = state.characters[id];
  prev.isPlayer = false;
  next.isPlayer = true;
  state.playerId = id;
  next.activity = { kind: 'idle', locationId: next.locationId, since: state.time, note: 'Reprend le flambeau' };
  const descendant = prev.childIds.includes(id);
  const last = state.dynasty.heads[state.dynasty.heads.length - 1];
  if (last) last.to = state.time;
  if (descendant) state.dynasty.generation += 1;
  state.dynasty.heads.push({ id, from: state.time });
  state.pendingSuccession = undefined;
  state.gameOver = undefined;
  state.encounter = undefined;
  // les prix connus et les relations restent ceux du nouveau personnage ; il connaît la mort de son prédécesseur
  logEvent(state, { type: 'succession', actorId: id, targetId: prev.id, importance: 3,
    text: `${fullName(next)} reprend le flambeau de ${fullName(prev)}${descendant ? ` : la ${state.dynasty.generation}e génération commence` : ''}.`, witnesses: [id] });
  return { ok: true, message: `Tu es désormais ${fullName(next)}, ${next.age} ans. ${descendant ? `La lignée continue : génération ${state.dynasty.generation}.` : 'La vie continue.'}`, minutes: 0 };
}


// ── Domesticité ─────────────────────────────────────────────

export const SERVANT_PAY = 12;

/**
 * Chaque jour : un habitant aisé prend à son service un chômeur de sa localité et le paie.
 * Quand le maître s'appauvrit (ou trouve son domestique employé ailleurs), le service prend fin.
 */
export function dailyServants(state: GameState): void {
  for (const s of npcs(state)) {
    if (!s.masterId) continue;
    const m = state.characters[s.masterId];
    if (!m?.alive || m.money < 150 || s.employerId || (s.jailedUntil ?? 0) > state.time) {
      s.masterId = undefined;
      continue;
    }
    transferMoney(state, P.c(m.id), P.c(s.id), SERVANT_PAY);
  }
  for (const m of npcs(state)) {
    if (m.money <= 300 || isChild(m) || npcs(state).some(x => x.masterId === m.id)) continue;
    const sid = settlementIdOf(state, m.homeId);
    const s = residents(state, sid)
      .filter(x => x.id !== m.id && !x.employerId && !x.masterId && !isChild(x) && x.age < 65 && x.profession !== 'seigneur' && (x.jailedUntil ?? 0) <= state.time)
      .filter(x => getRelation(state, m.id, x.id).trust > -20)
      .sort((a, b) => a.money - b.money || (a.id < b.id ? -1 : 1))[0];
    if (!s) continue;
    s.masterId = m.id;
    transferMoney(state, P.c(m.id), P.c(s.id), SERVANT_PAY);
    modifyRelation(state, s.id, m.id, 6, 4);
    logEvent(state, { type: 'hire', actorId: m.id, targetId: s.id, importance: 2, locationId: m.homeId,
      text: `${fullName(m)} prend ${fullName(s)} à son service comme domestique (${SERVANT_PAY} d par jour).`, witnesses: [m.id, s.id] });
  }
}

// ─────────────────────────────────────────────────────────────
// Actions du joueur. Chaque action : 1) est validée par les règles,
// 2) modifie l'état, 3) consomme du temps simulé (le monde avance).
// Une action refusée ne consomme pas de temps et ne modifie rien.
// ─────────────────────────────────────────────────────────────
import { ITEMS, MIN_SKILL_FOR_DAYWORK, RECIPES, WORK_SKILL, SKILL_NAMES } from './data';
import { attemptTheft } from './crime';
import { outputCap, P, priceForCharacter, trade, tradeRefusal, transferItem, transferMoney } from './economy';
import { learnEvent, logEvent } from './events';
import { fem, greeting, refusalText } from './narrative';
import { eat as eatFood } from './npc';
import { chance, rand, randInt } from './rng';
import { advanceTime } from './sim';
import { gainXp } from './skills';
import { applyBeliefEffect, getRelation, modifyRelation, shareRumor } from './social';
import { formatDuration, minutesUntilHour, toDate } from './time';
import type { ActionResult, Business, Character, GameState, ItemId } from './types';
import { charactersAt, clamp, fullName, hasTrait, isOpen, player, qty, travelMinutes } from './util';

const ok = (message: string, minutes: number, eventIds?: string[]): ActionResult => ({ ok: true, message, minutes, eventIds });
const no = (message: string): ActionResult => ({ ok: false, message, minutes: 0 });

function finish(state: GameState, p: Character, minutes: number): void {
  advanceTime(state, minutes);
  if (p.alive) p.activity = { kind: 'idle', locationId: p.locationId, since: state.time, note: 'Libre' };
}

function guard(state: GameState): ActionResult | null {
  if (state.gameOver) return no('La partie est terminée.');
  return null;
}

// ── Déplacement ─────────────────────────────────────────────

export function moveTo(state: GameState, locationId: string): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  if (!state.locations[locationId]) return no('Lieu inconnu.');
  if (p.locationId === locationId) return no('Tu y es déjà.');
  const minutes = travelMinutes(state, p.locationId, locationId);
  p.activity = { kind: 'travel', locationId: p.locationId, since: state.time, note: `En route vers ${state.locations[locationId].name}` };
  p.locationId = locationId;
  finish(state, p, minutes);
  return ok(`Tu te rends à ${state.locations[locationId].name} (${formatDuration(minutes)}).`, minutes);
}

// ── Travail ─────────────────────────────────────────────────

export function dayWageOffer(state: GameState, b: Business, p: Character): number {
  const skill = p.skills[WORK_SKILL[b.kind]];
  const rel = b.ownerId ? getRelation(state, b.ownerId, p.id) : { affinity: 0 };
  return Math.max(2, Math.round(b.wage * (0.55 + skill / 90) + rel.affinity / 40));
}

export interface WorkCheck { ok: boolean; reason?: string; wage: number; maxHours: number }

export function canWork(state: GameState, b: Business, p: Character): WorkCheck {
  const d = toDate(state.time);
  const wage = dayWageOffer(state, b, p);
  const hoursLeftOpen = b.openTo - d.hour - (d.minute > 0 ? 1 : 0);
  const maxHours = Math.max(0, Math.min(10 - p.hoursWorkedToday, hoursLeftOpen));
  const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
  if (p.locationId !== b.locationId) return { ok: false, reason: "Tu n'es pas sur place.", wage, maxHours };
  if (!isOpen(b, d.hour)) return { ok: false, reason: `${b.name} est fermé (ouvert de ${b.openFrom}h à ${b.openTo}h).`, wage, maxHours };
  if (maxHours <= 0) return { ok: false, reason: p.hoursWorkedToday >= 10 ? "Tu as assez travaillé aujourd'hui." : 'La journée de travail touche à sa fin.', wage, maxHours };
  if (p.needs.energy < 15) return { ok: false, reason: 'Tu es trop épuisé pour travailler.', wage, maxHours };
  if (b.kind === 'market') return { ok: false, reason: `${owner ? fullName(owner) : 'Le marchand'} ne prend pas de commis.`, wage, maxHours };
  const skill = WORK_SKILL[b.kind];
  if (p.skills[skill] < MIN_SKILL_FOR_DAYWORK[b.kind]) {
    return { ok: false, reason: `${owner ? owner.firstName : "L'intendant"} te juge trop inexpérimenté (${SKILL_NAMES[skill]} ${p.skills[skill]}/${MIN_SKILL_FOR_DAYWORK[b.kind]}).`, wage, maxHours };
  }
  if (owner) {
    const r = getRelation(state, owner.id, p.id);
    if (r.trust <= -25 || r.affinity <= -35) return { ok: false, reason: refusalText(state, owner, "t'embaucher"), wage, maxHours };
  }
  if (b.kind === 'manor') {
    const odon = state.characters['odon'];
    if (odon?.alive && getRelation(state, odon.id, p.id).trust <= -25) return { ok: false, reason: refusalText(state, odon, "t'embaucher pour l'intendance"), wage, maxHours };
  }
  const r = RECIPES[b.kind];
  if (r) {
    const full = (Object.keys(r.outputs) as ItemId[]).every(it => qty(b.stock, it) >= outputCap(b, it));
    if (full) return { ok: false, reason: `${b.name} croule sous les stocks : pas de travail aujourd'hui.`, wage, maxHours };
  }
  if (b.treasury < wage * Math.min(maxHours, 4)) return { ok: false, reason: `${b.name} n'a pas de quoi te payer.`, wage, maxHours };
  return { ok: true, wage, maxHours };
}

export function work(state: GameState, businessId: string, hours: number): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const b = state.businesses[businessId];
  if (!b) return no('Établissement inconnu.');
  const chk = canWork(state, b, p);
  if (!chk.ok) return no(chk.reason!);
  const h = Math.max(1, Math.min(Math.floor(hours), chk.maxHours));
  const before = p.money, unpaidBefore = p.unpaidWages;
  const skill = WORK_SKILL[b.kind];
  const skillBefore = p.skills[skill];
  const workLoc = b.kind === 'manor' ? 'square' : b.locationId;
  const prevLoc = p.locationId;
  p.locationId = workLoc;
  p.activity = { kind: 'work', locationId: workLoc, targetId: b.id, since: state.time, wage: chk.wage, note: `Travaille à ${b.name}` };
  // Le temps avance : chaque heure franchie produit du travail réel et un salaire versé par la caisse.
  // h heures = exactement h frontières d'heure franchies = h heures de travail simulées.
  const minutes = h * 60;
  advanceTime(state, minutes);
  p.locationId = prevLoc;
  if (p.alive) p.activity = { kind: 'idle', locationId: p.locationId, since: state.time, note: 'Libre' };
  const earned = p.money - before;
  const unpaid = p.unpaidWages - unpaidBefore;
  if (b.ownerId) modifyRelation(state, b.ownerId, p.id, 2, 3);
  const ev = logEvent(state, {
    type: 'work', actorId: p.id, businessId: b.id, locationId: b.locationId, importance: 1,
    text: `Tu travailles ${h} h à ${b.name} et gagnes ${earned} d.${unpaid ? ` ${unpaid} d restent impayés.` : ''}`,
    data: { hours: h, earned },
  });
  const gained = p.skills[skill] - skillBefore;
  return ok(`Tu travailles ${h} h à ${b.name}. Salaire perçu : ${earned} d${unpaid ? ` (${unpaid} d impayés)` : ''}.${gained ? ` ${SKILL_NAMES[skill]} +${gained}.` : ''}`, minutes, [ev.id]);
}

// ── Commerce ────────────────────────────────────────────────

export function buy(state: GameState, businessId: string, item: ItemId, n: number): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const b = state.businesses[businessId];
  if (!b || p.locationId !== b.locationId) return no("Tu n'es pas sur place.");
  if (!b.sells.includes(item)) return no(`${b.name} ne vend pas cela.`);
  if (!isOpen(b, toDate(state.time).hour)) return no(`${b.name} est fermé.`);
  if (tradeRefusal(state, b, p)) return no(refusalText(state, state.characters[b.ownerId!], 'te vendre quoi que ce soit'));
  if (qty(b.stock, item) < n) return no(`Il ne reste que ${qty(b.stock, item)} ${ITEMS[item].plural}.`);
  const price = priceForCharacter(state, b, p, item, 'buy');
  if (p.money < price * n) return no(`Il te faut ${price * n} d, tu n'as que ${p.money} d.`);
  trade(state, P.c(p.id), P.b(b.id), item, n, price);
  gainXp(state, p, 'commerce', 0.5);
  if (b.ownerId) modifyRelation(state, b.ownerId, p.id, 1, 1);
  const ev = logEvent(state, { type: 'trade', actorId: p.id, businessId: b.id, importance: 1,
    text: `Tu achètes ${n} ${n > 1 ? ITEMS[item].plural : ITEMS[item].name} à ${b.name} pour ${price * n} d.` });
  finish(state, p, 5);
  return ok(ev.text, 5, [ev.id]);
}

export function sellOffer(state: GameState, b: Business, p: Character, item: ItemId): number {
  return priceForCharacter(state, b, p, item, 'sell');
}

export function sell(state: GameState, businessId: string, item: ItemId, n: number): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const b = state.businesses[businessId];
  if (!b || p.locationId !== b.locationId) return no("Tu n'es pas sur place.");
  if (!b.buys.includes(item)) return no(`${b.name} n'achète pas de ${ITEMS[item].plural}.`);
  if (!isOpen(b, toDate(state.time).hour)) return no(`${b.name} est fermé.`);
  if (tradeRefusal(state, b, p)) return no(refusalText(state, state.characters[b.ownerId!], 'faire affaire avec toi'));
  if (qty(p.inventory, item) < n) return no("Tu n'as pas cette quantité.");
  if (qty(b.stock, item) + n > outputCap(b, item)) return no(`${b.name} a déjà assez de ${ITEMS[item].plural}.`);
  const price = sellOffer(state, b, p, item);
  if (b.treasury < price * n) return no(`${b.name} n'a pas assez d'argent en caisse.`);
  trade(state, P.b(b.id), P.c(p.id), item, n, price);
  gainXp(state, p, 'commerce', 0.5);
  const ev = logEvent(state, { type: 'trade', actorId: p.id, businessId: b.id, importance: 1,
    text: `Tu vends ${n} ${n > 1 ? ITEMS[item].plural : ITEMS[item].name} à ${b.name} pour ${price * n} d.` });
  finish(state, p, 5);
  return ok(ev.text, 5, [ev.id]);
}

// ── Soins de soi ────────────────────────────────────────────

export function eat(state: GameState): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const food = qty(p.inventory, 'bread') > 0 ? 'bread' : qty(p.inventory, 'grain') > 0 ? 'grain' : null;
  if (!food) return no("Tu n'as rien à manger.");
  if (p.needs.hunger < 5) return no("Tu n'as pas faim.");
  eatFood(state, p);
  finish(state, p, 15);
  return ok(`${food === 'bread' ? 'Tu manges une miche de pain' : 'Tu te prépares une bouillie de grain'}. Faim : ${Math.round(p.needs.hunger)}.`, 15);
}

export function drinkAle(state: GameState): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  if (qty(p.inventory, 'ale') < 1) return no("Tu n'as pas de bière.");
  if (p.inventory.ale) { p.inventory.ale -= 1; if (!p.inventory.ale) delete p.inventory.ale; }
  state.ledger.consumed.ale = (state.ledger.consumed.ale ?? 0) + 1;
  p.needs.social = clamp(p.needs.social + 10, 0, 100);
  p.needs.hunger = clamp(p.needs.hunger - 4, 0, 100);
  finish(state, p, 20);
  return ok('Tu bois une chope de bière.', 20);
}

export type SleepMode = 'inn' | 'barn' | 'rough';
export const INN_BED_PRICE = 12;

export function sleepOptions(state: GameState): { mode: SleepMode; label: string; ok: boolean; reason?: string }[] {
  const p = player(state);
  const loc = state.locations[p.locationId];
  const out: { mode: SleepMode; label: string; ok: boolean; reason?: string }[] = [];
  if (loc.kind === 'tavern') {
    const inn = state.businesses['b_tavern'];
    const refuse = tradeRefusal(state, inn, p);
    out.push({ mode: 'inn', label: `Louer un lit (${INN_BED_PRICE} d)`, ok: !refuse && p.money >= INN_BED_PRICE,
      reason: refuse ? refusalText(state, state.characters[inn.ownerId!], 'te louer un lit') : p.money < INN_BED_PRICE ? 'Pas assez d’argent.' : undefined });
  }
  if (loc.kind === 'farm') {
    const farm = state.businesses['b_farm'];
    const r = farm.ownerId ? getRelation(state, farm.ownerId, p.id) : { affinity: 0, trust: 0 };
    out.push({ mode: 'barn', label: 'Dormir dans la grange', ok: r.affinity > -10 && r.trust > -15,
      reason: r.affinity <= -10 || r.trust <= -15 ? `${farm.ownerId ? state.characters[farm.ownerId].firstName : 'Le fermier'} ne veut pas de toi dans sa grange.` : undefined });
  }
  out.push({ mode: 'rough', label: 'Dormir à la belle étoile', ok: true });
  return out;
}

export function sleep(state: GameState, mode: SleepMode): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const opt = sleepOptions(state).find(o => o.mode === mode);
  if (!opt) return no('Impossible de dormir ainsi ici.');
  if (!opt.ok) return no(opt.reason ?? 'Impossible.');
  if (p.needs.energy >= 95) return no("Tu n'as pas sommeil.");
  const d = toDate(state.time);
  const minutes = d.hour >= 18 || d.hour < 5 ? minutesUntilHour(state.time, 6) : 4 * 60;
  const quality = mode === 'inn' ? 1 : mode === 'barn' ? 0.75 : 0.5;
  let paid = '';
  if (mode === 'inn') {
    transferMoney(state, P.c(p.id), P.b('b_tavern'), INN_BED_PRICE);
    paid = ` (${INN_BED_PRICE} d)`;
  }
  p.activity = { kind: 'sleep', locationId: p.locationId, since: state.time, quality, note: 'Dort' };
  const e0 = p.needs.energy;
  finish(state, p, minutes);
  const where = mode === 'inn' ? 'dans un lit de l’auberge' : mode === 'barn' ? 'dans la paille de la grange' : 'à même le sol';
  return ok(`Tu dors ${formatDuration(minutes)} ${where}${paid}. Énergie ${Math.round(e0)} → ${Math.round(p.needs.energy)}.`, minutes);
}

export function wait(state: GameState, minutes: number): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  p.activity = { kind: 'idle', locationId: p.locationId, since: state.time, note: 'Attend' };
  finish(state, p, minutes);
  return ok(`Tu laisses passer ${formatDuration(minutes)}.`, minutes);
}

export function train(state: GameState): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  if (state.locations[p.locationId].kind !== 'square') return no("On s'entraîne aux armes sur la Place du Puits.");
  if (p.needs.energy < 20) return no('Tu es trop fatigué pour t’entraîner.');
  const before = p.skills.combat;
  p.activity = { kind: 'train', locationId: p.locationId, since: state.time, note: 'S’entraîne au bâton' };
  gainXp(state, p, 'combat', 1.6);
  finish(state, p, 60);
  return ok(`Tu t'entraînes une heure au bâton.${p.skills.combat > before ? ` Combat ${p.skills.combat}.` : ''}`, 60);
}

/** Ramasser du bois mort en lisière : maigre revenu mais accessible à tous. */
export function forage(state: GameState, hours: number): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  if (state.locations[p.locationId].kind !== 'woodlot') return no('Le bois mort se ramasse au Bois de la Combe.');
  const d = toDate(state.time);
  if (d.hour < 6 || d.hour >= 20) return no('Il fait trop sombre pour ramasser du bois.');
  if (p.needs.energy < 15) return no('Tu es trop épuisé.');
  const h = Math.max(1, Math.min(Math.floor(hours), 20 - d.hour));
  const before = qty(p.inventory, 'wood');
  p.activity = { kind: 'forage', locationId: p.locationId, since: state.time, note: 'Ramasse du bois mort' };
  finish(state, p, h * 60);
  const got = qty(p.inventory, 'wood') - before;
  return ok(`Tu ramasses du bois mort pendant ${h} h : ${got} fagot${got > 1 ? 's' : ''}.${got === 0 ? ' Le bois sec se fait rare sous tes doigts inexpérimentés.' : ''}`, h * 60);
}

// ── Interactions sociales ───────────────────────────────────

export type TalkKind = 'chat' | 'news' | 'compliment' | 'insult' | 'gift_bread' | 'gift_coins' | 'ask_help';

export function canTalk(state: GameState, npcId: string): string | null {
  const p = player(state);
  const n = state.characters[npcId];
  if (!n || !n.alive) return "Cette personne n'est plus de ce monde.";
  if (n.locationId !== p.locationId) return "Cette personne n'est pas ici.";
  if (n.activity.kind === 'sleep') return `${n.firstName} dort.`;
  return null;
}

export function talk(state: GameState, npcId: string, kind: TalkKind): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const err = canTalk(state, npcId);
  if (err) return no(err);
  const n = state.characters[npcId];
  const rel = getRelation(state, n.id, p.id);
  const recent = rel.lastInteraction >= 0 && state.time - rel.lastInteraction < 6 * 60;
  const busy = n.activity.kind === 'work';
  const witnesses = charactersAt(state, p.locationId).map(c => c.id);
  let msg = '';
  let minutes = 10;
  const events: string[] = [];

  switch (kind) {
    case 'chat': {
      minutes = 20;
      let delta = (p.attributes.charisme - 5) * 0.8 + p.skills.diplomatie / 20 + (rand(state) * 5 - 1.5);
      if (hasTrait(n, 'sociable')) delta += 2;
      if (hasTrait(n, 'timide')) delta -= 1;
      if (hasTrait(n, 'colerique') && chance(state, 0.2)) delta -= 4;
      if (busy) delta -= 1.5;
      if (recent) delta *= 0.4;
      const d = Math.round(delta);
      modifyRelation(state, n.id, p.id, d, d > 0 ? 1 : 0);
      p.needs.social = clamp(p.needs.social + 12, 0, 100);
      gainXp(state, p, 'diplomatie', 1);
      msg = `${greeting(state, n)} ` + (busy ? `${n.firstName} te répond entre deux tâches. ` : '') +
        (d >= 3 ? 'La conversation est chaleureuse.' : d > 0 ? 'Vous échangez quelques mots agréables.' : d === 0 ? 'La conversation reste polie, sans plus.' : 'L’échange tourne court.') +
        ` (affinité ${d >= 0 ? '+' : ''}${d})`;
      break;
    }
    case 'news': {
      minutes = 15;
      const shared = shareRumor(state, n, p);
      if (rel.affinity < -20) msg = fem(n, `${n.firstName} n'a aucune envie de te parler.`);
      else if (shared) { msg = `${n.firstName} te raconte : « ${shared.text} »`; events.push(shared.id); }
      else msg = `${n.firstName} n'a rien de nouveau à t'apprendre.`;
      break;
    }
    case 'compliment': {
      minutes = 5;
      if (recent && chance(state, 0.5)) {
        modifyRelation(state, n.id, p.id, -1, -3);
        msg = `${n.firstName} trouve tes flatteries un peu trop insistantes. (confiance -3)`;
      } else {
        const d = randInt(state, 2, 5) + Math.round(p.attributes.charisme / 4);
        modifyRelation(state, n.id, p.id, d, 0);
        msg = `${n.firstName} accueille ton compliment avec plaisir. (affinité +${d})`;
      }
      break;
    }
    case 'insult': {
      minutes = 5;
      modifyRelation(state, n.id, p.id, -18, -8);
      const ev = logEvent(state, { type: 'insult', actorId: p.id, targetId: n.id, locationId: p.locationId, importance: 2,
        text: `${fullName(p)} insulte publiquement ${fullName(n)} à ${state.locations[p.locationId].name}.`, witnesses });
      for (const w of witnesses) if (w !== n.id) applyBeliefEffect(state, w, ev);
      events.push(ev.id);
      msg = `Tu insultes ${n.firstName}. (affinité -18, confiance -8)`;
      if (hasTrait(n, 'colerique') && getRelation(state, n.id, p.id).affinity < -25) {
        const dmg = randInt(state, 4, 9) + Math.max(0, n.attributes.force - p.attributes.force) - Math.floor(p.skills.combat / 20);
        const hurt = Math.max(1, dmg);
        p.health = clamp(p.health - hurt, 0, 100);
        const ev2 = logEvent(state, { type: 'argument', actorId: n.id, targetId: p.id, locationId: p.locationId, importance: 2, causeIds: [ev.id],
          text: `${fullName(n)}, furieux, frappe ${fullName(p)} au visage.`, witnesses });
        events.push(ev2.id);
        msg += ` Fou de rage, ${n.firstName} te frappe ! (santé -${hurt})`;
      }
      break;
    }
    case 'gift_bread': {
      minutes = 5;
      if (!transferItem(state, P.c(p.id), P.c(n.id), 'bread', 1)) return no("Tu n'as pas de pain à offrir.");
      const hungry = n.needs.hunger > 50;
      const d = hungry ? 14 : 6;
      modifyRelation(state, n.id, p.id, d, hungry ? 8 : 3);
      const ev = logEvent(state, { type: 'gift', actorId: p.id, targetId: n.id, locationId: p.locationId, importance: 2,
        text: `${fullName(p)} offre une miche de pain à ${fullName(n)}${hungry ? ', qui avait faim' : ''}.`, witnesses });
      events.push(ev.id);
      if (hungry) eatFood(state, n);
      msg = `${n.firstName} accepte ton pain${hungry ? ' et le dévore aussitôt' : ''}. (affinité +${d})`;
      break;
    }
    case 'gift_coins': {
      minutes = 5;
      const amount = 10;
      if (!transferMoney(state, P.c(p.id), P.c(n.id), amount)) return no(`Il te faut ${amount} d.`);
      const poor = n.money < 30;
      const d = poor ? 12 : 4;
      modifyRelation(state, n.id, p.id, d, poor ? 6 : 2);
      const ev = logEvent(state, { type: 'gift', actorId: p.id, targetId: n.id, locationId: p.locationId, importance: 2,
        text: `${fullName(p)} donne ${amount} deniers à ${fullName(n)}.`, witnesses });
      events.push(ev.id);
      msg = `${n.firstName} ${poor ? 'te remercie avec émotion' : 'empoche les pièces'}. (affinité +${d})`;
      break;
    }
    case 'ask_help': {
      minutes = 10;
      const generous = hasTrait(n, 'genereux') ? 20 : hasTrait(n, 'avare') ? -30 : 0;
      const score = rel.affinity + rel.trust / 2 + generous + (p.needs.hunger > 60 ? 10 : 0);
      if (score >= 25 && qty(n.inventory, 'bread') >= 2) {
        transferItem(state, P.c(n.id), P.c(p.id), 'bread', 1);
        modifyRelation(state, n.id, p.id, -2, 0);
        const ev = logEvent(state, { type: 'help', actorId: n.id, targetId: p.id, locationId: p.locationId, importance: 2,
          text: `${fullName(n)} donne une miche de pain à ${fullName(p)}.`, witnesses });
        events.push(ev.id);
        modifyRelation(state, p.id, n.id, 10, 8);
        msg = `${n.firstName} te tend une miche de pain. (affinité -2 : un service rendu se paie)`;
      } else if (score >= 25) {
        msg = `${n.firstName} voudrait t'aider, mais n'a pas de pain à partager.`;
      } else {
        modifyRelation(state, n.id, p.id, -3, -1);
        msg = fem(n, `${n.firstName} refuse : il ne te connaît pas assez pour te faire la charité. (affinité -3)`);
      }
      break;
    }
  }
  p.activity = { kind: 'talk', locationId: p.locationId, targetId: n.id, since: state.time, note: `Parle avec ${n.firstName}` };
  finish(state, p, minutes);
  return ok(msg, minutes, events);
}

// ── Crime ───────────────────────────────────────────────────

export function steal(state: GameState, businessId: string, item: ItemId): ActionResult {
  const g = guard(state); if (g) return g;
  const p = player(state);
  const b = state.businesses[businessId];
  if (!b) return no('Établissement inconnu.');
  const out = attemptTheft(state, p, b, item, 1);
  if ('error' in out) return no(out.error);
  finish(state, p, 10);
  if (out.success) {
    learnEvent(state, p.id, out.event.id);
    return ok(`Personne ne t'a vu : tu dérobes ${ITEMS[item].one} à ${b.name}.`, 10, [out.event.id]);
  }
  const who = out.detectedBy.map(id => state.characters[id].firstName).join(', ');
  return ok(`Pris sur le fait ! ${who} t'a vu.${out.fine ? ` Le garde t'inflige ${out.fine} d d'amende.` : ' On te chasse sans ménagement (santé -6).'}`, 10, [out.event.id]);
}

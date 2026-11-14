// ─────────────────────────────────────────────────────────────
// Phase 7 — Requêtes nées de la simulation, rangs sociaux et chronique.
// Une requête n'est jamais inventée : elle découle de la situation réelle
// d'un PNJ (pénurie de son atelier, brouille, rancune, besoin de nouvelles,
// enfant affamé). L'objectif se vérifie dans l'état du monde, la récompense
// est payée par le donneur sur ses propres deniers, et une parole non tenue
// abîme la confiance.
// ─────────────────────────────────────────────────────────────
import { ITEMS } from './data';
import { P, transferItem, transferMoney } from './economy';
import { logEvent } from './events';
import { kin } from './family';
import { ownedBusinesses } from './finance';
import { finish, guard, talk } from './player';
import { getRelation, modifyRelation, reputation } from './social';
import { toDate } from './time';
import type { ActionResult, Character, GameState, ItemId, Quest, QuestKind } from './types';
import { fullName, npcs, qty, settlementIdOf } from './util';
import { activeContract } from './contracts';

const ok = (message: string, minutes: number): ActionResult => ({ ok: true, message, minutes });
const no = (message: string): ActionResult => ({ ok: false, message, minutes: 0 });

export const QUEST_NAMES: Record<QuestKind, string> = {
  livraison: 'Livraison', reconciliation: 'Réconciliation', humiliation: 'Vengeance', nouvelles: 'Nouvelles', secours: 'Secours',
};
const MAX_OFFERS = 4;

const today = (state: GameState) => toDate(state.time).day;
export function quests(state: GameState): Quest[] { return state.quests ?? []; }
export function openOffers(state: GameState): Quest[] { return quests(state).filter(q => q.status === 'offerte' && q.deadlineDay >= today(state)); }
export function acceptedQuests(state: GameState): Quest[] { return quests(state).filter(q => q.status === 'acceptee'); }
export function offerFrom(state: GameState, giverId: string): Quest | undefined { return openOffers(state).find(q => q.giverId === giverId); }

// ── Rangs sociaux ────────────────────────────────────────────

export interface Rank { level: number; name: string; next?: { name: string; needs: string[] } }

/** Rang social du joueur, calculé sur l'état réel (aucun compteur artificiel). */
export function socialRank(state: GameState, c: Character = state.characters[state.playerId]): Rank {
  const owns = ownedBusinesses(state, c).length;
  const home = state.properties.some(p => p.ownerId === c.id);
  const rep = reputation(state, c.id).score;
  const contract = !!activeContract(state, c.id) || (!!c.employerId && !c.isPlayer);
  const names = ['Vagabond', 'Journalier', 'Compagnon', 'Maître de métier', 'Notable', 'Écuyer', 'Conseiller'];
  let level = 0;
  if (c.money >= 20 || c.employerId || owns) level = 1;
  if (contract || owns) level = 2;
  if (owns) level = 3;
  if (owns && (home || c.money >= 600) && rep >= 15) level = 4;
  if (c.title === 'ecuyer') level = Math.max(level, 5);
  if (c.title === 'conseiller') level = 6;
  const needs: Record<number, string[]> = {
    0: ['gagner 20 d ou travailler à la journée'],
    1: ['signer un contrat chez un patron (gagner d’abord sa confiance)', 'ou racheter / fonder une affaire'],
    2: ['posséder sa propre affaire (rachat ou fondation)'],
    3: [`une réputation d’au moins 15 (actuellement ${rep})`, 'posséder sa maison ou 600 d d’épargne'],
    4: ['être fait écuyer par un seigneur (combat 25 et son estime, ou 200 d)'],
    5: ['obtenir une charge de conseiller (affinité 35, confiance 30 avec le seigneur)'],
  };
  return { level, name: names[level], next: level < 6 ? { name: names[level + 1], needs: needs[level] } : undefined };
}

// ── Chronique de la lignée ───────────────────────────────────

export function chronicle(state: GameState, text: string): void {
  state.chronicle ??= [];
  state.chronicle.push({ time: state.time, generation: state.dynasty?.generation ?? 1, text });
  if (state.chronicle.length > 400) state.chronicle.shift();
}

const CHRONICLED = new Set(['wedding', 'birth', 'title', 'founding', 'sale', 'inheritance', 'succession', 'death', 'arrest', 'jail']);

/** Chaque jour : changements de rang et grands faits de la vie du joueur, consignés dans la chronique. */
export function dailyChronicle(state: GameState): void {
  const p = state.characters[state.playerId];
  if (!p || state.observer) return;
  const last = state.chronicleSeq ?? 0;
  for (const e of state.events) {
    if (Number(e.id.slice(1)) <= last || e.importance < 2 || !CHRONICLED.has(e.type)) continue;
    if (e.actorId === p.id || e.targetId === p.id) chronicle(state, e.text);
  }
  state.chronicleSeq = state.eventSeq;
  if (!p.alive) return;
  // seuls les rangs atteints pour la première fois entrent dans la chronique (pas les va-et-vient de la bourse)
  const r = socialRank(state, p);
  if (state.playerRank === undefined) state.playerRank = r.level;
  else if (r.level > state.playerRank) {
    chronicle(state, `${fullName(p)} devient ${r.name.toLowerCase()}.`);
    state.playerRank = r.level;
  }
}

// ── Génération des requêtes ──────────────────────────────────

function newQuest(state: GameState, q: Omit<Quest, 'id' | 'status' | 'offeredDay'>): Quest {
  state.idSeq += 1;
  const quest: Quest = { ...q, id: `q${state.idSeq}`, status: 'offerte', offeredDay: today(state) };
  (state.quests ??= []).push(quest);
  return quest;
}

/** Chaque jour : de nouvelles requêtes apparaissent selon la situation réelle des habitants. */
export function dailyQuests(state: GameState): void {
  state.quests ??= [];
  const day = today(state);
  const p = state.characters[state.playerId];
  // expiration des offres et des engagements
  for (const q of state.quests) {
    if (q.status === 'offerte' && q.deadlineDay < day) q.status = 'expiree';
    if (q.status === 'acceptee' && q.deadlineDay < day) failQuest(state, q, 'le délai est passé');
  }
  state.quests = state.quests.filter(q => q.status === 'offerte' || q.status === 'acceptee' || day - q.offeredDay < 60);
  if (!p?.alive || state.observer) return;
  if (openOffers(state).length >= MAX_OFFERS) return;
  const busy = new Set(quests(state).filter(q => q.status === 'offerte' || q.status === 'acceptee').map(q => q.giverId));
  const rank = socialRank(state, p).level;
  const candidates: { kind: QuestKind; make: () => boolean }[] = [];
  for (const n of npcs(state)) {
    if (n.age < 16 || busy.has(n.id) || (n.jailedUntil ?? 0) > state.time) continue;
    const r = getRelation(state, n.id, p.id);
    if (r.affinity < -10 || r.trust < -15) continue; // on ne demande rien à qui l'on n'aime pas
    // 1. Livraison : l'atelier du PNJ manque d'un intrant
    for (const b of ownedBusinesses(state, n)) {
      const item = (Object.entries(b.lastShortageDay) as [ItemId, number][]).find(([it, d]) => d >= day - 1 && b.buys.includes(it))?.[0];
      if (!item) continue;
      const count = Math.max(2, Math.min(8, (b.targets[item] ?? 4) - qty(b.stock, item)));
      const reward = Math.round(count * ITEMS[item].base * 1.6);
      if (n.money < reward && b.treasury < reward) continue;
      candidates.push({ kind: 'livraison', make: () => !!newQuest(state, { kind: 'livraison', giverId: n.id, businessId: b.id, item, count, reward, deadlineDay: day + 6,
        text: `${b.name} manque de ${ITEMS[item].plural}. ${n.firstName} paiera ${reward} d pour ${count} ${count > 1 ? ITEMS[item].plural : ITEMS[item].name} livrés sous six jours.` }) });
    }
    // 2. Réconciliation : une brouille que le PNJ regrette
    const enemy = Object.entries(n.relations).find(([id, rel]) => rel.affinity <= -25 && rel.affinity > -70 && state.characters[id]?.alive && !state.characters[id].isPlayer && id !== p.id);
    if (enemy && !n.traits.includes('rancunier') && r.affinity >= 0) {
      const t = state.characters[enemy[0]];
      const mirror = () => quests(state).some(q => q.kind === 'reconciliation' && (q.status === 'offerte' || q.status === 'acceptee') && q.giverId === t.id && q.targetId === n.id);
      if (!mirror()) candidates.push({ kind: 'reconciliation', make: () => !mirror() && !!newQuest(state, { kind: 'reconciliation', giverId: n.id, targetId: t.id, reward: Math.min(15, Math.floor(n.money / 4)), deadlineDay: day + 10,
        text: `${n.firstName} regrette sa brouille avec ${fullName(t)} et te prie de lui porter des paroles de paix.` }) });
    }
    // 3. Vengeance : un rancunier veut voir son ennemi humilié en public
    if (n.ambition.kind === 'vengeance' && n.ambition.targetId && state.characters[n.ambition.targetId]?.alive && n.ambition.targetId !== p.id && rank >= 1 && n.money >= 20) {
      const t = state.characters[n.ambition.targetId];
      candidates.push({ kind: 'humiliation', make: () => !!newQuest(state, { kind: 'humiliation', giverId: n.id, targetId: t.id, reward: Math.min(40, Math.floor(n.money / 3)), deadlineDay: day + 8,
        text: `${n.firstName} veut voir ${fullName(t)} humilié en public. Il paiera ${Math.min(40, Math.floor(n.money / 3))} d — mais ${t.firstName} ne te le pardonnera pas.` }) });
    }
    // 4. Nouvelles : un marchand (ou un curieux aisé) veut connaître les prix d'une autre localité
    if ((n.profession === 'marchand' || n.money >= 120) && r.trust >= 0) {
      const home = settlementIdOf(state, n.homeId);
      const far = state.settlementOrder.filter(o => o !== home);
      const target = far[(n.id.length + day) % far.length];
      const reward = n.profession === 'marchand' ? 20 : 12;
      if (target && n.money >= reward) candidates.push({ kind: 'nouvelles', make: () => !!newQuest(state, { kind: 'nouvelles', giverId: n.id, settlementId: target, reward, deadlineDay: day + 12,
        text: `${n.firstName} voudrait savoir ce que valent les denrées à ${state.settlements[target].name}. Va y relever les prix et reviens lui en rendre compte (${reward} d).` }) });
    }
    // 5. Secours : un enfant du PNJ a faim et il n'a rien à lui donner
    const hungryChild = n.childIds.map(id => state.characters[id]).find(k => k?.alive && k.age < 14 && k.needs.hunger >= 55 && qty(k.inventory, 'bread') + qty(k.inventory, 'grain') === 0);
    if (hungryChild && qty(n.inventory, 'bread') + qty(n.inventory, 'grain') === 0 && !kin(state, p, n)) {
      candidates.push({ kind: 'secours', make: () => !!newQuest(state, { kind: 'secours', giverId: n.id, targetId: hungryChild.id, reward: 0, deadlineDay: day + 2,
        text: `${n.firstName} n'a plus rien pour nourrir ${hungryChild.firstName}. Une miche de pain pour l'enfant, et ${n.firstName} ne l'oubliera pas.` }) });
    }
  }
  // une ou deux nouvelles requêtes par jour au plus : on alterne les types (le moins représenté d'abord),
  // et le choix dans chaque type est déterministe
  const openKinds = (k: QuestKind) => openOffers(state).filter(q => q.kind === k).length + acceptedQuests(state).filter(q => q.kind === k).length;
  let made = 0;
  while (made < 2 && candidates.length && openOffers(state).length < MAX_OFFERS) {
    const cap = (k: QuestKind) => (k === 'nouvelles' ? 1 : 2);
    const kinds = [...new Set(candidates.map(c => c.kind))].filter(k => openKinds(k) < cap(k))
      .sort((a, b) => openKinds(a) - openKinds(b) || (a < b ? -1 : 1));
    if (!kinds.length) break;
    const pool = candidates.filter(c => c.kind === kinds[0]);
    const pick = pool[(day * 7 + made * 13) % pool.length];
    candidates.splice(candidates.indexOf(pick), 1);
    if (pick.make()) made++;
  }
}

// ── Actions du joueur ────────────────────────────────────────

export function acceptQuest(state: GameState, questId: string): ActionResult {
  const g = guard(state); if (g) return g;
  const q = quests(state).find(x => x.id === questId);
  if (!q || q.status !== 'offerte') return no('Cette requête n’est plus d’actualité.');
  if (acceptedQuests(state).length >= 3) return no('Tu as déjà trois engagements en cours : tiens d’abord parole.');
  q.status = 'acceptee';
  q.acceptedTime = state.time;
  const giver = state.characters[q.giverId];
  modifyRelation(state, giver.id, state.playerId, 2, 2);
  logEvent(state, { type: 'contract', actorId: state.playerId, targetId: giver.id, importance: 1, text: `Tu promets à ${fullName(giver)} : ${QUEST_NAMES[q.kind].toLowerCase()}.` });
  finish(state, state.characters[state.playerId], 5);
  return ok(`Marché conclu avec ${giver.firstName}. ${q.text}`, 5);
}

export function declineQuest(state: GameState, questId: string): ActionResult {
  const q = quests(state).find(x => x.id === questId);
  if (!q || q.status !== 'offerte') return no('Cette requête n’est plus d’actualité.');
  q.status = 'refusee';
  return ok(`Tu déclines poliment la requête de ${state.characters[q.giverId].firstName}.`, 0);
}

/** Ce que le joueur peut accomplir auprès de ce PNJ pour ses engagements en cours. */
export function questActionsWith(state: GameState, npcId: string): { quest: Quest; label: string; ready: boolean; why?: string }[] {
  const p = state.characters[state.playerId];
  const out: { quest: Quest; label: string; ready: boolean; why?: string }[] = [];
  for (const q of acceptedQuests(state)) {
    if (q.kind === 'livraison' && q.giverId === npcId) {
      const have = qty(p.inventory, q.item!);
      const b = state.businesses[q.businessId!];
      out.push({ quest: q, label: `Livrer ${q.count} ${ITEMS[q.item!].plural} à ${b.name}`, ready: have >= q.count! && p.locationId === b.locationId,
        why: have < q.count! ? `Il t’en faut ${q.count} (tu en as ${have}).` : p.locationId !== b.locationId ? `Livraison à ${state.locations[b.locationId].name}.` : undefined });
    }
    if (q.kind === 'reconciliation' && q.targetId === npcId) out.push({ quest: q, label: `Porter les paroles de paix de ${state.characters[q.giverId].firstName}`, ready: true });
    if (q.kind === 'humiliation' && q.targetId === npcId) out.push({ quest: q, label: 'Humilier en public (insulte devant témoins)', ready: true });
    if (q.kind === 'secours' && q.targetId === npcId) {
      out.push({ quest: q, label: 'Donner une miche à l’enfant', ready: qty(p.inventory, 'bread') > 0, why: qty(p.inventory, 'bread') > 0 ? undefined : 'Il te faut une miche de pain.' });
    }
    if (q.kind === 'nouvelles' && q.giverId === npcId) {
      const rec = state.priceBook[q.settlementId!];
      const fresh = !!rec && q.acceptedTime !== undefined && rec.day >= toDate(q.acceptedTime).day;
      out.push({ quest: q, label: `Rendre compte des prix de ${state.settlements[q.settlementId!].name}`, ready: fresh,
        why: fresh ? undefined : `Va d’abord à ${state.settlements[q.settlementId!].name} relever les prix.` });
    }
  }
  return out;
}

export function completeQuest(state: GameState, questId: string): ActionResult {
  const g = guard(state); if (g) return g;
  const q = quests(state).find(x => x.id === questId);
  if (!q || q.status !== 'acceptee') return no('Aucun engagement en cours de ce nom.');
  const p = state.characters[state.playerId];
  const giver = state.characters[q.giverId];
  const target = q.targetId ? state.characters[q.targetId] : undefined;
  const here = (c?: Character) => !!c && c.alive && c.locationId === p.locationId;
  let minutes = 15;
  switch (q.kind) {
    case 'livraison': {
      const b = state.businesses[q.businessId!];
      if (p.locationId !== b.locationId) return no(`La livraison se fait à ${b.name}.`);
      if (qty(p.inventory, q.item!) < q.count!) return no(`Il te faut ${q.count} ${ITEMS[q.item!].plural}.`);
      transferItem(state, P.c(p.id), P.b(b.id), q.item!, q.count!);
      break;
    }
    case 'reconciliation': {
      if (!here(target)) return no('Il faut lui parler en personne.');
      modifyRelation(state, target!.id, giver.id, 18, 12);
      modifyRelation(state, giver.id, target!.id, 12, 8);
      modifyRelation(state, target!.id, p.id, 4, 4);
      minutes = 30;
      break;
    }
    case 'humiliation': {
      if (!here(target)) return no('Il faut le trouver et le faire devant témoins.');
      const r = talk(state, target!.id, 'insult');
      if (!r.ok) return r;
      if (giver.ambition.kind === 'vengeance') giver.ambition.count = (giver.ambition.count ?? 0) + 1;
      minutes = 0; // talk a déjà consommé le temps
      break;
    }
    case 'secours': {
      if (!here(target)) return no('Il faut trouver l’enfant.');
      if (!transferItem(state, P.c(p.id), P.c(target!.id), 'bread', 1)) return no('Il te faut une miche de pain.');
      break;
    }
    case 'nouvelles': {
      const rec = state.priceBook[q.settlementId!];
      if (!here(giver)) return no(`Il faut rendre compte à ${giver.firstName} en personne.`);
      if (!rec || q.acceptedTime === undefined || rec.day < toDate(q.acceptedTime).day) return no('Tes nouvelles datent d’avant ta promesse.');
      // le donneur apprend les prix réels relevés par le joueur (un marchand en tire parti)
      for (const [it, price] of Object.entries(rec.prices)) state.tradeMemory[`${giver.id}:${q.settlementId}:${it}`] = price!;
      minutes = 20;
      break;
    }
  }
  q.status = 'reussie';
  // la récompense est payée par le donneur sur ses deniers (ou sur la caisse de son atelier)
  let paid = 0;
  if (q.reward > 0) {
    const fromBiz = q.businessId && state.businesses[q.businessId]?.ownerId === giver.id ? state.businesses[q.businessId] : undefined;
    if (giver.alive && giver.money >= q.reward) { transferMoney(state, P.c(giver.id), P.c(p.id), q.reward); paid = q.reward; }
    else if (fromBiz && fromBiz.treasury >= q.reward) { transferMoney(state, P.b(fromBiz.id), P.c(p.id), q.reward); paid = q.reward; }
    else if (giver.alive && giver.money > 0) { paid = giver.money; transferMoney(state, P.c(giver.id), P.c(p.id), paid); }
  }
  if (giver.alive) modifyRelation(state, giver.id, p.id, 10, 12);
  const short = q.reward > 0 && paid < q.reward;
  const text = `${fullName(p)} tient parole envers ${fullName(giver)} (${QUEST_NAMES[q.kind].toLowerCase()})${paid ? ` et reçoit ${paid} d` : ''}.`;
  logEvent(state, { type: 'order_done', actorId: p.id, targetId: giver.id, importance: 2, locationId: p.locationId, text, witnesses: [giver.id] });
  // la chronique ne garde que les promesses marquantes (et la toute première)
  state.questsKept = (state.questsKept ?? 0) + 1;
  if (state.questsKept === 1 || q.kind === 'reconciliation' || q.kind === 'humiliation' || q.kind === 'secours' || q.reward >= 40) chronicle(state, text);
  if (minutes) finish(state, p, minutes);
  return ok(`Promesse tenue envers ${giver.firstName}.${paid ? ` Tu reçois ${paid} d.` : ''}${short ? ` (${giver.firstName} n’a pas pu payer les ${q.reward} d promis.)` : ''}`, minutes);
}

function failQuest(state: GameState, q: Quest, why: string): void {
  q.status = 'echouee';
  const giver = state.characters[q.giverId];
  const p = state.characters[state.playerId];
  if (giver?.alive) modifyRelation(state, giver.id, p.id, -8, -15);
  const text = `${fullName(p)} manque à sa parole envers ${giver ? fullName(giver) : 'un habitant'} : ${why}.`;
  logEvent(state, { type: 'order_failed', actorId: p.id, targetId: giver?.id, importance: 2, text, witnesses: giver ? [giver.id] : [] });
  chronicle(state, text);
}

/** Les engagements qui deviennent sans objet (donneur ou cible morts) sont annulés sans reproche. */
export function cleanupQuests(state: GameState): void {
  for (const q of quests(state)) {
    if (q.status !== 'offerte' && q.status !== 'acceptee') continue;
    const giver = state.characters[q.giverId];
    const target = q.targetId ? state.characters[q.targetId] : undefined;
    if (!giver?.alive || (q.targetId && !target?.alive)) q.status = 'annulee';
  }
}

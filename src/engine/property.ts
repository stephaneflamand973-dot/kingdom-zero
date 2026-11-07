// ─────────────────────────────────────────────────────────────
// Logements (phase 3) : louer, acheter, dormir chez soi, stocker dans son coffre.
// Les loyers se paient chaque lundi ; un loyer impayé vaut expulsion et saisie du coffre.
// ─────────────────────────────────────────────────────────────
import { ITEMS, WEIGHT } from './data';
import { P, transferMoney } from './economy';
import { logEvent } from './events';
import { modifyRelation } from './social';
import { toDate } from './time';
import { carryCapacity, weightOf } from './trade';
import type { ActionResult, Character, GameState, ItemId, Property } from './types';
import { addItem, fullName, player, qty } from './util';

const no = (message: string): ActionResult => ({ ok: false, message, minutes: 0 });

function landlordParty(state: GameState, pr: Property) {
  return pr.ownerId ? P.c(pr.ownerId) : P.b(state.settlements[pr.settlementId].manorId);
}
function landlordName(state: GameState, pr: Property): string {
  return pr.ownerId ? fullName(state.characters[pr.ownerId]) : `l'intendance de ${state.settlements[pr.settlementId].name}`;
}

export function propertiesAt(state: GameState, locationId: string): Property[] {
  return state.properties.filter(p => p.locationId === locationId);
}

/** Le personnage a-t-il accès à ce logement (locataire ou propriétaire) ? */
export function hasAccess(pr: Property, c: Character): boolean {
  return pr.tenantId === c.id || pr.ownerId === c.id;
}

export function homeOf(state: GameState, c: Character): Property | undefined {
  return state.properties.find(p => p.tenantId === c.id) ?? state.properties.find(p => p.ownerId === c.id);
}

export function rentProperty(state: GameState, id: string): ActionResult {
  const p = player(state);
  const pr = state.properties.find(x => x.id === id);
  if (!pr) return no('Logement inconnu.');
  if (p.locationId !== pr.locationId) return no('Il faut visiter les lieux.');
  if (pr.ownerId === p.id) return no('Ce logement est déjà à toi.');
  if (pr.tenantId) return no(pr.tenantId === p.id ? 'Tu loues déjà ce logement.' : 'Ce logement est déjà loué.');
  if (state.properties.some(x => x.tenantId === p.id)) return no('Rends d’abord ton logement actuel.');
  if (p.money < pr.weeklyRent) return no(`Il faut payer d'avance la première semaine : ${pr.weeklyRent} d.`);
  transferMoney(state, P.c(p.id), landlordParty(state, pr), pr.weeklyRent);
  pr.tenantId = p.id;
  pr.rentDueDay = toDate(state.time).day + 7;
  p.homeId = pr.locationId;
  logEvent(state, { type: 'rent', actorId: p.id, targetId: pr.ownerId ?? undefined, importance: 1, text: `Tu loues ${pr.name} à ${landlordName(state, pr)} pour ${pr.weeklyRent} d par semaine.` });
  return { ok: true, message: `Tu loues ${pr.name} (${pr.weeklyRent} d par semaine, payés chaque lundi). Tu peux y dormir et y entreposer ${pr.storageCap} unités de poids.`, minutes: 10 };
}

export function leaveProperty(state: GameState, id: string): ActionResult {
  const p = player(state);
  const pr = state.properties.find(x => x.id === id);
  if (!pr || pr.tenantId !== p.id) return no('Tu ne loues pas ce logement.');
  if (weightOf(pr.storage) > 0) return no('Vide d’abord ton coffre.');
  pr.tenantId = undefined;
  pr.rentDueDay = undefined;
  return { ok: true, message: `Tu rends ${pr.name}.`, minutes: 5 };
}

export function buyProperty(state: GameState, id: string): ActionResult {
  const p = player(state);
  const pr = state.properties.find(x => x.id === id);
  if (!pr) return no('Logement inconnu.');
  if (p.locationId !== pr.locationId) return no('Il faut visiter les lieux.');
  if (!pr.price || pr.ownerId) return no(pr.ownerId === p.id ? 'Ce logement est déjà à toi.' : 'Ce logement n’est pas à vendre.');
  if (p.money < pr.price) return no(`Il te faut ${pr.price} d.`);
  transferMoney(state, P.c(p.id), landlordParty(state, pr), pr.price);
  // un ancien locataire part ; si c'était le joueur, il devient propriétaire de son toit
  pr.tenantId = undefined;
  pr.rentDueDay = undefined;
  pr.ownerId = p.id;
  p.homeId = pr.locationId;
  logEvent(state, { type: 'property', actorId: p.id, importance: 2, locationId: pr.locationId,
    text: `${fullName(p)} achète ${pr.name} à ${state.settlements[pr.settlementId].name} pour ${pr.price} d.`, witnesses: [] });
  return { ok: true, message: `${pr.name} est à toi. Plus de loyer à payer : tu peux y dormir et y entreposer ${pr.storageCap} unités de poids.`, minutes: 20 };
}

export function deposit(state: GameState, id: string, item: ItemId, n: number): ActionResult {
  const p = player(state);
  const pr = state.properties.find(x => x.id === id);
  if (!pr || !hasAccess(pr, p)) return no('Ce coffre ne t’appartient pas.');
  if (p.locationId !== pr.locationId) return no('Ton coffre est ailleurs.');
  if (qty(p.inventory, item) < n) return no('Tu n’as pas cette quantité.');
  if (weightOf(pr.storage) + n * WEIGHT[item] > pr.storageCap) return no('Ton coffre est plein.');
  addItem(p.inventory, item, -n);
  addItem(pr.storage, item, n);
  return { ok: true, message: `Tu ranges ${n} ${n > 1 ? ITEMS[item].plural : ITEMS[item].name} dans ${pr.name}.`, minutes: 5 };
}

export function withdraw(state: GameState, id: string, item: ItemId, n: number): ActionResult {
  const p = player(state);
  const pr = state.properties.find(x => x.id === id);
  if (!pr || !hasAccess(pr, p)) return no('Ce coffre ne t’appartient pas.');
  if (p.locationId !== pr.locationId) return no('Ton coffre est ailleurs.');
  if (qty(pr.storage, item) < n) return no('Il n’y en a pas autant dans le coffre.');
  if (weightOf(p.inventory) + n * WEIGHT[item] > carryCapacity(p)) return no('Tu ne peux pas porter davantage.');
  addItem(pr.storage, item, -n);
  addItem(p.inventory, item, n);
  return { ok: true, message: `Tu prends ${n} ${n > 1 ? ITEMS[item].plural : ITEMS[item].name} dans ${pr.name}.`, minutes: 5 };
}

/** Chaque lundi : les locataires paient, ou sont expulsés et leur coffre saisi. */
export function collectRents(state: GameState): void {
  const day = toDate(state.time).day;
  for (const pr of state.properties) {
    if (!pr.tenantId || (pr.rentDueDay ?? 0) > day) continue;
    const t = state.characters[pr.tenantId];
    if (t.alive && transferMoney(state, P.c(t.id), landlordParty(state, pr), pr.weeklyRent)) {
      pr.rentDueDay = (pr.rentDueDay ?? day) + 7;
      if (t.isPlayer) logEvent(state, { type: 'rent', actorId: t.id, importance: 1, text: `Tu paies ${pr.weeklyRent} d de loyer pour ${pr.name}.` });
      continue;
    }
    // Expulsion : le contenu du coffre revient au bailleur pour solde de tout compte
    const owner = pr.ownerId ? state.characters[pr.ownerId] : undefined;
    const into = owner ? owner.inventory : state.businesses[state.settlements[pr.settlementId].manorId].stock;
    for (const [k, v] of Object.entries(pr.storage)) { addItem(into, k as ItemId, v!); delete pr.storage[k as ItemId]; }
    pr.tenantId = undefined;
    pr.rentDueDay = undefined;
    if (t.homeId === pr.locationId) t.homeId = state.settlements[pr.settlementId].squareId;
    if (owner) modifyRelation(state, owner.id, t.id, -8, -15);
    logEvent(state, {
      type: 'eviction', actorId: owner?.id, targetId: t.id, locationId: pr.locationId, importance: 2,
      text: `${fullName(t)} est expulsé de ${pr.name} faute d'avoir payé son loyer ; le contenu de son coffre est saisi.`,
      witnesses: owner ? [owner.id] : [],
    });
  }
}

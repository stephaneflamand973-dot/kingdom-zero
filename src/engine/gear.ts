// ─────────────────────────────────────────────────────────────
// Phase 10 — Équipement et train de vie.
// Armes et armures sont forgées par les forges du pays : chaque pièce
// consomme réellement des outils du stock de la forge (du fer travaillé),
// se paie à la forge, compte en combat et s'use. Le train de vie dépense
// chaque jour l'argent du joueur chez les commerçants de sa localité.
// ─────────────────────────────────────────────────────────────
import { SELF_FORGE_SKILL } from './mastery';
import { gainXp } from './skills';
import { askPrice, P, tradeRefusal, transferMoney } from './economy';
import { logEvent } from './events';
import { refusalText } from './narrative';
import { finish, guard } from './player';
import { modifyRelation } from './social';
import { toDate } from './time';
import type { ActionResult, Business, Character, GameState, GearId, GearSlot, Lifestyle } from './types';
import { addItem, businessesIn, clamp, fullName, hereSettlement, qty, residents } from './util';

export interface GearDef { id: GearId; slot: GearSlot; name: string; attack: number; defense: number; units: number; durability: number; note: string }

export const GEAR: Record<GearId, GearDef> = {
  dague: { id: 'dague', slot: 'weapon', name: 'Dague', attack: 3, defense: 0, units: 1, durability: 14, note: 'légère, se cache sous le manteau' },
  epee: { id: 'epee', slot: 'weapon', name: 'Épée courte', attack: 6, defense: 1, units: 2, durability: 20, note: 'l’arme du soldat' },
  epee_longue: { id: 'epee_longue', slot: 'weapon', name: 'Épée longue', attack: 9, defense: 2, units: 4, durability: 26, note: 'une lame de maître' },
  gambison: { id: 'gambison', slot: 'armor', name: 'Gambison renforcé', attack: 0, defense: 3, units: 1, durability: 16, note: 'toile matelassée cloutée' },
  cotte: { id: 'cotte', slot: 'armor', name: 'Cotte de mailles', attack: 0, defense: 6, units: 3, durability: 24, note: 'arrête la plupart des coups' },
  harnois: { id: 'harnois', slot: 'armor', name: 'Harnois', attack: 0, defense: 9, units: 6, durability: 32, note: 'l’armure des seigneurs' },
};
export const GEAR_IDS = Object.keys(GEAR) as GearId[];

/** Bonus d'équipement. Soldats et gardes reçoivent leur fourniment de la maison qu'ils servent. */
export function gearBonus(c: Character): { attack: number; defense: number } {
  let attack = 0, defense = 0;
  for (const slot of ['weapon', 'armor'] as const) {
    const g = c.gear?.[slot];
    if (g) { attack += GEAR[g.id].attack; defense += GEAR[g.id].defense; }
  }
  // fourniment de la maison : il couvre ce que le soldat n'a pas acheté lui-même (phase 12 : pièce par pièce)
  if (c.profession === 'soldat' || c.profession === 'garde') { if (!c.gear?.weapon) attack += 4; if (!c.gear?.armor) defense += 3; }
  return { attack, defense };
}

/** Prix à la forge : le métal (au cours des outils de cette forge) et la façon. */
export function gearPrice(state: GameState, forge: Business, id: GearId): number {
  const g = GEAR[id];
  return Math.round(g.units * askPrice(state, forge, 'tools') * 1.15 + g.units * 12 + 8);
}

/** Prix pour ce personnage : un artisan aguerri (artisanat 50) forge lui-même et ne paie que le métal et la forge (phase 14). */
export function gearPriceFor(state: GameState, forge: Business, id: GearId, c: Character): number {
  const full = gearPrice(state, forge, id);
  return c.skills.artisanat >= SELF_FORGE_SKILL ? Math.max(1, full - GEAR[id].units * 12 - 4) : full;
}

function forgeAt(state: GameState, businessId: string, p: Character): { forge?: Business; error?: string } {
  const b = state.businesses[businessId];
  if (!b || b.kind !== 'forge') return { error: 'Seule une forge fabrique armes et armures.' };
  if (p.locationId !== b.locationId) return { error: 'Il faut passer commande à la forge.' };
  const refusal = tradeRefusal(state, b, p);
  if (refusal) return { error: refusalText(state, state.characters[refusal], 'te forger quoi que ce soit') };
  return { forge: b };
}

export function buyGear(state: GameState, businessId: string, id: GearId, forId?: string): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  // le joueur peut équiper un de ses hommes d'armes (phase 11)
  const wearer = forId ? state.characters[forId] : p;
  if (!wearer?.alive || (forId && wearer.captainId !== p.id)) return { ok: false, message: 'Tu ne peux équiper que toi-même ou tes hommes d’armes.', minutes: 0 };
  const { forge, error } = forgeAt(state, businessId, p);
  if (!forge) return { ok: false, message: error!, minutes: 0 };
  const g = GEAR[id];
  if (wearer.gear?.[g.slot]?.id === id && (wearer.gear[g.slot]!.wear ?? 0) === 0) return { ok: false, message: `${forId ? `${wearer.firstName} porte` : 'Tu portes'} déjà ${g.name.toLowerCase()} en bon état.`, minutes: 0 };
  if (qty(forge.stock, 'tools') < g.units) return { ok: false, message: `${forge.name} n’a pas assez de métal ouvré (${qty(forge.stock, 'tools')}/${g.units} pièces) : reviens quand la forge aura produit.`, minutes: 0 };
  // un artisan aguerri forge lui-même : il ne paie que le métal et l'usage de la forge (phase 14)
  const self = p.skills.artisanat >= SELF_FORGE_SKILL;
  const price = gearPriceFor(state, forge, id, p);
  if (p.money < price) return { ok: false, message: `Il te faut ${price} d.`, minutes: 0 };
  transferMoney(state, P.c(p.id), P.b(forge.id), price);
  // le métal est réellement tiré du stock de la forge
  addItem(forge.stock, 'tools', -g.units);
  addItem(state.ledger.consumed, 'tools', g.units);
  (wearer.gear ??= {})[g.slot] = { id, wear: 0 };
  logEvent(state, { type: 'trade', actorId: p.id, businessId: forge.id, locationId: forge.locationId, importance: 2,
    text: `${fullName(p)} fait forger ${g.name.toLowerCase()} ${forId ? `pour ${fullName(wearer)} ` : ''}à ${forge.name} (${price} d).`, witnesses: forge.ownerId ? [forge.ownerId] : [] });
  if (forge.ownerId) modifyRelation(state, forge.ownerId, p.id, 2, 2);
  finish(state, p, self ? 120 : 30);
  if (self) gainXp(state, p, 'artisanat', 2);
  if (forId) return { ok: true, message: `${wearer.firstName} reçoit ${g.name.toLowerCase()} (${g.attack ? `attaque +${g.attack}` : ''}${g.attack && g.defense ? ', ' : ''}${g.defense ? `défense +${g.defense}` : ''}). ${price} d payés à ${forge.name}.`, minutes: 30 };
  return { ok: true, message: `Te voilà équipé : ${g.name} (${g.attack ? `attaque +${g.attack}` : ''}${g.attack && g.defense ? ', ' : ''}${g.defense ? `défense +${g.defense}` : ''}). ${price} d payés à ${forge.name}.`, minutes: 30 };
}

export function repairCost(state: GameState, forge: Business, c: Character, slot: GearSlot): number {
  const g = c.gear?.[slot];
  if (!g || !g.wear) return 0;
  return Math.max(2, Math.round(gearPrice(state, forge, g.id) * 0.35 * g.wear / GEAR[g.id].durability));
}

export function repairGear(state: GameState, businessId: string, slot: GearSlot): ActionResult {
  const g0 = guard(state); if (g0) return g0;
  const p = state.characters[state.playerId];
  const { forge, error } = forgeAt(state, businessId, p);
  if (!forge) return { ok: false, message: error!, minutes: 0 };
  const g = p.gear?.[slot];
  if (!g || !g.wear) return { ok: false, message: 'Rien à réparer.', minutes: 0 };
  const cost = repairCost(state, forge, p, slot);
  if (p.money < cost) return { ok: false, message: `Il te faut ${cost} d.`, minutes: 0 };
  transferMoney(state, P.c(p.id), P.b(forge.id), cost);
  g.wear = 0;
  finish(state, p, 20);
  return { ok: true, message: `${GEAR[g.id].name} remis à neuf pour ${cost} d.`, minutes: 20 };
}

/** Usure après un échange de coups ; une pièce à bout se brise. Renvoie les textes à ajouter au récit. */
export function wearGear(state: GameState, c: Character, struck: boolean, wasHit: boolean): string[] {
  const out: string[] = [];
  const use = (slot: GearSlot) => {
    const g = c.gear?.[slot];
    if (!g) return;
    g.wear += 1;
    if (g.wear >= GEAR[g.id].durability) {
      delete c.gear![slot];
      const text = `${GEAR[g.id].name} de ${fullName(c)} se brise, à bout d'usure.`;
      logEvent(state, { type: 'combat', actorId: c.id, importance: 2, text, witnesses: [c.id] });
      out.push(text);
    }
  };
  if (struck) use('weapon');
  if (wasHit) use('armor');
  return out;
}

// ── Train de vie ─────────────────────────────────────────────

export const LIFESTYLES: Record<Lifestyle, { name: string; cost: number; social: number; health: number; note: string }> = {
  frugal: { name: 'Frugal', cost: 0, social: 0, health: 0, note: 'On ne dépense rien : ni confort, ni largesses.' },
  modeste: { name: 'Modeste', cost: 5, social: 8, health: 0.5, note: 'Une chope le soir, du linge propre.' },
  aise: { name: 'Aisé', cost: 14, social: 16, health: 1, note: 'Bonne table, bons habits ; on vous salue.' },
  fastueux: { name: 'Fastueux', cost: 32, social: 25, health: 1.5, note: 'Table ouverte et largesses : tout le pays en parle.' },
};
export const lifestyleOf = (c: Character): Lifestyle => c.lifestyle ?? 'frugal';

export function setLifestyle(state: GameState, l: Lifestyle): ActionResult {
  const p = state.characters[state.playerId];
  if (!LIFESTYLES[l]) return { ok: false, message: 'Train de vie inconnu.', minutes: 0 };
  p.lifestyle = l;
  return { ok: true, message: `Train de vie : ${LIFESTYLES[l].name.toLowerCase()} (${LIFESTYLES[l].cost} d par jour, dépensés chez les commerçants de la localité où tu te trouves).`, minutes: 0 };
}

/** Chaque jour : la dépense du train de vie va réellement aux commerçants du lieu ; chaque lundi, la réputation suit. */
export function dailyLifestyle(state: GameState): void {
  const p = state.characters[state.playerId];
  if (!p?.alive || state.observer) return;
  const l = lifestyleOf(p);
  const def = LIFESTYLES[l];
  if (def.cost <= 0) return;
  if ((p.jailedUntil ?? 0) > state.time || state.locations[p.locationId]?.kind === 'road') return;
  if (p.money < def.cost) {
    p.lifestyle = 'frugal';
    logEvent(state, { type: 'production', actorId: p.id, importance: 2, text: `La bourse de ${fullName(p)} ne suit plus : retour à un train de vie frugal.`, witnesses: [p.id] });
    return;
  }
  const sid = hereSettlement(state, p).id;
  const shops = businessesIn(state, sid).filter(b => b.kind === 'tavern' || b.kind === 'bakery' || b.kind === 'market');
  if (!shops.length) return;
  // l'auberge reçoit la plus grosse part, le reste se partage
  const taverns = shops.filter(b => b.kind === 'tavern');
  let left = def.cost;
  if (taverns.length) { const part = Math.ceil(def.cost / 2); const each = Math.floor(part / taverns.length); for (const t of taverns) { transferMoney(state, P.c(p.id), P.b(t.id), each); left -= each; } }
  const others = shops.filter(b => b.kind !== 'tavern');
  const pool = others.length ? others : taverns;
  const each = Math.floor(left / pool.length);
  for (const b of pool) { transferMoney(state, P.c(p.id), P.b(b.id), each); left -= each; }
  if (left > 0) transferMoney(state, P.c(p.id), P.b(pool[0].id), left);
  p.needs.social = clamp(p.needs.social + def.social, 0, 100);
  p.health = clamp(p.health + def.health, 0, 100);
  // chaque lundi, les largesses font parler : quelques habitants vous estiment davantage
  if (toDate(state.time).weekday === 0 && (l === 'aise' || l === 'fastueux')) {
    const n = l === 'fastueux' ? 4 : 2;
    const day = toDate(state.time).day;
    const folk = residents(state, sid).filter(c => c.age >= 14 && c.id !== p.id);
    for (let i = 0; i < Math.min(n, folk.length); i++) modifyRelation(state, folk[(day * 7 + i * 5) % folk.length].id, p.id, l === 'fastueux' ? 3 : 2, 1);
    for (const t of taverns) if (t.ownerId) modifyRelation(state, t.ownerId, p.id, 2, 2);
  }
}

// ── Les PNJ s'équipent (phase 12) ───────────────────────────

/**
 * Chaque lundi, soldats et gardes qui ont de l'épargne se font forger ce qui leur manque
 * (le fourniment de la maison est médiocre), et les marchands qui courent les routes une dague.
 * Le métal est tiré du stock de la forge et payé à son juste prix.
 */
export function weeklyArming(state: GameState): void {
  for (const sid of state.settlementOrder) {
    const forge = businessesIn(state, sid).filter(b => b.kind === 'forge').sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (!forge) continue;
    let sold = 0;
    for (const c of residents(state, sid).filter(c => !c.isPlayer).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (sold >= 2) break; // la forge ne façonne que deux pièces par semaine pour les gens du lieu
      if (c.id === forge.ownerId || c.employerId === forge.id) continue;
      const fighter = c.profession === 'soldat' || c.profession === 'garde';
      const want: GearId | undefined = fighter
        ? (!c.gear?.armor ? 'gambison' : !c.gear?.weapon ? 'epee' : c.gear.armor.id === 'gambison' && c.money > 200 ? 'cotte' : undefined)
        : c.profession === 'marchand' && !c.gear?.weapon ? 'dague' : undefined;
      if (!want) continue;
      const g = GEAR[want];
      if (qty(forge.stock, 'tools') < g.units + 1) break; // on garde au moins un outil pour l'atelier
      const price = gearPrice(state, forge, want);
      if (c.money < price + 40) continue;
      transferMoney(state, P.c(c.id), P.b(forge.id), price);
      addItem(forge.stock, 'tools', -g.units);
      addItem(state.ledger.consumed, 'tools', g.units);
      (c.gear ??= {})[g.slot] = { id: want, wear: 0 };
      sold++;
      logEvent(state, { type: 'trade', actorId: c.id, businessId: forge.id, locationId: forge.locationId, importance: 1,
        text: `${fullName(c)} se fait forger ${g.name.toLowerCase()} à ${forge.name} (${price} d).`, witnesses: forge.ownerId ? [forge.ownerId, c.id] : [c.id] });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// IA comportementale des PNJ — architecture par scores d'utilité.
// Chaque heure : 1) évaluer l'état, 2) satisfaire les besoins immédiats,
// 3) noter les actions réalisables, 4) exécuter la meilleure,
// 5) modifier l'état du PNJ et des entités touchées.
// ─────────────────────────────────────────────────────────────
import { ITEM_IDS, ITEMS } from './data';
import { attemptTheft } from './crime';
import { askPrice, hireBest, isHiring, outputCap, P, priceForCharacter, sellersOf, trade, tradeRefusal, transferItem, transferMoney } from './economy';
import { toDate } from './time';
import { friendlyLoan } from './finance';
import { orgsOf } from './orgs';
import { festivalAt, festivalTonight, serveFestivalAle } from './society';
import { logEvent } from './events';
import { chance } from './rng';
import { getRelation, modifyRelation } from './social';
import type { Activity, ActivityKind, Business, Character, GameState, ItemId } from './types';
import { addItem, businessesIn, charactersAt, clamp, employerOf, fullName, hasTrait, hereSettlement, homeSettlement, isOpen, locationsIn, qty, settlementIdOf } from './util';
import { FOODS, RECIPES } from './data';

export function maxWorkHours(c: Character): number {
  if (c.profession === 'garde' || c.profession === 'intendant') return 6;
  return hasTrait(c, 'travailleur') ? 10 : hasTrait(c, 'paresseux') ? 6 : 8;
}

function setActivity(state: GameState, c: Character, kind: ActivityKind, locationId: string, note: string, targetId?: string): void {
  const prev = c.activity;
  const same = prev.kind === kind && prev.locationId === locationId && prev.targetId === targetId;
  c.activity = { kind, locationId, targetId, note, since: same ? prev.since : state.time } as Activity;
  c.locationId = locationId;
}

/** Manger depuis son inventaire. Renvoie vrai si un repas a été pris. */
export function eat(state: GameState, c: Character): boolean {
  const food = FOODS.find(f => qty(c.inventory, f) > 0);
  if (!food) return false;
  addItem(c.inventory, food, -1);
  addItem(state.ledger.consumed, food, 1);
  c.needs.hunger = clamp(c.needs.hunger - (ITEMS[food].food ?? 30), 0, 100);
  c.lastMealTime = state.time;
  return true;
}

export function workLocation(state: GameState, c: Character, b: Business, hour: number): string {
  const sid = settlementIdOf(state, b.locationId);
  if (c.profession === 'garde') {
    const rounds = ['square', 'market', 'tavern', 'square'] as const;
    const kind = rounds[hour % rounds.length];
    return locationsIn(state, sid, kind)[0]?.id ?? b.locationId;
  }
  if (b.kind === 'manor' && c.profession === 'journalier') {
    return state.settlements[sid].squareId; // travaux de voirie
  }
  return b.locationId;
}

interface Option { score: number; run: () => void }

export function npcDecide(state: GameState, c: Character, hour: number, weekday: number, allowPlayer = false): void {
  if (!c.alive || (c.isPlayer && !allowPlayer)) return;
  if ((c.jailedUntil ?? 0) > state.time) return; // en prison : rien à décider
  // En voyage (caravane) : le trajet occupe la personne jusqu'à l'arrivée
  if (c.activity.kind === 'travel' && (c.activity.until ?? 0) > state.time) {
    if (c.needs.hunger >= 40) eat(state, c); // on mange ses provisions en chemin
    return;
  }
  const home = homeSettlement(state, c);
  const n = c.needs;

  // ── Enfance (phase 5) : dormir, jouer, aider ses parents ; ce sont eux qui nourrissent l'enfant
  if (c.age < 14) {
    if (n.hunger >= 40) eat(state, c);
    const night0 = hour >= 20 || hour < 7;
    if (night0 || n.energy < 25) { setActivity(state, c, 'sleep', c.homeId, c.age < 2 ? 'Nourrisson' : 'Dort'); return; }
    const parent = c.parentIds.map(id => state.characters[id]).find(p => p?.alive && p.employerId && p.activity.kind === 'work');
    if (c.age >= 10 && parent) setActivity(state, c, 'idle', parent.locationId, `Aide ${parent.firstName} au travail`);
    else setActivity(state, c, 'idle', c.homeId, c.age < 3 ? 'Dans les bras de sa famille' : 'Joue près de la maison');
    return;
  }
  const job = employerOf(state, c);
  const sunday = weekday === 6;
  const night = hour >= 22 || hour < 6;

  // ── Besoin immédiat : manger si l'on a de quoi
  if (n.hunger >= 40) eat(state, c);

  const opts: Option[] = [];

  // Dormir
  {
    let s = night ? 95 : 0;
    if (n.energy < 15) s = Math.max(s, 85);
    if (c.sick > 0 && !night) s = Math.max(s, 60);
    if (s > 0) opts.push({ score: s, run: () => setActivity(state, c, 'sleep', c.homeId, c.sick > 0 ? 'Malade, il garde le lit' : 'Dort chez soi') });
  }

  // Soldat : patrouille sur la place, ou sur une route infestée de brigands
  if (c.profession === 'soldat' && !night && hour >= 8 && hour < 20 && n.energy > 15 && n.hunger < 90) {
    const house = orgsOf(state, c.id, 'house')[0];
    if (house && c.hoursWorkedToday < 8) {
      const roads = house.patrolRoads;
      const onRoad = roads.length > 0 && (hour + c.id.length) % 3 === 0;
      const loc = onRoad ? roads[hour % roads.length] : home.squareId;
      opts.push({ score: 72, run: () => { setActivity(state, c, 'patrol', loc, onRoad ? `Patrouille sur ${state.locations[loc].name}` : `Monte la garde (${state.locations[loc].name})`); c.hoursWorkedToday += 1; } });
    }
  }

  // Travailler
  if (job && !night && (!sunday || job.kind === 'tavern' || c.profession === 'garde')) {
    const within = isOpen(job, hour) && hour < 21;
    if (within && c.hoursWorkedToday < maxWorkHours(c) && n.energy > 12 && n.hunger < 92) {
      let s = 70;
      if (hasTrait(c, 'travailleur')) s += 10;
      if (hasTrait(c, 'paresseux')) s -= 12;
      if (c.unpaidWages > 0) s -= 15; // peu motivé si non payé
      if (c.sick > 0) s -= 30;
      const loc = workLocation(state, c, job, hour);
      opts.push({ score: s, run: () => setActivity(state, c, 'work', loc, describeWork(state, c, job, loc), job.id) });
    }
  }

  // S'approvisionner en nourriture
  const bread = qty(c.inventory, 'bread') + qty(c.inventory, 'grain');
  if (!night && (bread === 0 && n.hunger > 25 || bread < 2 && n.hunger > 10)) {
    // pain de préférence ; à défaut, du grain pour la bouillie
    const best = sellersOf(state, 'bread', hour, c)[0] ?? sellersOf(state, 'grain', hour, c)[0];
    if (best && c.money >= best.price) {
      const s = 28 + n.hunger * 0.6 + (bread === 0 ? 8 : 0);
      opts.push({ score: s, run: () => buyFood(state, c, best.b, best.price, best.b.sells.includes('bread') && qty(best.b.stock, 'bread') > 0 ? 'bread' : 'grain') });
    } else if (n.hunger > 55) {
      opts.push({ score: 50 + n.hunger * 0.45, run: () => seekHelp(state, c, hour) });
    }
  }

  // Bois de chauffe pour le foyer
  const season = toDate(state.time).season;
  if (!night && qty(c.inventory, 'wood') === 0 && n.hunger < 70) {
    const ws = sellersOf(state, 'wood', hour, c)[0];
    if (ws && c.money >= ws.price + 12) {
      opts.push({ score: 36 + (season >= 2 ? 18 : 0), run: () => buyGoods(state, c, ws.b, 'wood', ws.price, season === 3 ? 3 : 2) });
    }
  }

  // Vendre le surplus (bois ramassé, etc.)
  if (!night && qty(c.inventory, 'wood') >= 4) {
    const buyer = bestBuyer(state, c, 'wood', hour);
    if (buyer) opts.push({ score: 58, run: () => sellGoods(state, c, buyer.b, 'wood', buyer.price, qty(c.inventory, 'wood') - 1) });
  }

  // Domestique : sert chez son maître pendant la journée
  if (c.masterId && !night && hour >= 8 && hour < 17 && !sunday && n.energy > 15) {
    const m = state.characters[c.masterId];
    if (m?.alive) opts.push({ score: 66, run: () => setActivity(state, c, 'idle', m.homeId, `Sert chez ${fullName(m)}`) });
  }

  // Chercher du travail (plutôt le matin)
  if (!job && !night && !sunday && hour >= 7 && hour < 17 && c.age < 70 && c.profession !== 'seigneur' && c.profession !== 'soldat') {
    const s = 50 + (hour < 10 ? 10 : 0) + (hasTrait(c, 'ambitieux') ? 10 : 0) - (hasTrait(c, 'paresseux') ? 15 : 0);
    opts.push({ score: s, run: () => seekJob(state, c) });
  }

  // Ramasser du bois mort : le gagne-pain des démunis
  // (phase 6 : inutile d'entasser des fagots que personne n'achète ; on garde de quoi se chauffer)
  if (!job && !night && hour >= 7 && hour < 18 && c.money < 60 && c.age < 72 && n.energy > 20 && c.profession !== 'seigneur' && c.profession !== 'soldat'
    && (qty(c.inventory, 'wood') < 10 || !!bestBuyer(state, c, 'wood', hour))) {
    const s = 52 + (c.money < 15 ? 12 : 0) - (hasTrait(c, 'paresseux') ? 10 : 0);
    const wood = locationsIn(state, home.id, 'woodlot')[0]?.id ?? home.squareId;
    opts.push({ score: s, run: () => setActivity(state, c, 'forage', wood, 'Ramasse du bois mort en lisière') });
  }

  // Sociabiliser à la taverne (la fête de saison attire tout le village)
  const tavern = businessesIn(state, home.id).find(b => b.kind === 'tavern');
  const feast = festivalTonight(state, home.squareId);
  if (tavern && hour >= 17 && hour < 23 && (n.social < 85 || feast) && n.energy > 15) {
    let s = 30 + (100 - n.social) * 0.45 + (feast ? 45 : 0);
    if (hasTrait(c, 'sociable')) s += 15;
    if (hasTrait(c, 'timide')) s -= 15;
    if (hour >= 22) s -= 20;
    opts.push({ score: s, run: () => socialize(state, c, tavern, hour) });
  }

  // Vengeance nocturne : un malhonnête rancunier vole dans l'affaire de son ennemi
  const a = c.ambition;
  if (a.kind === 'vengeance' && a.targetId && hasTrait(c, 'malhonnete') && hour === 23 && chance(state, 0.15)) {
    const target = businessesIn(state, home.id).find(b => b.ownerId === a.targetId);
    const item = target && (Object.keys(target.stock) as ItemId[]).filter(i => qty(target.stock, i) > 0)
      .sort((x, y) => ITEMS[y].base - ITEMS[x].base)[0];
    if (target && item) {
      opts.push({ score: 99, run: () => {
        c.locationId = target.locationId;
        const out = attemptTheft(state, c, target, item, 1);
        a.count = (a.count ?? 0) + 1;
        setActivity(state, c, 'shop', target.locationId, 'caught' in out && out.caught ? 'Surpris en train de se venger !' : 'Rôde de nuit autour d’une échoppe', target.id);
      } });
    }
  }

  // Par défaut : vaquer chez soi
  opts.push({ score: 12, run: () => setActivity(state, c, 'idle', c.homeId, night ? 'Veille chez soi' : 'Vaque à ses occupations domestiques') });

  opts.sort((a, b) => b.score - a.score);
  opts[0].run();
  state.stats.npcActions += 1;
}

function describeWork(state: GameState, c: Character, job: Business, loc: string): string {
  if (c.profession === 'garde') return `Patrouille (${state.locations[loc].name})`;
  if (job.kind === 'manor' && c.profession === 'journalier') return 'Entretient les chemins pour l’intendance';
  if (job.kind === 'manor') return 'Tient les registres de l’intendance';
  const r = RECIPES[job.kind];
  if (!r) return `Tient l'étal de ${job.name}`;
  const missing = (Object.keys(r.inputs) as (keyof typeof r.inputs)[]).find(it => qty(job.stock, it) < (r.inputs[it] ?? 0));
  if (missing) return `Attend des ${ITEMS[missing].plural} à ${job.name}`;
  return job.ownerId === c.id ? `Travaille dans son établissement (${job.name})` : `Travaille à ${job.name}`;
}

function buyFood(state: GameState, c: Character, b: Business, price: number, item: ItemId): void {
  const want = hasTrait(c, 'avare') ? 2 : 3;
  const n = Math.max(1, Math.min(want, Math.floor(c.money / price), qty(b.stock, item)));
  if (trade(state, P.c(c.id), P.b(b.id), item, n, price)) {
    setActivity(state, c, 'shop', b.locationId, item === 'bread'
      ? `Achète ${n} pain${n > 1 ? 's' : ''} à ${b.name} (${price} d)`
      : `Faute de pain, achète ${n} boisseau${n > 1 ? 'x' : ''} de grain pour la bouillie`, b.id);
    if (c.needs.hunger >= 40) eat(state, c);
  } else {
    setActivity(state, c, 'idle', c.homeId, 'N’a pas pu acheter de pain');
  }
}

/** Phase 6 — vivres de disette : racines, baies, glands. Dernier recours quand plus rien ne se vend. */
function gatherFood(state: GameState, c: Character, hour: number): boolean {
  if (hour < 6 || hour >= 19 || c.needs.energy < 12 || c.age < 8) return false;
  const wood = locationsIn(state, homeSettlement(state, c).id, 'woodlot')[0];
  if (!wood) return false;
  setActivity(state, c, 'forage', wood.id, 'Cherche racines et baies en forêt');
  c.activity.item = 'grain';
  return true;
}

/** Phase 6 — vente de détresse : un affamé sans le sou brade ses biens (au demi-prix) à qui en achète. */
function distressSale(state: GameState, c: Character, hour: number): boolean {
  for (const item of ITEM_IDS) {
    if (item === 'bread' || item === 'grain' || qty(c.inventory, item) < 1) continue;
    const keep = item === 'wood' ? 3 : 0;
    const offers = businessesIn(state, hereSettlement(state, c).id)
      .filter(b => b.buys.includes(item) && isOpen(b, hour) && b.ownerId !== c.id && !tradeRefusal(state, b, c) && qty(b.stock, item) < (b.targets[item] ?? 0) * 4)
      .map(b => ({ b, price: Math.max(1, Math.floor(priceForCharacter(state, b, c, item, 'sell') * 0.5)) }))
      .filter(x => x.b.treasury >= x.price)
      .sort((x, y) => y.price - x.price || (x.b.id < y.b.id ? -1 : 1));
    const o = offers[0];
    const n = o ? Math.min(qty(c.inventory, item) - keep, 4, Math.floor(o.b.treasury / o.price)) : 0;
    if (!o || n <= 0 || !trade(state, P.b(o.b.id), P.c(c.id), item, n, o.price)) continue;
    setActivity(state, c, 'shop', o.b.locationId, `Brade ${n} ${n > 1 ? ITEMS[item].plural : ITEMS[item].name} à ${o.b.name} pour manger (${o.price} d pièce)`, o.b.id);
    return true;
  }
  return false;
}

function seekHelp(state: GameState, c: Character, hour: number): void {
  // 00. Brader ce qu'on a avant de mendier
  if (c.money < 5 && distressSale(state, c, hour)) return;
  // 0. Plus rien à vendre dans la localité : on part chercher sa pitance en forêt
  const forSale = sellersOf(state, 'bread', hour, c, true).length + sellersOf(state, 'grain', hour, c, true).length;
  if (forSale === 0 && gatherFood(state, c, hour)) return;
  // 1. Demander à l'ami le plus proche qui a de quoi donner
  const friends = Object.entries(c.relations)
    .filter(([id, r]) => r.affinity >= 10 && state.characters[id]?.alive && !state.characters[id].isPlayer)
    .map(([id, r]) => ({ f: state.characters[id], r }))
    .sort((a, b) => b.r.affinity - a.r.affinity || (a.f.id < b.f.id ? -1 : 1));
  for (const { f } of friends) {
    const their = getRelation(state, f.id, c.id);
    const generous = hasTrait(f, 'genereux') ? 15 : hasTrait(f, 'avare') ? -25 : 0;
    if (their.affinity + generous < 15) continue;
    if (qty(f.inventory, 'bread') >= 2) {
      transferItem(state, P.c(f.id), P.c(c.id), 'bread', 1);
      giveHelpEvent(state, f, c, 'une miche de pain');
      eat(state, c);
      setActivity(state, c, 'talk', f.locationId, `Demande de l'aide à ${fullName(f)}`, f.id);
      return;
    }
    if (f.money >= 40) {
      const gift = 8;
      transferMoney(state, P.c(f.id), P.c(c.id), gift);
      giveHelpEvent(state, f, c, `${gift} deniers`);
      setActivity(state, c, 'talk', f.locationId, `Demande de l'aide à ${fullName(f)}`, f.id);
      return;
    }
  }
  // 1 ter. Emprunter quelques deniers à un ami (à rembourser sur ses gages)
  if (c.money < 5 && friendlyLoan(state, c)) {
    setActivity(state, c, 'talk', c.locationId, 'Emprunte quelques deniers à un ami');
    return;
  }
  // 1 bis. Mendier les invendus d'un commerce en surplus (plutôt que de les laisser rassir)
  //     (phase 6 : aussi le grain des greniers qui débordent, et les affaires tenues par l'intendance)
  for (const item of ['bread', 'grain'] as const) for (const b of businessesIn(state, homeSettlement(state, c).id)) {
    if (b.kind === 'manor' || !b.sells.includes(item) || !isOpen(b, hour)) continue;
    const surplus = qty(b.stock, item) - (b.targets[item] ?? 0) * (item === 'bread' ? 1.2 : 1.5);
    const owner = b.ownerId ? state.characters[b.ownerId] : undefined;
    if (surplus < 1 || (owner && (!owner.alive || (hasTrait(owner, 'avare') && c.needs.hunger < 85)))) continue;
    if (owner) {
      const r = getRelation(state, owner.id, c.id);
      if (r.affinity < -20 + (hasTrait(owner, 'genereux') ? -25 : 0)) continue;
    }
    const n = item === 'grain' ? Math.min(2, Math.floor(surplus)) : 1;
    transferItem(state, P.b(b.id), P.c(c.id), item, n);
    if (owner) modifyRelation(state, c.id, owner.id, 8, 6);
    const giver = owner ? fullName(owner) : `L'intendance (${b.name})`;
    logEvent(state, {
      type: 'help', actorId: owner?.id, targetId: c.id, businessId: b.id, locationId: b.locationId, importance: 1,
      text: item === 'bread'
        ? `${giver} donne une miche invendue de ${b.name} à ${fullName(c)}, qui n'a plus de quoi manger.`
        : `${giver} donne ${n} boisseau${n > 1 ? 'x' : ''} de grain du grenier de ${b.name} à ${fullName(c)}, qui n'a plus de quoi manger.`,
      witnesses: charactersAt(state, b.locationId).map(x => x.id),
    });
    eat(state, c);
    setActivity(state, c, 'talk', b.locationId, item === 'bread' ? `Mendie du pain à ${b.name}` : `Mendie du grain à ${b.name}`, b.id);
    return;
  }
  // 2. Le désespoir pousse les malhonnêtes (ou les affamés) au vol
  const desperate = c.needs.hunger >= 90 || hasTrait(c, 'malhonnete');
  if (desperate && !c.isPlayer && !hasTrait(c, 'honnete') && chance(state, hasTrait(c, 'malhonnete') ? 0.6 : 0.25)) {
    const target = businessesIn(state, homeSettlement(state, c).id).find(b => b.sells.includes('bread') && qty(b.stock, 'bread') > 0);
    if (target) {
      c.locationId = target.locationId;
      const out = attemptTheft(state, c, target, 'bread', 1);
      if ('success' in out && out.success) eat(state, c);
      setActivity(state, c, 'shop', target.locationId, out && 'caught' in out && out.caught ? 'Pris la main dans le sac !' : 'Rôde autour des étals', target.id);
      return;
    }
  }
  if (c.needs.hunger >= 70 && gatherFood(state, c, hour)) return;
  setActivity(state, c, 'idle', c.homeId, hour < 20 ? 'Affamé et sans le sou' : 'Affamé, tente de dormir');
}

function giveHelpEvent(state: GameState, giver: Character, receiver: Character, what: string): void {
  modifyRelation(state, receiver.id, giver.id, 10, 8);
  modifyRelation(state, giver.id, receiver.id, 2, 0);
  logEvent(state, {
    type: 'help', actorId: giver.id, targetId: receiver.id, locationId: giver.locationId, importance: 1,
    text: `${fullName(giver)} donne ${what} à ${fullName(receiver)}, affamé.`,
    witnesses: charactersAt(state, giver.locationId).map(x => x.id),
  });
}

function seekJob(state: GameState, c: Character): void {
  const hs = homeSettlement(state, c);
  const options = businessesIn(state, hs.id)
    .filter(b => isHiring(state, b))
    .filter(b => !b.ownerId || getRelation(state, b.ownerId, c.id).affinity > -25);
  // rotation déterministe parmi les candidatures possibles
  const b = options.length ? options[(c.hoursWorkedToday + state.processedHours) % options.length] : undefined;
  if (!b) {
    setActivity(state, c, 'seekJob', hs.squareId, 'Cherche du travail, en vain');
    return;
  }
  const hired = hireBest(state, b, [c]);
  if (hired) b.lastStaffChangeDay = toDate(state.time).day;
  setActivity(state, c, 'seekJob', b.locationId, hired ? `Vient d'être embauché à ${b.name}` : `Demande du travail à ${b.name}`, b.id);
}

function buyGoods(state: GameState, c: Character, b: Business, item: ItemId, price: number, want: number): void {
  const n = Math.max(1, Math.min(want, Math.floor((c.money - 10) / price), qty(b.stock, item)));
  if (n > 0 && trade(state, P.c(c.id), P.b(b.id), item, n, price)) {
    setActivity(state, c, 'shop', b.locationId, `Achète ${n} ${n > 1 ? ITEMS[item].plural : ITEMS[item].name} à ${b.name}`, b.id);
  } else setActivity(state, c, 'idle', c.homeId, 'Rentre bredouille');
}

export function bestBuyer(state: GameState, c: Character, item: ItemId, hour: number): { b: Business; price: number } | undefined {
  return businessesIn(state, hereSettlement(state, c).id)
    .filter(b => b.buys.includes(item) && isOpen(b, hour) && b.ownerId !== c.id && !tradeRefusal(state, b, c))
    .filter(b => qty(b.stock, item) + 1 <= outputCap(b, item) && qty(b.stock, item) < (b.targets[item] ?? 0) * 2)
    .map(b => ({ b, price: priceForCharacter(state, b, c, item, 'sell') }))
    .filter(x => x.b.treasury >= x.price)
    .sort((x, y) => y.price - x.price || (x.b.id < y.b.id ? -1 : 1))[0];
}

function sellGoods(state: GameState, c: Character, b: Business, item: ItemId, price: number, want: number): void {
  const room = Math.min((b.targets[item] ?? 0) * 2 - qty(b.stock, item), Math.floor(b.treasury / price));
  const n = Math.max(0, Math.min(want, room));
  if (n > 0 && trade(state, P.b(b.id), P.c(c.id), item, n, price)) {
    setActivity(state, c, 'shop', b.locationId, `Vend ${n} ${n > 1 ? ITEMS[item].plural : ITEMS[item].name} à ${b.name} (${price} d pièce)`, b.id);
  } else setActivity(state, c, 'idle', c.homeId, 'Ne trouve pas d’acheteur');
}

function socialize(state: GameState, c: Character, tavern: Business, hour: number): void {
  let note = `Passe la soirée à ${tavern.name}`;
  if (serveFestivalAle(state, c, tavern)) {
    setActivity(state, c, 'socialize', tavern.locationId, `Trinque à la ${festivalAt(state, tavern.locationId)?.name.toLowerCase() ?? 'fête'}`, tavern.id);
    return;
  }
  // Qui épargne pour s'établir se prive de bière
  const saving = c.ambition.kind === 'ouvrir_commerce' && c.money < (c.ambition.target ?? 0) && c.needs.social > 30;
  // Les gens aisés dînent à l'auberge plutôt que de manger leur pain
  if (isOpen(tavern, hour) && c.money > 150 && c.needs.hunger > 25 && qty(tavern.stock, 'bread') > 0) {
    const mp = askPrice(state, tavern, 'bread');
    if (trade(state, P.c(c.id), P.b(tavern.id), 'bread', 1, mp)) { eat(state, c); note = `Dîne à ${tavern.name}`; }
  }
  if (isOpen(tavern, hour) && qty(tavern.stock, 'ale') > 0) {
    const price = askPrice(state, tavern, 'ale');
    const foodReserve = askPrice(state, tavern, 'bread') * 2;
    const thirsty = !saving && (!hasTrait(c, 'avare') || chance(state, 0.3));
    if (thirsty && c.money >= price + foodReserve && trade(state, P.c(c.id), P.b(tavern.id), 'ale', 1, price)) {
      addItem(c.inventory, 'ale', -1);
      addItem(state.ledger.consumed, 'ale', 1);
      c.needs.social = clamp(c.needs.social + 15, 0, 100);
      c.needs.hunger = clamp(c.needs.hunger - 4, 0, 100);
      note = note.startsWith('Dîne') ? `Dîne et boit à ${tavern.name}` : `Boit une bière à ${tavern.name}`;
    }
  }
  setActivity(state, c, 'socialize', tavern.locationId, note, tavern.id);
}

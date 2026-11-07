// Génération du monde initial : la région de Valcendre (phase 3 : trois localités reliées par des routes).
// La composition est fixe (pour des tests stables) ; les détails varient avec la graine.
import type { AttrId, Business, BusinessKind, Character, GameState, Inventory, ItemId, Location, OrgRole, Organization, ProfessionId, Property, Settlement, SkillId, TraitId } from './types';
import { randInt } from './rng';
import { absoluteHour, recordPrices } from './sim';
import { modifyRelation } from './social';
import { initialAmbition } from './society';

export const SAVE_VERSION = 4;

const LOCATIONS: Omit<Location, 'settlementId'>[] = [
  { id: 'square', name: 'Place du Puits', kind: 'square', x: 500, y: 330, description: 'Le cœur de Valcendre : un vieux puits, des bancs de pierre, les nouvelles qui circulent.' },
  { id: 'market', name: 'Halle du Marché', kind: 'market', x: 640, y: 270, description: 'Une halle couverte où le marchand revend grains, pain, bois et fer.' },
  { id: 'tavern', name: 'Auberge du Sanglier Gris', kind: 'tavern', x: 395, y: 235, description: 'Bière tiède, feu de bois et langues qui se délient le soir.' },
  { id: 'bakery', name: 'Fournil de Perrine', kind: 'bakery', x: 590, y: 425, description: 'L’odeur du pain chaud flotte dès l’aube autour du four banal.' },
  { id: 'forge', name: "Forge d'Aldric", kind: 'forge', x: 360, y: 420, description: 'Le marteau sonne sur l’enclume ; ici naissent les outils du village.' },
  { id: 'manor', name: "Maison de l'Intendant", kind: 'manor', x: 690, y: 135, description: 'Siège de l’intendance seigneuriale : registres, impôts et garde.' },
  { id: 'houses_a', name: 'Chaumières du Ruisseau', kind: 'houses', x: 255, y: 300, description: 'Maisons de torchis au bord de l’eau, où logent les familles modestes.' },
  { id: 'houses_b', name: 'Rue des Tisserands', kind: 'houses', x: 770, y: 420, description: 'Une rue étroite de maisons à colombages.' },
  { id: 'farm', name: 'Ferme des Lebrun', kind: 'farm', x: 175, y: 500, description: 'Des champs de blé, une grange où l’on tolère parfois les vagabonds.' },
  { id: 'woodlot', name: 'Bois de la Combe', kind: 'woodlot', x: 135, y: 150, description: 'Une forêt de chênes et de hêtres, exploitée par les bûcherons.' },
  { id: 'mine', name: 'Mine du Roc-Noir', kind: 'mine', x: 880, y: 160, description: 'Une galerie humide creusée dans la colline, riche en minerai de fer.' },
];

export interface BizSpec {
  id: string; name: string; kind: BusinessKind; loc: string; owner: string | null; treasury: number; stock: Inventory;
  maxWorkers: number; wage: number; open: [number, number]; sells: ItemId[]; buys: ItemId[]; targets: Inventory;
}

const BUSINESSES: BizSpec[] = [
  { id: 'b_farm', name: 'Ferme des Lebrun', kind: 'farm', loc: 'farm', owner: 'gautier', treasury: 260, stock: { grain: 70, tools: 3 }, maxWorkers: 3, wage: 4, open: [6, 18], sells: ['grain'], buys: ['tools'], targets: { grain: 60, tools: 2 } },
  { id: 'b_wood', name: 'Bois de la Combe', kind: 'woodlot', loc: 'woodlot', owner: 'renaud', treasury: 140, stock: { wood: 22, tools: 2 }, maxWorkers: 3, wage: 4, open: [7, 17], sells: ['wood'], buys: ['tools'], targets: { wood: 25, tools: 1 } },
  { id: 'b_mine', name: 'Mine du Roc-Noir', kind: 'mine', loc: 'mine', owner: 'thibault', treasury: 160, stock: { iron: 10, tools: 2 }, maxWorkers: 1, wage: 5, open: [7, 17], sells: ['iron'], buys: ['tools'], targets: { iron: 10, tools: 1 } },
  { id: 'b_bakery', name: 'Fournil de Perrine', kind: 'bakery', loc: 'bakery', owner: 'perrine', treasury: 220, stock: { bread: 30, grain: 12, wood: 6 }, maxWorkers: 3, wage: 5, open: [6, 19], sells: ['bread'], buys: ['grain', 'wood'], targets: { bread: 35, grain: 16, wood: 8 } },
  { id: 'b_tavern', name: 'Auberge du Sanglier Gris', kind: 'tavern', loc: 'tavern', owner: 'mathilde', treasury: 240, stock: { ale: 25, grain: 6, bread: 8 }, maxWorkers: 1, wage: 4, open: [10, 23], sells: ['ale', 'bread'], buys: ['grain', 'bread'], targets: { ale: 22, grain: 6, bread: 8 } },
  { id: 'b_forge', name: "Forge d'Aldric", kind: 'forge', loc: 'forge', owner: 'aldric', treasury: 260, stock: { tools: 4, iron: 6, wood: 4 }, maxWorkers: 1, wage: 5, open: [7, 18], sells: ['tools'], buys: ['iron', 'wood'], targets: { tools: 4, iron: 6, wood: 4 } },
  { id: 'b_market', name: 'Halle du Marché', kind: 'market', loc: 'market', owner: 'bertrand', treasury: 300, stock: { bread: 10, grain: 10, wood: 6, iron: 2, tools: 1 }, maxWorkers: 0, wage: 4, open: [7, 19], sells: ['bread', 'grain', 'wood', 'iron', 'tools'], buys: ['bread', 'grain', 'wood', 'iron', 'tools'], targets: { bread: 12, grain: 10, wood: 6, iron: 3, tools: 1 } },
  { id: 'b_manor', name: "Intendance de Valcendre", kind: 'manor', loc: 'manor', owner: null, treasury: 1200, stock: {}, maxWorkers: 6, wage: 3, open: [8, 20], sells: [], buys: [], targets: {} },
];

export interface NpcSpec {
  id: string; first: string; last: string; age: number; sex: 'M' | 'F'; prof: ProfessionId; home: string; job?: string;
  money: number; traits: TraitId[]; skills: Partial<Record<SkillId, number>>; attrs?: Partial<Record<AttrId, number>>;
}

const NPCS: NpcSpec[] = [
  { id: 'odon', first: 'Odon', last: 'Delaval', age: 52, sex: 'M', prof: 'intendant', home: 'manor', job: 'b_manor', money: 140, traits: ['avare', 'ambitieux', 'prudent'], skills: { gestion: 38, diplomatie: 25, commerce: 15 }, attrs: { intelligence: 7 } },
  { id: 'bastien', first: 'Bastien', last: 'Roquefort', age: 31, sex: 'M', prof: 'garde', home: 'manor', job: 'b_manor', money: 50, traits: ['colerique', 'honnete', 'loyal'], skills: { combat: 35, commandement: 10 }, attrs: { force: 7, perception: 6 } },
  { id: 'hugues', first: 'Hugues', last: 'Malestroit', age: 26, sex: 'M', prof: 'garde', home: 'houses_b', job: 'b_manor', money: 35, traits: ['paresseux', 'sociable'], skills: { combat: 28 }, attrs: { perception: 4 } },
  { id: 'gautier', first: 'Gautier', last: 'Lebrun', age: 47, sex: 'M', prof: 'fermier', home: 'farm', job: 'b_farm', money: 110, traits: ['travailleur', 'avare', 'prudent'], skills: { agriculture: 40, gestion: 22, commerce: 12 } },
  { id: 'martin', first: 'Martin', last: 'Lebrun', age: 19, sex: 'M', prof: 'fermier', home: 'farm', job: 'b_farm', money: 20, traits: ['sociable'], skills: { agriculture: 20 } },
  { id: 'agnes', first: 'Agnès', last: 'Corbin', age: 34, sex: 'F', prof: 'fermier', home: 'houses_a', job: 'b_farm', money: 30, traits: ['travailleur', 'genereux', 'loyal'], skills: { agriculture: 28 } },
  { id: 'renaud', first: 'Renaud', last: 'Brisefer', age: 39, sex: 'M', prof: 'bucheron', home: 'houses_a', job: 'b_wood', money: 70, traits: ['timide', 'travailleur'], skills: { agriculture: 30 }, attrs: { force: 8 } },
  { id: 'colin', first: 'Colin', last: 'Vautrin', age: 23, sex: 'M', prof: 'bucheron', home: 'houses_a', job: 'b_wood', money: 15, traits: ['malhonnete', 'paresseux'], skills: { agriculture: 14, discretion: 20 } },
  { id: 'thibault', first: 'Thibault', last: 'Grisard', age: 44, sex: 'M', prof: 'mineur', home: 'houses_b', job: 'b_mine', money: 80, traits: ['colerique', 'travailleur', 'rancunier'], skills: { agriculture: 32 }, attrs: { force: 8, endurance: 7 } },
  { id: 'perrine', first: 'Perrine', last: 'Fournier', age: 41, sex: 'F', prof: 'boulanger', home: 'bakery', job: 'b_bakery', money: 120, traits: ['genereux', 'sociable'], skills: { artisanat: 38, commerce: 20, gestion: 18 } },
  { id: 'jehan', first: 'Jehan', last: 'Fournier', age: 17, sex: 'M', prof: 'boulanger', home: 'bakery', job: 'b_bakery', money: 12, traits: ['timide'], skills: { artisanat: 16 } },
  { id: 'mathilde', first: 'Mathilde', last: 'Ancelin', age: 45, sex: 'F', prof: 'aubergiste', home: 'tavern', job: 'b_tavern', money: 130, traits: ['sociable', 'ambitieux'], skills: { artisanat: 25, commerce: 30, diplomatie: 30, gestion: 20 }, attrs: { charisme: 7 } },
  { id: 'clement', first: 'Clément', last: 'Ancelin', age: 21, sex: 'M', prof: 'aubergiste', home: 'tavern', job: 'b_tavern', money: 25, traits: ['sociable', 'paresseux', 'bavard'], skills: { artisanat: 12, diplomatie: 15 } },
  { id: 'aldric', first: 'Aldric', last: 'Ferrand', age: 50, sex: 'M', prof: 'forgeron', home: 'forge', job: 'b_forge', money: 150, traits: ['honnete', 'colerique'], skills: { artisanat: 40, combat: 20 }, attrs: { force: 8 } },
  { id: 'guillaume', first: 'Guillaume', last: 'Tessier', age: 18, sex: 'M', prof: 'forgeron', home: 'houses_b', job: 'b_forge', money: 10, traits: ['travailleur', 'timide'], skills: { artisanat: 18 } },
  { id: 'bertrand', first: 'Bertrand', last: 'Lombard', age: 38, sex: 'M', prof: 'marchand', home: 'houses_b', job: 'b_market', money: 160, traits: ['avare', 'malhonnete', 'ambitieux'], skills: { commerce: 40, diplomatie: 22, gestion: 25 }, attrs: { intelligence: 7, charisme: 6 } },
  { id: 'isabeau', first: 'Isabeau', last: 'Merle', age: 28, sex: 'F', prof: 'sans_emploi', home: 'houses_a', money: 18, traits: ['ambitieux', 'honnete'], skills: { artisanat: 14, agriculture: 12, commerce: 10 } },
  { id: 'raoul', first: 'Raoul', last: 'Cassegrain', age: 35, sex: 'M', prof: 'sans_emploi', home: 'houses_a', money: 6, traits: ['malhonnete', 'colerique', 'rancunier'], skills: { combat: 22, discretion: 25 } },
  { id: 'ermengarde', first: 'Ermengarde', last: 'Vasseur', age: 68, sex: 'F', prof: 'sans_emploi', home: 'houses_b', money: 90, traits: ['genereux', 'sociable', 'bavard'], skills: { diplomatie: 30, agriculture: 20 } },
];

const ALL_SKILLS: SkillId[] = ['agriculture', 'artisanat', 'commerce', 'combat', 'diplomatie', 'discretion', 'gestion', 'commandement'];
const ALL_ATTRS: AttrId[] = ['force', 'endurance', 'agilite', 'intelligence', 'charisme', 'perception', 'volonte'];

export function emptyState(seed: number): GameState {
  return {
    version: SAVE_VERSION, seed, rng: seed | 0, time: 0, processedHours: absoluteHour(0),
    locations: {}, locationOrder: [], characters: {}, characterOrder: [], businesses: {}, businessOrder: [],
    events: [], eventSeq: 0, idSeq: 100, playerId: 'player',
    settlements: {}, settlementOrder: [], roads: [], caravans: [], properties: [], priceBook: {}, festivals: [], tradeMemory: {},
    orgs: {}, orgOrder: [], wars: [], wanted: [],
    ledger: { produced: {}, consumed: {}, externalMoneyIn: 0, externalMoneyOut: 0, externalItemsIn: {}, removedItems: {} },
    history: [], stats: { ticks: 0, trades: 0, npcActions: 0 },
    loans: [], contracts: [], orders: [],
  };
}

export function createWorld(seed: number): GameState {
  const state = emptyState(seed);
  state.settlements.valcendre = valcendreSettlement(55, 0.05);
  state.settlementOrder.push('valcendre');
  for (const l of LOCATIONS) { state.locations[l.id] = { ...l, settlementId: 'valcendre' }; state.locationOrder.push(l.id); }
  for (const s of NPCS) addNpc(state, s);

  // Le joueur : adulte au profil équilibré, sans le sou.
  const player: Character = {
    id: 'player', firstName: 'Aymeric', lastName: 'de Nulle-Part', age: 24, sex: 'M', isPlayer: true, alive: true,
    profession: 'journalier', homeId: 'square', locationId: 'square', money: 0, inventory: { bread: 1 },
    health: 100, sick: 0, needs: { hunger: 35, energy: 85, social: 50 },
    attributes: { force: 5, endurance: 5, agilite: 5, intelligence: 5, charisme: 5, perception: 5, volonte: 5 },
    skills: { agriculture: 10, artisanat: 8, commerce: 8, combat: 10, diplomatie: 10, discretion: 8, gestion: 5, commandement: 2 },
    skillXp: {}, traits: [], goal: { kind: 'survivre' }, relations: {}, knownEvents: [],
    activity: { kind: 'idle', locationId: 'square', since: 0, note: 'Arrive au village' },
    unpaidWages: 0, hoursWorkedToday: 0, lastMealTime: 0, forageProgress: 0,
    ambition: { kind: 'vie_paisible', since: 0 },
  };
  state.characters.player = player;
  state.characterOrder.push('player');

  for (const s of BUSINESSES) addBusiness(state, s);
  attachEmployees(state, NPCS);

  // Liens préexistants : familles et inimitiés
  const bond = (a: string, b: string, aff: number, tr: number) => { modifyRelation(state, a, b, aff, tr); modifyRelation(state, b, a, aff, tr); };
  bond('gautier', 'martin', 45, 40);          // père et fils
  bond('perrine', 'jehan', 50, 45);           // mère et fils
  bond('mathilde', 'clement', 40, 30);        // tante et neveu
  bond('aldric', 'guillaume', 20, 25);        // maître et apprenti
  bond('thibault', 'raoul', -30, -25);        // vieille rancune
  bond('bertrand', 'aldric', -15, -20);       // le forgeron soupçonne le marchand de tricher
  bond('agnes', 'perrine', 30, 25);
  bond('ermengarde', 'isabeau', 35, 30);
  bond('colin', 'raoul', 25, 10);
  bond('odon', 'bastien', 15, 30);

  // Une vieille dette : Gautier a emprunté au marchand pour ses semences de l'an passé
  state.loans.push({
    id: 'l1', lenderId: 'bertrand', borrowerId: 'gautier', principal: 100, totalDue: 140, remaining: 140, installment: 35,
    weeklyRate: 0.1, createdDay: -21, nextDueDay: 7, finalDueDay: 28, missed: 0, status: 'active', purpose: 'pour ses semences',
  });

  addRegion(state);
  addPower(state);
  finalizeRelations(state);
  recordPrices(state, 'valcendre'); // le joueur connaît les prix de son village de départ
  for (const id of state.characterOrder) {
    const c = state.characters[id];
    if (!c.isPlayer) c.ambition = initialAmbition(state, c);
  }
  return state;
}

export function valcendreSettlement(infrastructure: number, taxRate: number): Settlement {
  return {
    id: 'valcendre', name: 'Valcendre', kind: 'village', x: 500, y: 330, squareId: 'square', manorId: 'b_manor', stewardId: 'odon',
    taxRate, infrastructure, yields: {}, specialty: 'Village de carrefour : bois, un peu de fer, un peu de grain.',
    prosperity: 50, popCap: 19, history: [], lordHouseId: 'h_delaval', unrest: 20, unrestWeeks: 0,
  };
}

export function addNpc(state: GameState, s: NpcSpec): Character {
  const attributes = {} as Record<AttrId, number>;
  for (const a of ALL_ATTRS) attributes[a] = s.attrs?.[a] ?? randInt(state, 3, 6);
  const skills = {} as Record<SkillId, number>;
  for (const k of ALL_SKILLS) skills[k] = s.skills[k] ?? randInt(state, 0, 8);
  const c: Character = {
    id: s.id, firstName: s.first, lastName: s.last, age: s.age, sex: s.sex, isPlayer: false, alive: true,
    profession: s.prof, homeId: s.home, employerId: s.job, locationId: s.home, money: s.money,
    inventory: { bread: randInt(state, 1, 3) }, health: s.age > 60 ? 70 : randInt(state, 82, 100), sick: 0,
    needs: { hunger: randInt(state, 10, 35), energy: randInt(state, 70, 95), social: randInt(state, 40, 80) },
    attributes, skills, skillXp: {}, traits: s.traits.slice(),
    goal: s.job ? { kind: s.prof === 'garde' ? 'servir' : 'prosperer' } : { kind: 'trouver_emploi' },
    relations: {}, knownEvents: [],
    activity: { kind: 'sleep', locationId: s.home, since: 0, note: 'Dort chez soi' },
    unpaidWages: 0, hoursWorkedToday: 0, lastMealTime: 0, forageProgress: 0,
    ambition: { kind: 'vie_paisible', since: 0 },
  };
  state.characters[c.id] = c;
  state.characterOrder.push(c.id);
  return c;
}

export function addBusiness(state: GameState, s: BizSpec): Business {
  const b: Business = {
    id: s.id, name: s.name, kind: s.kind, locationId: s.loc, ownerId: s.owner, treasury: s.treasury,
    stock: { ...s.stock }, laborPool: 0, toolWear: 0, maxWorkers: s.maxWorkers, wage: s.wage, employees: [],
    openFrom: s.open[0], openTo: s.open[1], sells: s.sells.slice(), buys: s.buys.slice(), targets: { ...s.targets },
    produced: {}, daysInDeficit: 0, lastTreasury: s.treasury, lastStaffChangeDay: -99, lastShortageDay: {},
  };
  state.businesses[b.id] = b;
  state.businessOrder.push(b.id);
  return b;
}

function attachEmployees(state: GameState, specs: NpcSpec[]): void {
  for (const s of specs) {
    if (!s.job) continue;
    const b = state.businesses[s.job];
    if (b.ownerId !== s.id) b.employees.push(s.id);
  }
}

function finalizeRelations(state: GameState): void {
  // les valeurs initiales ne comptent pas comme interactions
  for (const id of state.characterOrder) for (const r of Object.values(state.characters[id].relations)) r.lastInteraction = -1;
}

// ── Région (phase 3) ─────────────────────────────────────────

const MARKET_ITEMS: ItemId[] = ['bread', 'grain', 'wood', 'iron', 'tools'];

interface SettlementSpec {
  settlement: Omit<Settlement, 'history' | 'prosperity' | 'lordHouseId' | 'unrest' | 'unrestWeeks'>;
  locations: Omit<Location, 'settlementId'>[];
  businesses: BizSpec[];
  npcs: NpcSpec[];
  bonds: [string, string, number, number][];
}

const SAINT_AUBIN: SettlementSpec = {
  settlement: {
    id: 'staubin', name: 'Saint-Aubin-sur-Loue', kind: 'bourg', x: 190, y: 440, squareId: 'sa_square', manorId: 'sa_b_manor', stewardId: 'renier',
    taxRate: 0.05, infrastructure: 60, yields: { farm: 1.5, woodlot: 0.6 }, popCap: 16,
    specialty: 'Bourg agricole au bord de la Loue : terres grasses et grain abondant, mais ni fer ni forge.',
  },
  locations: [
    { id: 'sa_square', name: 'Quai Saint-Aubin', kind: 'square', x: 520, y: 340, description: 'Un quai de pierre où accostent les barques chargées de sacs de grain.' },
    { id: 'sa_market', name: 'Halle aux Grains', kind: 'market', x: 660, y: 290, description: 'Une halle sonore où se négocient les boisseaux au poids.' },
    { id: 'sa_tavern', name: 'Auberge de la Loue', kind: 'tavern', x: 390, y: 230, description: 'Bateliers et laboureurs y parlent du niveau de l’eau et du prix du blé.' },
    { id: 'sa_bakery', name: 'Moulin-Fournil', kind: 'bakery', x: 610, y: 460, description: 'Le moulin à eau tourne à côté du four : la farine ne voyage pas loin.' },
    { id: 'sa_farm', name: 'Grand Domaine des Prés', kind: 'farm', x: 210, y: 480, description: 'Des arpents de blé à perte de vue, sur les alluvions de la rivière.' },
    { id: 'sa_farm2', name: 'Ferme du Gué', kind: 'farm', x: 250, y: 170, description: 'Une ferme modeste près du gué, tenue par une veuve tenace.' },
    { id: 'sa_woods', name: 'Saulaie', kind: 'woodlot', x: 110, y: 320, description: 'Des saules et des peupliers : un bois tendre, vite brûlé.' },
    { id: 'sa_manor', name: 'Prévôté', kind: 'manor', x: 770, y: 150, description: 'Le prévôt y tient les rôles de l’impôt et la petite garde du port.' },
    { id: 'sa_houses', name: 'Faubourg du Port', kind: 'houses', x: 800, y: 440, description: 'Des maisons basses où logent bateliers et journaliers.' },
  ],
  businesses: [
    { id: 'sa_b_farm', name: 'Grand Domaine des Prés', kind: 'farm', loc: 'sa_farm', owner: 'hugo', treasury: 320, stock: { grain: 110, tools: 2 }, maxWorkers: 4, wage: 4, open: [6, 18], sells: ['grain'], buys: ['tools'], targets: { grain: 80, tools: 2 } },
    { id: 'sa_b_farm2', name: 'Ferme du Gué', kind: 'farm', loc: 'sa_farm2', owner: 'berthe', treasury: 150, stock: { grain: 40, tools: 1 }, maxWorkers: 2, wage: 4, open: [6, 18], sells: ['grain'], buys: ['tools'], targets: { grain: 40, tools: 1 } },
    { id: 'sa_b_wood', name: 'Saulaie', kind: 'woodlot', loc: 'sa_woods', owner: 'lucas', treasury: 110, stock: { wood: 15, tools: 1 }, maxWorkers: 2, wage: 4, open: [7, 17], sells: ['wood'], buys: ['tools'], targets: { wood: 20, tools: 1 } },
    { id: 'sa_b_bakery', name: 'Moulin-Fournil', kind: 'bakery', loc: 'sa_bakery', owner: 'amaury', treasury: 220, stock: { bread: 30, grain: 16, wood: 6 }, maxWorkers: 2, wage: 5, open: [6, 19], sells: ['bread'], buys: ['grain', 'wood'], targets: { bread: 30, grain: 16, wood: 8 } },
    { id: 'sa_b_tavern', name: 'Auberge de la Loue', kind: 'tavern', loc: 'sa_tavern', owner: 'jacquette', treasury: 200, stock: { ale: 25, grain: 8, bread: 6 }, maxWorkers: 1, wage: 4, open: [10, 23], sells: ['ale', 'bread'], buys: ['grain', 'bread'], targets: { ale: 20, grain: 8, bread: 6 } },
    { id: 'sa_b_market', name: 'Halle aux Grains', kind: 'market', loc: 'sa_market', owner: 'gilles', treasury: 320, stock: { grain: 30, bread: 6, wood: 4, tools: 1 }, maxWorkers: 0, wage: 4, open: [7, 19], sells: MARKET_ITEMS, buys: MARKET_ITEMS, targets: { bread: 10, grain: 20, wood: 6, iron: 2, tools: 2 } },
    { id: 'sa_b_manor', name: 'Prévôté de Saint-Aubin', kind: 'manor', loc: 'sa_manor', owner: null, treasury: 900, stock: {}, maxWorkers: 4, wage: 3, open: [8, 20], sells: [], buys: [], targets: {} },
  ],
  npcs: [
    { id: 'renier', first: 'Renier', last: 'Prévost', age: 49, sex: 'M', prof: 'intendant', home: 'sa_manor', job: 'sa_b_manor', money: 120, traits: ['honnete', 'prudent'], skills: { gestion: 35, diplomatie: 22 } },
    { id: 'thomas', first: 'Thomas', last: 'Lagarde', age: 29, sex: 'M', prof: 'garde', home: 'sa_houses', job: 'sa_b_manor', money: 40, traits: ['loyal', 'timide'], skills: { combat: 30 }, attrs: { perception: 6 } },
    { id: 'hugo', first: 'Hugo', last: 'Daubenton', age: 51, sex: 'M', prof: 'fermier', home: 'sa_farm', job: 'sa_b_farm', money: 140, traits: ['travailleur', 'ambitieux'], skills: { agriculture: 45, gestion: 25, commerce: 15 } },
    { id: 'pernelle', first: 'Pernelle', last: 'Daubenton', age: 24, sex: 'F', prof: 'fermier', home: 'sa_farm', job: 'sa_b_farm', money: 25, traits: ['sociable', 'loyal'], skills: { agriculture: 24 } },
    { id: 'gauvain', first: 'Gauvain', last: 'Mercier', age: 30, sex: 'M', prof: 'fermier', home: 'sa_houses', job: 'sa_b_farm', money: 20, traits: ['paresseux', 'bavard'], skills: { agriculture: 20 } },
    { id: 'berthe', first: 'Berthe', last: 'Dugué', age: 57, sex: 'F', prof: 'fermier', home: 'sa_farm2', job: 'sa_b_farm2', money: 70, traits: ['travailleur', 'rancunier'], skills: { agriculture: 38, gestion: 20 } },
    { id: 'oda', first: 'Oda', last: 'Ferrière', age: 22, sex: 'F', prof: 'fermier', home: 'sa_houses', job: 'sa_b_farm2', money: 15, traits: ['honnete', 'timide'], skills: { agriculture: 18 } },
    { id: 'lucas', first: 'Lucas', last: 'Saulnier', age: 36, sex: 'M', prof: 'bucheron', home: 'sa_houses', job: 'sa_b_wood', money: 55, traits: ['travailleur'], skills: { agriculture: 26 }, attrs: { force: 7 } },
    { id: 'amaury', first: 'Amaury', last: 'Meunier', age: 44, sex: 'M', prof: 'boulanger', home: 'sa_bakery', job: 'sa_b_bakery', money: 110, traits: ['avare', 'travailleur'], skills: { artisanat: 36, gestion: 20 } },
    { id: 'mahaut', first: 'Mahaut', last: 'Meunier', age: 40, sex: 'F', prof: 'boulanger', home: 'sa_bakery', job: 'sa_b_bakery', money: 30, traits: ['genereux', 'sociable'], skills: { artisanat: 28 } },
    { id: 'jacquette', first: 'Jacquette', last: 'Rivière', age: 38, sex: 'F', prof: 'aubergiste', home: 'sa_tavern', job: 'sa_b_tavern', money: 100, traits: ['sociable', 'bavard'], skills: { artisanat: 22, commerce: 25, diplomatie: 30 }, attrs: { charisme: 7 } },
    { id: 'gilles', first: 'Gilles', last: 'Marchais', age: 42, sex: 'M', prof: 'marchand', home: 'sa_houses', job: 'sa_b_market', money: 200, traits: ['ambitieux', 'honnete'], skills: { commerce: 42, diplomatie: 28, gestion: 25 }, attrs: { intelligence: 7 } },
    { id: 'denis', first: 'Denis', last: 'Batelier', age: 33, sex: 'M', prof: 'sans_emploi', home: 'sa_houses', money: 12, traits: ['malhonnete', 'sociable'], skills: { agriculture: 15, discretion: 18 } },
  ],
  bonds: [['hugo', 'pernelle', 45, 40], ['amaury', 'mahaut', 40, 40], ['hugo', 'berthe', -20, -10], ['gilles', 'jacquette', 25, 20], ['denis', 'gauvain', 20, 5]],
};

const HAUTEPIERRE: SettlementSpec = {
  settlement: {
    id: 'hautepierre', name: 'Hautepierre', kind: 'bourg', x: 830, y: 170, squareId: 'hp_square', manorId: 'hp_b_manor', stewardId: 'aymon',
    taxRate: 0.06, infrastructure: 50, yields: { mine: 1.8, farm: 0.8 }, popCap: 15,
    specialty: 'Bourg minier perché : filons de fer riches et grande forge, mais des terrasses pauvres en blé.',
  },
  locations: [
    { id: 'hp_square', name: 'Place de la Croix', kind: 'square', x: 480, y: 360, description: 'Une place en pente autour d’une croix de granit, battue par le vent.' },
    { id: 'hp_market', name: 'Comptoir des Mines', kind: 'market', x: 610, y: 300, description: 'On y pèse le fer au lingot et le grain au compte-gouttes.' },
    { id: 'hp_tavern', name: 'Taverne du Pic', kind: 'tavern', x: 350, y: 270, description: 'Les mineurs y lavent la poussière avec une bière épaisse.' },
    { id: 'hp_bakery', name: 'Four de la Côte', kind: 'bakery', x: 570, y: 470, description: 'Un four communal qui manque souvent de farine.' },
    { id: 'hp_forge', name: 'Grande Forge', kind: 'forge', x: 320, y: 450, description: 'Trois foyers, deux enclumes : les meilleurs outils de la région.' },
    { id: 'hp_mine', name: 'Mines de Hautepierre', kind: 'mine', x: 830, y: 190, description: 'Des galeries étayées qui suivent un filon d’un rouge sombre.' },
    { id: 'hp_woods', name: 'Forêt des Crêtes', kind: 'woodlot', x: 150, y: 150, description: 'Des sapins noirs accrochés à la pente.' },
    { id: 'hp_farm', name: 'Terrasses', kind: 'farm', x: 190, y: 480, description: 'Des murets de pierre retiennent une terre maigre.' },
    { id: 'hp_manor', name: 'Château-Bas', kind: 'manor', x: 700, y: 110, description: 'Une tour trapue où siège l’intendant du seigneur des mines.' },
    { id: 'hp_houses', name: 'Les Corons', kind: 'houses', x: 780, y: 440, description: 'Des maisons de pierre serrées les unes contre les autres.' },
  ],
  businesses: [
    { id: 'hp_b_mine', name: 'Mines de Hautepierre', kind: 'mine', loc: 'hp_mine', owner: 'eudes', treasury: 380, stock: { iron: 24, tools: 3 }, maxWorkers: 4, wage: 5, open: [7, 17], sells: ['iron'], buys: ['tools'], targets: { iron: 25, tools: 2 } },
    { id: 'hp_b_forge', name: 'Grande Forge', kind: 'forge', loc: 'hp_forge', owner: 'yolande', treasury: 300, stock: { tools: 8, iron: 10, wood: 6 }, maxWorkers: 2, wage: 5, open: [7, 18], sells: ['tools'], buys: ['iron', 'wood'], targets: { tools: 8, iron: 10, wood: 6 } },
    { id: 'hp_b_wood', name: 'Forêt des Crêtes', kind: 'woodlot', loc: 'hp_woods', owner: 'achard', treasury: 130, stock: { wood: 20, tools: 2 }, maxWorkers: 2, wage: 4, open: [7, 17], sells: ['wood'], buys: ['tools'], targets: { wood: 22, tools: 1 } },
    { id: 'hp_b_farm', name: 'Terrasses', kind: 'farm', loc: 'hp_farm', owner: 'ide', treasury: 120, stock: { grain: 40, tools: 2 }, maxWorkers: 3, wage: 4, open: [6, 18], sells: ['grain'], buys: ['tools'], targets: { grain: 40, tools: 2 } },
    { id: 'hp_b_bakery', name: 'Four de la Côte', kind: 'bakery', loc: 'hp_bakery', owner: 'sanche', treasury: 200, stock: { bread: 25, grain: 14, wood: 6 }, maxWorkers: 2, wage: 5, open: [6, 19], sells: ['bread'], buys: ['grain', 'wood'], targets: { bread: 30, grain: 16, wood: 8 } },
    { id: 'hp_b_tavern', name: 'Taverne du Pic', kind: 'tavern', loc: 'hp_tavern', owner: 'berengere', treasury: 210, stock: { ale: 25, grain: 6, bread: 6 }, maxWorkers: 1, wage: 4, open: [10, 23], sells: ['ale', 'bread'], buys: ['grain', 'bread'], targets: { ale: 20, grain: 6, bread: 6 } },
    { id: 'hp_b_market', name: 'Comptoir des Mines', kind: 'market', loc: 'hp_market', owner: 'gontran', treasury: 340, stock: { grain: 40, iron: 8, tools: 3, bread: 4 }, maxWorkers: 0, wage: 4, open: [7, 19], sells: MARKET_ITEMS, buys: MARKET_ITEMS, targets: { bread: 10, grain: 20, wood: 6, iron: 6, tools: 3 } },
    { id: 'hp_b_manor', name: 'Intendance de Hautepierre', kind: 'manor', loc: 'hp_manor', owner: null, treasury: 1000, stock: {}, maxWorkers: 4, wage: 3, open: [8, 20], sells: [], buys: [], targets: {} },
  ],
  npcs: [
    { id: 'aymon', first: 'Aymon', last: 'de Roche', age: 55, sex: 'M', prof: 'intendant', home: 'hp_manor', job: 'hp_b_manor', money: 160, traits: ['avare', 'rancunier'], skills: { gestion: 40, commandement: 20 } },
    { id: 'garin', first: 'Garin', last: 'Lescot', age: 33, sex: 'M', prof: 'garde', home: 'hp_houses', job: 'hp_b_manor', money: 45, traits: ['colerique', 'loyal'], skills: { combat: 38 }, attrs: { force: 7, perception: 6 } },
    { id: 'eudes', first: 'Eudes', last: 'Ferrat', age: 48, sex: 'M', prof: 'mineur', home: 'hp_houses', job: 'hp_b_mine', money: 150, traits: ['ambitieux', 'avare'], skills: { agriculture: 30, gestion: 30 }, attrs: { force: 7 } },
    { id: 'jacquot', first: 'Jacquot', last: 'Puits', age: 27, sex: 'M', prof: 'mineur', home: 'hp_houses', job: 'hp_b_mine', money: 20, traits: ['travailleur', 'sociable'], skills: { agriculture: 22 }, attrs: { force: 7, endurance: 7 } },
    { id: 'pons', first: 'Pons', last: 'Galerie', age: 35, sex: 'M', prof: 'mineur', home: 'hp_houses', job: 'hp_b_mine', money: 25, traits: ['colerique', 'bavard'], skills: { agriculture: 25 }, attrs: { force: 8 } },
    { id: 'tiphaine', first: 'Tiphaine', last: 'Puits', age: 25, sex: 'F', prof: 'mineur', home: 'hp_houses', job: 'hp_b_mine', money: 18, traits: ['travailleur', 'loyal'], skills: { agriculture: 20 }, attrs: { endurance: 7 } },
    { id: 'yolande', first: 'Yolande', last: 'Marteau', age: 46, sex: 'F', prof: 'forgeron', home: 'hp_forge', job: 'hp_b_forge', money: 170, traits: ['honnete', 'travailleur'], skills: { artisanat: 48, gestion: 22 }, attrs: { force: 7 } },
    { id: 'evrard', first: 'Évrard', last: 'Marteau', age: 20, sex: 'M', prof: 'forgeron', home: 'hp_forge', job: 'hp_b_forge', money: 15, traits: ['timide', 'loyal'], skills: { artisanat: 24 } },
    { id: 'achard', first: 'Achard', last: 'Sapinière', age: 41, sex: 'M', prof: 'bucheron', home: 'hp_houses', job: 'hp_b_wood', money: 60, traits: ['prudent'], skills: { agriculture: 28 }, attrs: { force: 7 } },
    { id: 'ide', first: 'Ide', last: 'Murets', age: 52, sex: 'F', prof: 'fermier', home: 'hp_farm', job: 'hp_b_farm', money: 50, traits: ['travailleur', 'genereux'], skills: { agriculture: 34 } },
    { id: 'sanche', first: 'Sanche', last: 'Fournel', age: 39, sex: 'M', prof: 'boulanger', home: 'hp_bakery', job: 'hp_b_bakery', money: 90, traits: ['sociable'], skills: { artisanat: 33 } },
    { id: 'berengere', first: 'Bérengère', last: 'Duval', age: 43, sex: 'F', prof: 'aubergiste', home: 'hp_tavern', job: 'hp_b_tavern', money: 110, traits: ['sociable', 'genereux'], skills: { artisanat: 24, commerce: 22, diplomatie: 28 } },
    { id: 'gontran', first: 'Gontran', last: 'Durand', age: 45, sex: 'M', prof: 'marchand', home: 'hp_houses', job: 'hp_b_market', money: 220, traits: ['avare', 'ambitieux'], skills: { commerce: 45, gestion: 28, diplomatie: 18 }, attrs: { intelligence: 7 } },
    { id: 'gerbert', first: 'Gerbert', last: 'Cailloux', age: 31, sex: 'M', prof: 'sans_emploi', home: 'hp_houses', money: 10, traits: ['paresseux', 'malhonnete'], skills: { agriculture: 16, discretion: 22 } },
  ],
  bonds: [['yolande', 'evrard', 45, 45], ['jacquot', 'tiphaine', 40, 40], ['eudes', 'pons', -25, -20], ['gontran', 'yolande', 15, 10], ['aymon', 'garin', 15, 30]],
};

/** Ajoute les deux bourgs, les routes et les logements (aussi utilisé pour migrer une sauvegarde v2). */
export function addRegion(state: GameState): void {
  for (const spec of [SAINT_AUBIN, HAUTEPIERRE]) {
    if (state.settlements[spec.settlement.id]) continue;
    state.settlements[spec.settlement.id] = { ...spec.settlement, prosperity: 50, history: [], lordHouseId: spec.settlement.id === 'hautepierre' ? 'h_roche' : 'h_delaval', unrest: 20, unrestWeeks: 0 };
    state.settlementOrder.push(spec.settlement.id);
    for (const l of spec.locations) { state.locations[l.id] = { ...l, settlementId: spec.settlement.id }; state.locationOrder.push(l.id); }
    for (const n of spec.npcs) addNpc(state, n);
    for (const b of spec.businesses) addBusiness(state, b);
    attachEmployees(state, spec.npcs);
    for (const [a, b, aff, tr] of spec.bonds) { modifyRelation(state, a, b, aff, tr); modifyRelation(state, b, a, aff, tr); }
    for (const n of spec.npcs) state.characters[n.id].ambition = initialAmbition(state, state.characters[n.id]);
  }
  const road = (id: string, name: string, a: string, b: string, hours: number) => {
    if (state.locations[id]) return;
    state.locations[id] = { id, name, kind: 'road', settlementId: 'road', x: 0, y: 0, description: `La route entre ${state.settlements[a].name} et ${state.settlements[b].name}.` };
    state.locationOrder.push(id);
    state.roads.push({ a, b, hours, locationId: id });
  };
  road('road_v_sa', 'Chemin de la Loue', 'valcendre', 'staubin', 5);
  road('road_v_hp', 'Route des Crêtes', 'valcendre', 'hautepierre', 7);
  if (!state.properties.length) state.properties.push(...PROPERTIES.map(p => ({ ...p, storage: {} })));
}

const PROPERTIES: Omit<Property, 'storage'>[] = [
  { id: 'pr_v_room', settlementId: 'valcendre', locationId: 'tavern', name: 'Chambre sous les combles', price: 0, weeklyRent: 14, ownerId: 'mathilde', storageCap: 30 },
  { id: 'pr_v_cottage', settlementId: 'valcendre', locationId: 'houses_a', name: 'Chaumière du Ruisseau', price: 260, weeklyRent: 18, ownerId: null, storageCap: 80 },
  { id: 'pr_v_house', settlementId: 'valcendre', locationId: 'houses_b', name: 'Maison à colombages', price: 420, weeklyRent: 28, ownerId: null, storageCap: 140 },
  { id: 'pr_sa_room', settlementId: 'staubin', locationId: 'sa_tavern', name: 'Chambre du Port', price: 0, weeklyRent: 12, ownerId: 'jacquette', storageCap: 30 },
  { id: 'pr_sa_house', settlementId: 'staubin', locationId: 'sa_houses', name: 'Maison du Faubourg', price: 300, weeklyRent: 20, ownerId: null, storageCap: 110 },
  { id: 'pr_hp_room', settlementId: 'hautepierre', locationId: 'hp_tavern', name: 'Chambre de la Taverne', price: 0, weeklyRent: 15, ownerId: 'berengere', storageCap: 30 },
  { id: 'pr_hp_coron', settlementId: 'hautepierre', locationId: 'hp_houses', name: 'Coron n° 7', price: 220, weeklyRent: 16, ownerId: null, storageCap: 90 },
];

// ── Pouvoir (phase 4) ────────────────────────────────────────

const POWER_NPCS: NpcSpec[] = [
  { id: 'guerin', first: 'Guérin', last: 'Delaval', age: 58, sex: 'M', prof: 'seigneur', home: 'manor', money: 300, traits: ['prudent', 'honnete', 'avare'], skills: { gestion: 45, commandement: 40, combat: 30, diplomatie: 30 }, attrs: { volonte: 7 } },
  { id: 'gaucher', first: 'Gaucher', last: 'Delaval', age: 27, sex: 'M', prof: 'seigneur', home: 'manor', money: 140, traits: ['ambitieux', 'malhonnete', 'rancunier'], skills: { combat: 32, commandement: 20, diplomatie: 18 }, attrs: { force: 6, charisme: 6 } },
  { id: 'alienor', first: 'Aliénor', last: 'de Roche', age: 49, sex: 'F', prof: 'seigneur', home: 'hp_manor', money: 280, traits: ['ambitieux', 'colerique'], skills: { gestion: 40, commandement: 45, diplomatie: 25 }, attrs: { volonte: 8, intelligence: 7 } },
  { id: 'berald', first: 'Bérald', last: 'de Roche', age: 22, sex: 'M', prof: 'seigneur', home: 'hp_manor', money: 90, traits: ['honnete', 'loyal'], skills: { combat: 36, commandement: 15 }, attrs: { force: 7 } },
];

function org(id: string, name: string, kind: Organization['kind'], seatId: string, leaderId: string, members: [string, OrgRole][], treasury: number, extra: Partial<Organization> = {}): Organization {
  return {
    id, name, kind, leaderId, members: members.map(m => m[0]), roles: Object.fromEntries(members), treasury, stash: {}, seatId,
    founded: 0, relations: {}, heat: 0, dues: 0, patrolRoads: [], service: {}, ...extra,
  };
}

/** Maisons nobles, guilde des marchands et bande des Loups (aussi utilisé pour migrer une sauvegarde v3). */
export function addPower(state: GameState, migrating = false): void {
  if (state.orgOrder?.length) return;
  state.orgs = {}; state.orgOrder = []; state.wars = []; state.wanted = [];
  for (const n of POWER_NPCS) if (!state.characters[n.id]) { addNpc(state, n); state.characters[n.id].ambition = initialAmbition(state, state.characters[n.id]); }
  // Les fonds des nouvelles organisations viennent de l'extérieur du pays (trésor seigneurial) : comptabilisés
  const add = (o: Organization) => { state.orgs[o.id] = o; state.orgOrder.push(o.id); if (migrating) state.ledger.externalMoneyIn += o.treasury; };
  if (migrating) for (const n of POWER_NPCS) state.ledger.externalMoneyIn += n.money;
  add(org('h_delaval', 'Maison Delaval', 'house', 'valcendre', 'guerin',
    [['guerin', 'seigneur'], ['gaucher', 'heritier'], ['odon', 'vassal'], ['renier', 'vassal'], ['bastien', 'soldat'], ['hugues', 'soldat'], ['thomas', 'soldat']], 400));
  add(org('h_roche', 'Maison de Roche', 'house', 'hautepierre', 'alienor',
    [['alienor', 'seigneur'], ['berald', 'heritier'], ['aymon', 'vassal'], ['garin', 'soldat']], 500));
  add(org('g_marchands', 'Guilde des marchands de la Loue', 'guild', 'staubin', 'gilles',
    [['gilles', 'chef'], ['bertrand', 'membre'], ['gontran', 'membre']], 60, { dues: 5 }));
  add(org('b_loups', 'Les Loups de la Combe', 'gang', 'valcendre', 'raoul',
    [['raoul', 'chef'], ['colin', 'membre'], ['gerbert', 'membre'], ['denis', 'membre']], 20, { hideoutId: 'woodlot' }));
  state.orgs.h_delaval.relations.h_roche = -40;
  state.orgs.h_roche.relations.h_delaval = -40;
  for (const id of state.settlementOrder) {
    const st = state.settlements[id];
    st.lordHouseId ??= id === 'hautepierre' ? 'h_roche' : 'h_delaval';
    st.unrest ??= 20; st.unrestWeeks ??= 0;
  }
  const bond = (a: string, b: string, aff: number, tr: number) => { modifyRelation(state, a, b, aff, tr); modifyRelation(state, b, a, aff, tr); };
  bond('guerin', 'gaucher', 5, -10);      // un père méfiant, un fils impatient
  bond('guerin', 'odon', 30, 35);
  bond('alienor', 'berald', 45, 40);
  bond('alienor', 'aymon', 20, 30);
  bond('gaucher', 'raoul', 10, 5);        // de vieilles connaissances peu recommandables
  bond('raoul', 'colin', 25, 15);
  for (const id of state.characterOrder) for (const r of Object.values(state.characters[id].relations)) if (r.lastInteraction === undefined) r.lastInteraction = -1;
}

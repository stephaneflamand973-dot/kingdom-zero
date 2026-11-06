// Génération du monde initial : le village de Valcendre.
// La composition est fixe (pour des tests stables) ; les détails varient avec la graine.
import type { AttrId, Business, BusinessKind, Character, GameState, Inventory, ItemId, Location, ProfessionId, SkillId, TraitId } from './types';
import { randInt } from './rng';
import { absoluteHour } from './sim';
import { modifyRelation } from './social';
import { initialAmbition } from './society';

export const SAVE_VERSION = 2;

const LOCATIONS: Location[] = [
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

interface BizSpec {
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

interface NpcSpec {
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

export function createWorld(seed: number): GameState {
  const state: GameState = {
    version: SAVE_VERSION, seed, rng: seed | 0, time: 0, processedHours: absoluteHour(0),
    locations: {}, locationOrder: [], characters: {}, characterOrder: [], businesses: {}, businessOrder: [],
    events: [], eventSeq: 0, idSeq: 100, playerId: 'player',
    village: { name: 'Valcendre', taxRate: 0.05, manorId: 'b_manor', infrastructure: 55 },
    ledger: { produced: {}, consumed: {}, externalMoneyIn: 0, externalMoneyOut: 0, externalItemsIn: {}, removedItems: {} },
    history: [], stats: { ticks: 0, trades: 0, npcActions: 0 },
    loans: [], contracts: [], orders: [],
  };
  for (const l of LOCATIONS) { state.locations[l.id] = { ...l }; state.locationOrder.push(l.id); }

  for (const s of NPCS) {
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
  }

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

  for (const s of BUSINESSES) {
    const b: Business = {
      id: s.id, name: s.name, kind: s.kind, locationId: s.loc, ownerId: s.owner, treasury: s.treasury,
      stock: { ...s.stock }, laborPool: 0, toolWear: 0, maxWorkers: s.maxWorkers, wage: s.wage, employees: [],
      openFrom: s.open[0], openTo: s.open[1], sells: s.sells.slice(), buys: s.buys.slice(), targets: { ...s.targets },
      produced: {}, daysInDeficit: 0, lastTreasury: s.treasury, lastStaffChangeDay: -99, lastShortageDay: {},
    };
    state.businesses[b.id] = b;
    state.businessOrder.push(b.id);
  }
  // Employés (hors propriétaires)
  for (const s of NPCS) {
    if (!s.job) continue;
    const b = state.businesses[s.job];
    if (b.ownerId !== s.id) b.employees.push(s.id);
  }

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
  for (const id of state.characterOrder) state.characters[id].relations = { ...state.characters[id].relations };
  // les valeurs initiales ne comptent pas comme interactions
  for (const id of state.characterOrder) for (const r of Object.values(state.characters[id].relations)) r.lastInteraction = -1;

  // Ambitions de long terme (phase 2)
  for (const id of state.characterOrder) {
    const c = state.characters[id];
    if (!c.isPlayer) c.ambition = initialAmbition(state, c);
  }
  // Une vieille dette : Gautier a emprunté au marchand pour ses semences de l'an passé
  state.loans.push({
    id: 'l1', lenderId: 'bertrand', borrowerId: 'gautier', principal: 100, totalDue: 140, remaining: 140, installment: 35,
    weeklyRate: 0.1, createdDay: -21, nextDueDay: 7, finalDueDay: 28, missed: 0, status: 'active', purpose: 'pour ses semences',
  });

  return state;
}

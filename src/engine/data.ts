// Données statiques de conception (tables de règles). Aucune logique d'état ici.
import type { BusinessKind, ItemId, Recipe, SkillId, AttrId, TraitId, ProfessionId } from './types';

export const ITEMS: Record<ItemId, { name: string; plural: string; one: string; base: number; food?: number }> = {
  grain: { name: 'boisseau de grain', one: 'un boisseau de grain', plural: 'boisseaux de grain', base: 9, food: 28 },
  bread: { name: 'miche de pain', one: 'une miche de pain', plural: 'miches de pain', base: 6, food: 38 },
  ale:   { name: 'chope de bière', one: 'une chope de bière', plural: 'chopes de bière', base: 5 },
  wood:  { name: 'fagot de bois', one: 'un fagot de bois', plural: 'fagots de bois', base: 4 },
  iron:  { name: 'lingot de fer', one: 'un lingot de fer', plural: 'lingots de fer', base: 14 },
  tools: { name: 'outil', one: 'un outil', plural: 'outils', base: 45 },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
/** Aliments par ordre de préférence (le grain se mange en bouillie). */
export const FOODS: ItemId[] = ['bread', 'grain'];

export const ITEM_ICON: Record<ItemId, string> = {
  grain: '🌾', bread: '🍞', ale: '🍺', wood: '🪵', iron: '⛓', tools: '⚒',
};

/** Usure : un outil est consommé toutes les N heures de travail outillé. */
export const TOOL_WEAR_PER_TOOL = 40;

export const RECIPES: Partial<Record<BusinessKind, Recipe>> = {
  farm:    { inputs: {}, outputs: { grain: 1 }, labor: 1.6, seasonal: true, usesTools: true },
  woodlot: { inputs: {}, outputs: { wood: 1 }, labor: 0.8, usesTools: true },
  mine:    { inputs: {}, outputs: { iron: 1 }, labor: 2.5, usesTools: true },
  bakery:  { inputs: { grain: 2, wood: 1 }, outputs: { bread: 10 }, labor: 3, usesTools: false },
  tavern:  { inputs: { grain: 2 }, outputs: { ale: 7 }, labor: 3, usesTools: false },
  forge:   { inputs: { iron: 2, wood: 1 }, outputs: { tools: 1 }, labor: 5, usesTools: false },
};

/** Compétence exercée (et améliorée) en travaillant dans chaque type d'établissement. */
export const WORK_SKILL: Record<BusinessKind, SkillId> = {
  farm: 'agriculture', woodlot: 'agriculture', mine: 'agriculture',
  bakery: 'artisanat', tavern: 'artisanat', forge: 'artisanat',
  market: 'commerce', manor: 'gestion',
};
/** Attribut physique ou mental sollicité. */
export const WORK_ATTR: Record<BusinessKind, AttrId> = {
  farm: 'endurance', woodlot: 'force', mine: 'force', bakery: 'endurance',
  tavern: 'charisme', forge: 'force', market: 'intelligence', manor: 'volonte',
};
/** Compétence minimale exigée d'un journalier (le joueur). */
export const MIN_SKILL_FOR_DAYWORK: Record<BusinessKind, number> = {
  farm: 0, woodlot: 0, mine: 0, bakery: 12, tavern: 5, forge: 22, market: 20, manor: 0,
};
/** Fatigue horaire du travail selon l'établissement (énergie perdue/h). */
export const WORK_ENERGY_COST: Record<BusinessKind, number> = {
  farm: 7, woodlot: 8, mine: 9, bakery: 6, tavern: 5, forge: 8, market: 4, manor: 6,
};

export const SKILL_NAMES: Record<SkillId, string> = {
  agriculture: 'Agriculture', artisanat: 'Artisanat', commerce: 'Commerce', combat: 'Combat',
  diplomatie: 'Diplomatie', discretion: 'Discrétion', gestion: 'Gestion', commandement: 'Commandement',
};
export const ATTR_NAMES: Record<AttrId, string> = {
  force: 'Force', endurance: 'Endurance', agilite: 'Agilité', intelligence: 'Intelligence',
  charisme: 'Charisme', perception: 'Perception', volonte: 'Volonté',
};
export const TRAIT_NAMES: Record<TraitId, string> = {
  travailleur: 'Travailleur', paresseux: 'Paresseux', avare: 'Avare', genereux: 'Généreux',
  colerique: 'Colérique', sociable: 'Sociable', timide: 'Timide', honnete: 'Honnête',
  malhonnete: 'Malhonnête', ambitieux: 'Ambitieux', rancunier: 'Rancunier', loyal: 'Loyal', bavard: 'Bavard', prudent: 'Prudent',
};
export const PROFESSION_NAMES: Record<ProfessionId, string> = {
  fermier: 'Fermier', bucheron: 'Bûcheron', mineur: 'Mineur', boulanger: 'Boulanger',
  aubergiste: 'Aubergiste', forgeron: 'Forgeron', marchand: 'Marchand', garde: 'Garde',
  intendant: 'Intendant', journalier: 'Journalier', sans_emploi: 'Sans emploi',
};
export const PROFESSION_BY_BUSINESS: Record<BusinessKind, ProfessionId> = {
  farm: 'fermier', woodlot: 'bucheron', mine: 'mineur', bakery: 'boulanger', tavern: 'aubergiste',
  forge: 'forgeron', market: 'marchand', manor: 'garde',
};

export const FIRST_NAMES_M = ['Arnaud', 'Baudouin', 'Enguerrand', 'Foulques', 'Gervais', 'Lambert', 'Mathieu', 'Rogier', 'Simon', 'Tristan', 'Yvain', 'Anselme'];
export const FIRST_NAMES_F = ['Aélis', 'Béatrix', 'Clémence', 'Douce', 'Églantine', 'Félicie', 'Héloïse', 'Jeanne', 'Margot', 'Ysolde', 'Sibylle', 'Alix'];
export const LAST_NAMES = ['Brisebois', 'Courtecuisse', 'Fournier', 'Garnier', 'Lemoine', 'Morel', 'Poitevin', 'Rousseau', 'Vasseur', 'Ferrand', 'Chauvin', 'Bréval'];

export const INITIAL_SKILL_CAP = 40; // aucun départ excellent partout

/** Poids d'une unité (pour la charge portée et les caravanes). */
export const WEIGHT: Record<ItemId, number> = { grain: 2, bread: 1, ale: 1, wood: 2, iron: 3, tools: 3 };
export const CARAVAN_CAPACITY = 90;
/** Coût de transport estimé par unité de poids et par heure de route (péages, fourrage, usure). */
export const TRANSPORT_COST = 0.04;

// ─────────────────────────────────────────────────────────────
// KINGDOM ZERO — Modèles de données du moteur
// Tout l'état du jeu est du JSON pur (aucune classe, aucune Map)
// afin d'être sérialisable, comparable et reproductible.
// ─────────────────────────────────────────────────────────────

export type ItemId = 'grain' | 'bread' | 'ale' | 'wood' | 'iron' | 'tools';
export type Inventory = Partial<Record<ItemId, number>>;

export type AttrId = 'force' | 'endurance' | 'agilite' | 'intelligence' | 'charisme' | 'perception' | 'volonte';
export type SkillId =
  | 'agriculture' | 'artisanat' | 'commerce' | 'combat'
  | 'diplomatie' | 'discretion' | 'gestion' | 'commandement';

export type TraitId =
  | 'travailleur' | 'paresseux' | 'avare' | 'genereux' | 'colerique'
  | 'sociable' | 'timide' | 'honnete' | 'malhonnete' | 'ambitieux'
  | 'rancunier' | 'loyal' | 'bavard' | 'prudent';

export type ProfessionId =
  | 'fermier' | 'bucheron' | 'mineur' | 'boulanger' | 'aubergiste'
  | 'forgeron' | 'marchand' | 'garde' | 'intendant' | 'journalier' | 'sans_emploi';

export type LocationKind = 'square' | 'farm' | 'market' | 'tavern' | 'forge' | 'bakery' | 'woodlot' | 'mine' | 'houses' | 'manor';

export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  x: number; // coordonnées carte (0..1000)
  y: number; // (0..640)
  description: string;
}

export interface Relation {
  affinity: number; // -100..100 : amitié / hostilité
  trust: number;    // -100..100 : confiance
  lastInteraction: number; // minute de jeu
}

export interface Needs {
  hunger: number; // 0 rassasié → 100 affamé
  energy: number; // 0 épuisé → 100 reposé
  social: number; // 0 isolé → 100 comblé
}

export type ActivityKind =
  | 'sleep' | 'work' | 'eat' | 'shop' | 'socialize' | 'manage'
  | 'idle' | 'seekJob' | 'patrol' | 'travel' | 'talk' | 'train' | 'forage' | 'dead';

export interface Activity {
  kind: ActivityKind;
  locationId: string;
  targetId?: string; // entreprise ou personnage visé
  since: number;     // minute de début
  note?: string;     // raison lisible (dérivée de la décision)
  wage?: number;     // salaire horaire négocié (journalier)
  quality?: number;  // qualité du repos (0..1) pour le sommeil
}

export type GoalKind = 'trouver_emploi' | 'epargner' | 'prosperer' | 'survivre' | 'servir';
export interface Goal { kind: GoalKind; target?: number }

/** Ambition de long terme d'un PNJ (phase 2). Pilote des décisions réelles, pas un texte décoratif. */
export type AmbitionKind = 'ouvrir_commerce' | 'faire_fortune' | 'meilleur_salaire' | 'vengeance' | 'vie_paisible';
export interface Ambition {
  kind: AmbitionKind;
  target?: number;     // somme visée
  targetId?: string;   // personne visée (vengeance)
  since: number;       // minute de début
  count?: number;      // actes accomplis (calomnies…)
  lastDay?: number;    // jour du dernier acte
}

export interface Character {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  sex: 'M' | 'F';
  isPlayer: boolean;
  alive: boolean;
  deathTime?: number;
  profession: ProfessionId;
  homeId: string;           // location
  employerId?: string;      // business
  locationId: string;
  money: number;            // pièces de cuivre (entier)
  inventory: Inventory;
  health: number;           // 0..100
  sick: number;             // heures de maladie restantes
  needs: Needs;
  attributes: Record<AttrId, number>; // 1..10
  skills: Record<SkillId, number>;    // 0..100
  skillXp: Partial<Record<SkillId, number>>;
  traits: TraitId[];
  goal: Goal;
  relations: Record<string, Relation>;
  knownEvents: string[];    // ids d'événements que ce personnage connaît (croyances)
  activity: Activity;
  unpaidWages: number;      // dette salariale due par l'employeur
  hoursWorkedToday: number;
  lastMealTime: number;
  forageProgress: number;  // fraction de fagot ramassé
  ambition: Ambition;
  jobSince?: number;      // jour d'embauche dans l'emploi actuel
}

export type BusinessKind = 'farm' | 'woodlot' | 'mine' | 'bakery' | 'tavern' | 'forge' | 'market' | 'manor';

export interface Recipe {
  inputs: Inventory;
  outputs: Inventory;
  labor: number; // heures de travail nécessaires par lot
  seasonal?: boolean; // rendement modulé par la saison
  usesTools: boolean;
}

export interface Business {
  id: string;
  name: string;
  kind: BusinessKind;
  locationId: string;
  ownerId: string | null;   // null = détenu par l'intendance du village
  treasury: number;
  stock: Inventory;
  laborPool: number;        // heures de travail accumulées non converties
  toolWear: number;         // usure accumulée (1 outil consommé tous les TOOL_WEAR_PER_TOOL)
  maxWorkers: number;
  wage: number;             // salaire horaire de base
  employees: string[];
  openFrom: number;         // heure d'ouverture
  openTo: number;
  sells: ItemId[];
  buys: ItemId[];           // biens achetés comme intrants ou pour revente
  targets: Inventory;       // stock souhaité (pilote prix & approvisionnement)
  produced: Inventory;      // compteur cumulatif
  daysInDeficit: number;
  lastTreasury: number;
  lastStaffChangeDay: number;
  lastShortageDay: Partial<Record<ItemId, number>>;
}

export type EventType =
  | 'work' | 'trade' | 'hire' | 'fire' | 'quit' | 'unpaid' | 'argument' | 'friendship'
  | 'gift' | 'theft' | 'theft_caught' | 'fine' | 'death' | 'arrival' | 'sickness'
  | 'shortage' | 'dividend' | 'tax' | 'insult' | 'compliment' | 'rumor' | 'starving'
  | 'inheritance' | 'production' | 'refusal' | 'chat' | 'help' | 'cold' | 'spoilage'
  | 'loan' | 'loan_repaid' | 'default' | 'seizure' | 'sale' | 'contract' | 'contract_warning'
  | 'work_praise' | 'order_posted' | 'order_done' | 'order_failed' | 'slander' | 'festival' | 'rivalry';

export interface WorldEvent {
  id: string;
  time: number;
  type: EventType;
  actorId?: string;
  targetId?: string;
  businessId?: string;
  locationId?: string;
  text: string;           // texte généré depuis l'état réel au moment de l'événement
  importance: 1 | 2 | 3;  // 1 = routine, 2 = notable, 3 = majeur
  causeIds?: string[];    // traçabilité causale
  witnesses: string[];
  data?: Record<string, number | string>;
}

/** Prêt d'argent entre personnes. Échéances hebdomadaires, intérêt simple fixé à la signature. */
export interface Loan {
  id: string;
  lenderId: string;       // personnage prêteur
  borrowerId: string;     // personnage débiteur
  principal: number;
  totalDue: number;       // capital + intérêts
  remaining: number;
  installment: number;    // montant dû à chaque échéance
  weeklyRate: number;
  createdDay: number;
  nextDueDay: number;
  finalDueDay: number;
  missed: number;
  status: 'active' | 'repaid' | 'defaulted';
  purpose: string;
}

/** Contrat de travail du joueur auprès d'un établissement. */
export interface JobContract {
  id: string;
  businessId: string;
  workerId: string;
  wage: number;
  hoursPerWeek: number;
  startDay: number;
  hoursThisWeek: number;
  goodWeeks: number;
  strikes: number;
  status: 'active' | 'ended';
  endReason?: string;
}

/** Commande d'approvisionnement affichée au tableau de la place. */
export interface SupplyOrder {
  id: string;
  businessId: string;
  item: ItemId;
  qty: number;
  delivered: number;
  unitPrice: number;
  postedDay: number;
  deadlineDay: number;
  takerId?: string;
  status: 'open' | 'taken' | 'done' | 'failed' | 'expired';
}

export interface Festival { day: number; alePaid: number; name: string }

export interface Ledger {
  produced: Inventory;
  consumed: Inventory;
  externalMoneyIn: number; // argent entré de l'extérieur (migrants)
  externalMoneyOut: number;
  externalItemsIn: Inventory;
  removedItems: Inventory; // objets sortis du monde (morts sans héritier, etc.)
}

export interface DailySnapshot {
  day: number;
  prices: Partial<Record<ItemId, number>>;
  totalMoney: number;
  population: number;
  employed: number;
  avgHunger: number;
  villageTreasury: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;               // état courant du PRNG
  time: number;              // minutes écoulées depuis le début
  processedHours: number;    // nombre d'heures déjà simulées (anti double calcul)
  locations: Record<string, Location>;
  locationOrder: string[];
  characters: Record<string, Character>;
  characterOrder: string[];
  businesses: Record<string, Business>;
  businessOrder: string[];
  events: WorldEvent[];
  eventSeq: number;
  idSeq: number;
  playerId: string;
  village: { name: string; taxRate: number; manorId: string; infrastructure: number };
  ledger: Ledger;
  history: DailySnapshot[];
  stats: { ticks: number; trades: number; npcActions: number };
  loans: Loan[];
  contracts: JobContract[];
  orders: SupplyOrder[];
  festival?: Festival;
  gameOver?: string;
  /** Mode observateur (tests/simulations) : le joueur n'a ni besoins ni présence. */
  observer?: boolean;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  minutes: number; // temps consommé (0 si refus)
  eventIds?: string[];
}

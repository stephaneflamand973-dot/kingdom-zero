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
  | 'forgeron' | 'marchand' | 'garde' | 'intendant' | 'journalier' | 'sans_emploi' | 'soldat' | 'seigneur';

export type LocationKind = 'square' | 'farm' | 'market' | 'tavern' | 'forge' | 'bakery' | 'woodlot' | 'mine' | 'houses' | 'manor' | 'road';

export interface Location {
  id: string;
  settlementId: string; // localité (ou 'road' pour une route)
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
  romance?: number;        // attirance 0..100 (phase 5)
}

export interface Needs {
  hunger: number; // 0 rassasié → 100 affamé
  energy: number; // 0 épuisé → 100 reposé
  social: number; // 0 isolé → 100 comblé
}

export type ActivityKind =
  | 'sleep' | 'work' | 'eat' | 'shop' | 'socialize' | 'manage'
  | 'idle' | 'seekJob' | 'patrol' | 'travel' | 'talk' | 'train' | 'forage' | 'dead' | 'jailed' | 'ambush';

export interface Activity {
  kind: ActivityKind;
  locationId: string;
  targetId?: string; // entreprise ou personnage visé
  since: number;     // minute de début
  note?: string;     // raison lisible (dérivée de la décision)
  wage?: number;     // salaire horaire négocié (journalier)
  until?: number;    // fin d'une activité longue (voyage)
  quality?: number;  // qualité du repos (0..1) pour le sommeil
  item?: ItemId;     // cueillette : bois mort (défaut) ou vivres de disette (phase 6)
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
  title?: 'ecuyer' | 'conseiller'; // titre accordé par un seigneur (phase 4)
  jailedUntil?: number;   // minute de libération
  // Famille (phase 5)
  birthDay: number;       // jour absolu de naissance (négatif pour les personnages nés avant la partie)
  spouseId?: string;
  parentIds: string[];
  childIds: string[];
  guardianId?: string;    // tuteur d'un orphelin mineur
  pregnantUntil?: number; // jour de l'accouchement
  pregnancyFather?: string;
  masterId?: string;      // domestique au service de ce maître (phase 5)
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
  seasonal?: string[];      // journaliers de moisson, libérés à l'hiver (phase 6)
  lastShortageDay: Partial<Record<ItemId, number>>;
  /** Fondée par un particulier (phase 3) */
  founded?: number;
}

export type EventType =
  | 'work' | 'trade' | 'hire' | 'fire' | 'quit' | 'unpaid' | 'argument' | 'friendship'
  | 'gift' | 'theft' | 'theft_caught' | 'fine' | 'death' | 'arrival' | 'sickness'
  | 'shortage' | 'dividend' | 'tax' | 'insult' | 'compliment' | 'rumor' | 'starving'
  | 'inheritance' | 'production' | 'refusal' | 'chat' | 'help' | 'cold' | 'spoilage'
  | 'loan' | 'loan_repaid' | 'default' | 'seizure' | 'sale' | 'contract' | 'contract_warning'
  | 'work_praise' | 'order_posted' | 'order_done' | 'order_failed' | 'slander' | 'festival' | 'rivalry'
  | 'caravan' | 'founding' | 'move' | 'rent' | 'eviction' | 'property'
  | 'ambush' | 'racket' | 'vandalism' | 'recruit' | 'arrest' | 'jail' | 'bounty' | 'tribute' | 'tax_change'
  | 'revolt' | 'war' | 'battle' | 'conquest' | 'peace' | 'plot' | 'assassination' | 'succession' | 'title' | 'combat' | 'diplomacy'
  | 'courtship' | 'wedding' | 'pregnancy' | 'birth' | 'coming_of_age' | 'estate' | 'adoption' | 'widowhood'
  | 'incident' | 'approach';

/** Aléa du monde (phase 6) : météo, épidémie, incendie, foire… */
export type IncidentKind = 'secheresse' | 'recolte' | 'grand_froid' | 'epidemie' | 'incendie' | 'foire';
export interface GrainConvoy { id: string; from: string; to: string; marketId: string; cargo: Inventory; departTime: number; arriveTime: number; urgent: boolean }
export interface Incident { id: string; kind: IncidentKind; settlementId: string; fromDay: number; toDay: number; businessId?: string }

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

// ── Phase 4 : pouvoir et conflits ───────────────────────────

export type OrgKind = 'house' | 'guild' | 'gang';
export type OrgRole = 'seigneur' | 'heritier' | 'soldat' | 'vassal' | 'conseiller' | 'chef' | 'membre';

/** Organisation : maison noble, guilde ou bande. Membres, chef, trésor, réserve et relations réels. */
export interface Organization {
  id: string;
  name: string;
  kind: OrgKind;
  leaderId: string | null;
  members: string[];
  roles: Record<string, OrgRole>;
  treasury: number;
  stash: Inventory;
  seatId: string;                     // localité du siège
  founded: number;
  dissolved?: number;
  relations: Record<string, number>;  // autre organisation → -100..100
  heat: number;                       // bandes : notoriété auprès des autorités ; maisons : menace perçue
  dues: number;                       // cotisation hebdomadaire (guildes) / solde hebdomadaire (soldats)
  hideoutId?: string;                 // bandes : repaire
  patrolRoads: string[];              // maisons : routes patrouillées
  service: Record<string, number>;    // heures de service de la semaine (soldats)
}

export interface War {
  id: string;
  attackerId: string;
  defenderId: string;
  targetSettlementId: string;
  startDay: number;
  victories: { attacker: number; defender: number };
  battles: number;
  status: 'active' | 'ended';
  outcome?: string;
}

/** Avis de recherche : un fait connu des autorités, une prime. */
export interface Wanted { characterId: string; houseId: string; reason: string; bounty: number; sinceDay: number }

/** Rencontre en cours pour le joueur (embuscade, arrestation) : combat au tour par tour. */
export interface Encounter {
  kind: 'bandits' | 'arrest';
  enemies: string[];
  hp: Record<string, number>;
  demand: number;
  orgId?: string;
  houseId?: string;
  destination?: string;
  remainingMinutes: number;
  roadId?: string;
  log: string[];
  round: number;
}

export interface Festival { day: number; alePaid: number; name: string; settlementId: string }

/** Localité de la région (phase 3) : son intendance, ses routes, sa prospérité. */
export interface Settlement {
  id: string;
  name: string;
  kind: 'village' | 'bourg';
  x: number; y: number;          // position sur la carte régionale (0..1000 × 0..640)
  squareId: string;              // place centrale
  manorId: string;               // intendance locale
  stewardId: string | null;      // intendant
  taxRate: number;
  infrastructure: number;        // état des chemins (0..100)
  yields: Partial<Record<BusinessKind, number>>; // spécialisation : multiplicateurs de rendement
  specialty: string;
  prosperity: number;            // 0..100, recalculée chaque semaine
  lordHouseId: string;           // maison noble qui tient la localité (phase 4)
  unrest: number;                // grogne 0..100
  unrestWeeks: number;           // semaines consécutives de forte grogne
  revoltUntilDay?: number;       // révolte : l'impôt n'est plus perçu
  popCap: number;                // au-delà, les migrants ne s'installent plus
  convoyDay?: number;            // dernier convoi de grain d'urgence (phase 6)
  history: SettlementSnapshot[];
}

export interface SettlementSnapshot { day: number; prosperity: number; population: number; employed: number; prices: Partial<Record<ItemId, number>> }

export interface Road { a: string; b: string; hours: number; locationId: string }

/** Caravane marchande : la cargaison existe physiquement pendant le trajet. */
export interface Caravan {
  id: string;
  merchantId: string;
  from: string; to: string;      // localités
  cargo: Inventory;
  cost: number;                  // prix d'achat payé
  departTime: number;
  arriveTime: number;
  status: 'en_route' | 'arrived';
  returning: boolean;
  ambushed?: boolean;            // déjà attaquée pendant ce trajet (phase 4)
}

/** Logement : à louer ou à vendre, avec un coffre. */
export interface Property {
  id: string;
  settlementId: string;
  locationId: string;
  name: string;
  price: number;
  weeklyRent: number;
  ownerId: string | null;        // null = intendance locale
  tenantId?: string;
  rentDueDay?: number;
  storage: Inventory;
  storageCap: number;
}

/** Relevé de prix d'une localité tel que le joueur l'a vu. */
export interface PriceRecord { day: number; prices: Partial<Record<ItemId, number>> }

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
  settlements: Record<string, Settlement>;
  settlementOrder: string[];
  roads: Road[];
  caravans: Caravan[];
  properties: Property[];
  priceBook: Record<string, PriceRecord>;
  /** Mémoire des marchands : prix unitaire réellement obtenu, par marchand, destination et bien. */
  tradeMemory: Record<string, number>;
  ledger: Ledger;
  history: DailySnapshot[];
  stats: { ticks: number; trades: number; npcActions: number };
  loans: Loan[];
  contracts: JobContract[];
  orders: SupplyOrder[];
  festivals: Festival[];
  orgs: Record<string, Organization>;
  orgOrder: string[];
  wars: War[];
  wanted: Wanted[];
  encounter?: Encounter;
  /** Lignée du joueur (phase 5) : chaque personnage incarné à tour de rôle. */
  dynasty: { name: string; generation: number; heads: { id: string; from: number; to?: number }[] };
  /** Le personnage joueur vient de mourir : choix du successeur en attente. */
  pendingSuccession?: { deceasedId: string; candidates: string[]; cause: string };
  /** Pilote automatique : l'IA conduit le joueur jusqu'à cette minute. */
  autopilotUntil?: number;
  /** Dernier jour où les anniversaires ont été fêtés (évite un double vieillissement). */
  birthdaysDoneDay?: number;
  gameOver?: string;
  /** Convois de grain en route (phase 6) : la cargaison existe physiquement pendant le trajet. */
  convoys?: GrainConvoy[];
  /** Aléas en cours ou récents (phase 6). */
  incidents?: Incident[];
  /** Dernière heure où un PNJ a abordé le joueur de lui-même (phase 6). */
  lastApproach?: number;
  /** Mode observateur (tests/simulations) : le joueur n'a ni besoins ni présence. */
  observer?: boolean;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  minutes: number; // temps consommé (0 si refus)
  eventIds?: string[];
}

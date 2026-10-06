// Tipi di base del motore di gioco. Tutte le distanze sono in pollici (come nel regolamento),
// gli angoli in gradi: 0 = verso l'alto (nord), crescono in senso orario.

export type Side = 'A' | 'B';
export const otherSide = (s: Side): Side => (s === 'A' ? 'B' : 'A');

export type TroopKey =
  | 'archers'
  | 'billmen'
  | 'pikemen'
  | 'menAtArms'
  | 'knights'
  | 'lightHorse'
  | 'skirmArchers'
  | 'crossbowmen'
  | 'handgunners'
  | 'kern'
  | 'fieldGun'
  | 'heavyGun';

export type Quality = 'levy' | 'retinue' | 'veteran';
export type Arm = 'infantry' | 'cavalry' | 'skirmisher' | 'artillery';
export type Formation = 'single' | 'line' | 'block' | 'mixed' | 'hedgehog';

export interface Company {
  id: string;
  type: TroopKey;
  quality: Quality;
  figures: number;
  maxFigures: number;
  /** Uccisioni subite in tutta la battaglia (usate dal Test di Crisi del Morale). */
  kills: number;
  /** Frecce rimaste (solo Compagnie di Arcieri, 6 all'inizio). */
  arrows?: number;
  /** Ha perso la possibilità di tirare (ripiegato dopo aver perso una mischia). */
  noShooting?: boolean;
  stakes?: boolean;
  stakesPlanted?: boolean;
  pavises?: boolean;
  /** Cavalieri appiedati: combattono come Uomini d'Arme ma testano il morale come cavalleria. */
  dismountedKnights?: boolean;
  /** Cavalleria leggera con archi/balestre (può appiedarsi). */
  mountedShooters?: boolean;
  /** Cavalleria leggera appiedata (2 figure tengono i cavalli). */
  dismountedLH?: boolean;
  pointsOriginal: number;
}

export interface Unit {
  id: string;
  side: Side;
  name: string;
  wardId: string;
  companies: Company[]; // 1 o 2 (formazioni appaiate)
  formation: Formation;
  x: number;
  y: number;
  facing: number;
  disarray: number; // 0..2
  daunted: boolean;
  dauntedThisTurn: boolean;
  /** Disordine temporaneo da "Voce Insistente" fino alla prossima carta Comandante amica. */
  rumourDisarray?: boolean;
  /** Ha ricevuto un Segnalino Ordine in questo turno. */
  ordered: boolean;
  /** Ha agito d'iniziativa (Schermagliatori/Artiglieria) in questo turno. */
  initiative: boolean;
  actionsLeft: number;
  actionsUsed: number;
  shotsThisTurn: number;
  /** Ha subito perdite da tiro o mischia in questo turno (per i test di fine turno). */
  lossesThisTurn: boolean;
  lossesAfterWin: boolean;
  wonMeleeThisTurn: boolean;
  meleeId?: string;
  chargesUsed: number;
  // Artiglieria
  gunDeployed?: boolean;
  gunDestroyed?: boolean;
  pivotedThisTurn?: boolean;
  shotAtByThisTurn?: string[];
  /** Ha tirato da un edificio/bosco in questo turno (si rivela). */
  revealed?: boolean;
  inBuilding?: string;
  /** Ai margini del bosco invece che all'interno. */
  woodEdge?: boolean;
  removed?: boolean;
  removedReason?: string;
  /** Uscito dal tavolo (evasione/rotta). */
  offTable?: boolean;
  /** Non ancora schierata sul tavolo. */
  unplaced?: boolean;
  /** Emerge da un'imboscata in questo turno. */
  ambushThisTurn?: boolean;
  /** Azioni di Riordino compiute in questo turno (servono due per togliere Scossa). */
  rallyCount?: number;
  /** Ha usato l'azione gratuita di fine turno. */
  freeUsed?: boolean;
}

export interface Leader {
  id: string;
  side: Side;
  name: string;
  rank: string;
  maxClass: number; // 1..3
  cls: number; // classe attuale (scende con le ferite)
  mounted: boolean;
  mountSwapUsed: boolean;
  isCinC: boolean;
  wardId: string;
  x: number;
  y: number;
  attachedTo?: string;
  killed?: boolean;
  /** Stordito da "Un Cavallo! Un Cavallo!" fino a fine attivazione. */
  stunned?: boolean;
  needsRemount?: boolean;
  usedThisActivation?: number;
  unplaced?: boolean;
}

export interface Ward {
  id: string;
  side: Side;
  name: string;
  leaderId: string;
}

export type AreaKind = 'wood' | 'hill' | 'steepHill' | 'marsh' | 'building' | 'builtUp';
export type LineKind = 'hedge' | 'wall' | 'stream' | 'fence' | 'stakes' | 'fieldDefence';

export interface Point {
  x: number;
  y: number;
}

export interface AreaFeature {
  id: string;
  kind: AreaKind;
  points: Point[];
  label?: string;
}

export interface LineFeature {
  id: string;
  kind: LineKind;
  points: Point[];
  /** Lato difeso (per pali/difese campali): il lato di chi le possiede. */
  owner?: Side;
}

export interface Terrain {
  areas: AreaFeature[];
  lines: LineFeature[];
}

export type CardKind = 'leader' | 'bonus' | 'skirmish';

export interface PlayCard {
  id: string;
  kind: CardKind;
  leaderId?: string;
  side?: Side;
}

export type BonusCardKind = 'perk' | 'forfeit' | 'reroll' | 'special' | 'dummy';

export interface BonusCard {
  id: string;
  kind: BonusCardKind;
}

export interface SpecialCard {
  id: string;
  key: string;
}

export interface HeldCard {
  id: string;
  kind: 'bonus' | 'special';
  bonusKind?: BonusCardKind;
  specialKey?: string;
  /** Le carte Bonus vanno usate entro fine turno; le Speciali durano tutta la battaglia. */
  expiresEndOfTurn: boolean;
}

export interface Melee {
  id: string;
  attackers: string[];
  defenders: string[];
  /** Round già combattuti. */
  round: number;
  /** Lato che ha vinto il primo round (per i ritiri del secondo round). */
  firstRoundWinner?: Side | 'tie';
  /** Unità coinvolte da un attacco sul fianco/retro (non si sono girate). */
  flanked: Record<string, 'flank' | 'rear'>;
  /** Unità che hanno caricato (cavalleria con bonus) in questo round. */
  charged: string[];
  /** Attaccanti in salita / attraverso ostacolo difeso. */
  uphill: string[];
  acrossObstacle: string[];
  intoBuilding: string[];
  followUp: string[];
  startedTurn: number;
  /** Bersaglio principale di ogni unità coinvolta. */
  targets: Record<string, string>;
  /** Unità già girate per fronteggiare un attacco sul fianco. */
  turned: string[];
  /** Compagnie annientate in questo round: la formazione deve testare comunque. */
  wipedFormation: string[];
  /** Duello tra Comandanti in Capo già risolto. */
  duelDone?: boolean;
  /** Il C-in-C che ha rifiutato il duello. */
  stage?: 'duel' | 'fight' | 'done';
}

export interface DiceRoll {
  label: string;
  side: Side;
  dice: number[];
  rerolled?: number[];
  target?: string;
  group: number;
}

export interface LogEntry {
  id: number;
  turn: number;
  text: string;
  side?: Side;
  rolls?: DiceRoll[];
  kind?: 'info' | 'combat' | 'morale' | 'card' | 'manual' | 'phase' | 'important';
  intentId?: number;
}

export type Phase = 'setup' | 'terrain' | 'deploy' | 'manoeuvre' | 'battle' | 'endTurn' | 'gameOver';

export interface PendingDecision {
  id: string;
  side: Side;
  kind: string;
  prompt: string;
  options: { value: string; label: string }[];
  ctx: any;
}

export interface Activation {
  kind: 'leader' | 'skirmish' | 'perk' | 'manoeuvre' | 'freeEnd';
  side: Side;
  leaderId?: string;
  tokensLeft: number;
  /** Unità attivate in questa attivazione. */
  units: string[];
  currentUnit?: string;
}

export interface PlayerInfo {
  name: string;
  faction: string;
  color: string;
  connected?: boolean;
}

export interface GameOptions {
  randomCommandClass: boolean;
  fullStrengthReroll: boolean;
  scouting: boolean;
  premeasure: boolean;
  brexit: boolean;
  pointsLimit: number;
}

export interface GameState {
  version: number;
  id: string;
  phase: Phase;
  turn: number;
  players: Record<Side, PlayerInfo>;
  options: GameOptions;
  units: Record<string, Unit>;
  leaders: Record<string, Leader>;
  wards: Record<string, Ward>;
  terrain: Terrain;
  table: { width: number; height: number };
  /** Chi deve agire nella fase di Manovra / dispiegamento. */
  activeSide: Side;
  firstSide: Side;
  terrainSide: Side;
  deployReady: Record<Side, boolean>;
  armyReady: Record<Side, boolean>;
  manoeuvrePasses: number;
  playDeck: PlayCard[];
  playDiscard: PlayCard[];
  currentCard?: PlayCard;
  bonusDeck: BonusCard[];
  specialDeck: SpecialCard[];
  specialDrawCount: number;
  hands: Record<Side, HeldCard[]>;
  bonusDrawnThisTurn: number;
  activation?: Activation;
  melees: Record<string, Melee>;
  pending: PendingDecision[];
  armyMorale: Record<Side, number>;
  armyMoraleStart: Record<Side, number>;
  /** Test per "vedere amici in rotta" già fatti mentre è in gioco la carta corrente. */
  sawRoutTested: string[];
  endTurn?: { freeDone: Record<Side, boolean> };
  winner?: Side;
  winReason?: string;
  log: LogEntry[];
  nextLogId: number;
  idCounter: number;
  /** Intent più recente (per la carta Ritira). */
  lastIntentId: number;
  /** Tratti di difese campali ancora da piazzare. */
  defencesToPlace: Record<Side, number>;
  /** Mischie da risolvere (all'uscita della prima carta Bonus o per nuovi attacchi). */
  meleeQueue: string[];
}

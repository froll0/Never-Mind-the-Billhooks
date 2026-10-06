import type { Arm, Company, Quality, TroopKey } from './types';

export interface ShootProfile {
  shortRange: number;
  shortHit: number;
  longRange?: number;
  longHit?: number;
  /** Tiri massimi per turno (gli Arcieri in Compagnia possono tirare due volte). */
  maxShots: number;
  armourPiercing?: boolean;
  artillery?: boolean;
}

export interface TroopProfile {
  key: TroopKey;
  name: string;
  short: string;
  arm: Arm;
  figures: number;
  /** Punti per figura e per unità a piena forza (qualità Seguito). */
  unitPoints: number;
  move: number;
  /** null = non può entrare in terreno difficile. */
  badMove: number | null;
  /** Non può entrare nei boschi (Cavalieri). */
  noWoods?: boolean;
  /** Formazione aperta: si muove in ogni direzione senza penalità. */
  loose: boolean;
  /** Il terreno difficile non riduce il movimento né causa Disordine. */
  ignoresBadGoing?: boolean;
  meleeDice: number; // dadi per figura
  meleeSave: number; // risultato minimo per salvare in mischia
  shootSave: number; // classe d'armatura contro il tiro
  shoot?: ShootProfile;
  morale: '2d6' | '1d6+1' | '1d6';
  canAttack: 'yes' | 'no' | 'kern';
  /** Larghezza e profondità della basetta di una figura (pollici). */
  baseW: number;
  baseD: number;
  perRank: number;
}

const INF_BASE = 0.8; // ~20 mm
const CAV_W = 1.0; // ~25 mm
const CAV_D = 2.0; // ~50 mm

export const TROOPS: Record<TroopKey, TroopProfile> = {
  archers: {
    key: 'archers', name: 'Arcieri', short: 'ARC', arm: 'infantry', figures: 12, unitPoints: 12,
    move: 6, badMove: 4, loose: false, meleeDice: 0.5, meleeSave: 5, shootSave: 5,
    shoot: { shortRange: 9, shortHit: 5, longRange: 15, longHit: 6, maxShots: 2 },
    morale: '2d6', canAttack: 'yes', baseW: INF_BASE, baseD: INF_BASE, perRank: 6,
  },
  billmen: {
    key: 'billmen', name: 'Alabardieri (Bill)', short: 'BIL', arm: 'infantry', figures: 12, unitPoints: 12,
    move: 6, badMove: 4, loose: false, meleeDice: 1, meleeSave: 4, shootSave: 4,
    morale: '2d6', canAttack: 'yes', baseW: INF_BASE, baseD: INF_BASE, perRank: 6,
  },
  pikemen: {
    key: 'pikemen', name: 'Picchieri', short: 'PIC', arm: 'infantry', figures: 12, unitPoints: 12,
    move: 6, badMove: 4, loose: false, meleeDice: 1, meleeSave: 4, shootSave: 4,
    morale: '2d6', canAttack: 'yes', baseW: INF_BASE, baseD: INF_BASE, perRank: 6,
  },
  menAtArms: {
    key: 'menAtArms', name: "Uomini d'Arme", short: 'UdA', arm: 'infantry', figures: 12, unitPoints: 24,
    move: 6, badMove: 4, loose: false, meleeDice: 1.5, meleeSave: 3, shootSave: 3,
    morale: '2d6', canAttack: 'yes', baseW: INF_BASE, baseD: INF_BASE, perRank: 6,
  },
  knights: {
    key: 'knights', name: 'Cavalieri', short: 'CAV', arm: 'cavalry', figures: 8, unitPoints: 24,
    move: 8, badMove: 4, noWoods: true, loose: false, meleeDice: 2, meleeSave: 3, shootSave: 4,
    morale: '1d6+1', canAttack: 'yes', baseW: CAV_W, baseD: CAV_D, perRank: 8,
  },
  lightHorse: {
    key: 'lightHorse', name: 'Cavalleria Leggera', short: 'CL', arm: 'cavalry', figures: 8, unitPoints: 12,
    move: 10, badMove: 4, loose: true, meleeDice: 1.5, meleeSave: 4, shootSave: 5,
    morale: '1d6+1', canAttack: 'yes', baseW: CAV_W, baseD: CAV_D, perRank: 8,
  },
  skirmArchers: {
    key: 'skirmArchers', name: 'Schermagliatori (archi)', short: 'SCH', arm: 'skirmisher', figures: 6, unitPoints: 6,
    move: 8, badMove: 8, loose: true, ignoresBadGoing: true, meleeDice: 0.5, meleeSave: 5, shootSave: 5,
    shoot: { shortRange: 12, shortHit: 5, maxShots: 2 },
    morale: '1d6', canAttack: 'no', baseW: INF_BASE * 2, baseD: INF_BASE * 1.5, perRank: 3,
  },
  crossbowmen: {
    key: 'crossbowmen', name: 'Balestrieri (schermaglia)', short: 'BAL', arm: 'skirmisher', figures: 6, unitPoints: 6,
    move: 8, badMove: 8, loose: true, ignoresBadGoing: true, meleeDice: 0.5, meleeSave: 5, shootSave: 5,
    shoot: { shortRange: 12, shortHit: 5, maxShots: 2, armourPiercing: true },
    morale: '1d6', canAttack: 'no', baseW: INF_BASE * 2, baseD: INF_BASE * 1.5, perRank: 3,
  },
  handgunners: {
    key: 'handgunners', name: 'Archibugieri (schermaglia)', short: 'ARQ', arm: 'skirmisher', figures: 6, unitPoints: 6,
    move: 8, badMove: 8, loose: true, ignoresBadGoing: true, meleeDice: 0.5, meleeSave: 5, shootSave: 5,
    shoot: { shortRange: 12, shortHit: 5, maxShots: 2, armourPiercing: true },
    morale: '1d6', canAttack: 'no', baseW: INF_BASE * 2, baseD: INF_BASE * 1.5, perRank: 3,
  },
  kern: {
    key: 'kern', name: 'Kern irlandesi', short: 'KER', arm: 'skirmisher', figures: 6, unitPoints: 6,
    move: 8, badMove: 8, loose: true, ignoresBadGoing: true, meleeDice: 1, meleeSave: 5, shootSave: 6,
    shoot: { shortRange: 6, shortHit: 5, maxShots: 2 },
    morale: '1d6', canAttack: 'kern', baseW: INF_BASE * 2, baseD: INF_BASE * 1.5, perRank: 3,
  },
  fieldGun: {
    key: 'fieldGun', name: 'Cannone da campo', short: 'ART', arm: 'artillery', figures: 3, unitPoints: 9,
    move: 4, badMove: null, loose: false, meleeDice: 0.5, meleeSave: 5, shootSave: 5,
    shoot: { shortRange: 30, shortHit: 6, maxShots: 2, artillery: true },
    morale: '1d6', canAttack: 'no', baseW: 1.0, baseD: 1.0, perRank: 3,
  },
  heavyGun: {
    key: 'heavyGun', name: 'Bombarda / pezzo pesante', short: 'BOM', arm: 'artillery', figures: 3, unitPoints: 9,
    move: 0, badMove: null, loose: false, meleeDice: 0.5, meleeSave: 5, shootSave: 5,
    shoot: { shortRange: 36, shortHit: 6, maxShots: 2, artillery: true },
    morale: '1d6', canAttack: 'no', baseW: 1.0, baseD: 1.0, perRank: 3,
  },
};

export const TROOP_ORDER: TroopKey[] = [
  'archers', 'billmen', 'menAtArms', 'pikemen', 'knights', 'lightHorse',
  'skirmArchers', 'crossbowmen', 'handgunners', 'kern', 'fieldGun', 'heavyGun',
];

export const QUALITY_NAME: Record<Quality, string> = {
  levy: 'Leva',
  retinue: 'Seguito',
  veteran: 'Veterani',
};

export const CLASS_NAME: Record<number, string> = {
  0: 'Fuori combattimento',
  1: 'Ottuso (classe 1)',
  2: 'Comandante (classe 2)',
  3: 'Eroe (classe 3)',
};

export const LEADER_POINTS = 5;
export const COMMAND_RANGE = 6;
export const LEADER_MOVE_FOOT = 8;
export const LEADER_MOVE_MOUNTED = 12;
export const LEADER_MOVE_BAD = 6;
export const CHARGE_BONUS = 4;
export const MAX_KNIGHT_CHARGES = 2;
export const ARROW_SUPPLY = 6;

/** Qualità ammesse per tipo di truppa nelle regole base. */
export function allowedQualities(t: TroopKey): Quality[] {
  if (t === 'archers' || t === 'billmen') return ['levy', 'retinue', 'veteran'];
  if (t === 'menAtArms' || t === 'pikemen') return ['retinue', 'veteran'];
  return ['retinue'];
}

export function companyPoints(t: TroopKey, q: Quality, extras: { stakes?: boolean; pavises?: boolean }): number {
  let p = TROOPS[t].unitPoints;
  if (q === 'veteran') p += t === 'menAtArms' ? 6 : 3;
  if (q === 'levy') p -= 3;
  if (extras.stakes) p += 3;
  if (extras.pavises) p += 3;
  return p;
}

export function profileOf(c: Company): TroopProfile {
  return TROOPS[c.type];
}

export function armOf(c: Company): Arm {
  if (c.dismountedKnights) return 'infantry';
  if (c.dismountedLH) return 'skirmisher';
  return TROOPS[c.type].arm;
}

export function isLevyInfantry(c: Company): boolean {
  return c.quality === 'levy' && TROOPS[c.type].arm === 'infantry';
}

/** Tiro salvezza contro il tiro (classe d'armatura). */
export function shootSaveTarget(c: Company, opts: { cover: boolean; armourPiercing: boolean }): number {
  let save = TROOPS[c.type].shootSave;
  if (c.dismountedKnights) save = 3;
  if (isLevyInfantry(c)) save = 6;
  if (c.type === 'menAtArms' || c.dismountedKnights) {
    if (opts.armourPiercing) save = 4;
  }
  const isInf = armOf(c) === 'infantry' || armOf(c) === 'skirmisher';
  if (opts.cover && isInf) save = Math.max(3, save - 1);
  return save;
}

/** Tiro salvezza in mischia. */
export function meleeSaveTarget(c: Company, opts: { cover: boolean }): number {
  let save = TROOPS[c.type].meleeSave;
  if (c.dismountedKnights) save = 3;
  if (c.dismountedLH) save = 5;
  if (c.quality === 'levy') {
    if (c.type === 'billmen') save = 5;
    if (c.type === 'archers') save = 6;
  }
  const isInf = armOf(c) === 'infantry' || armOf(c) === 'skirmisher';
  if (opts.cover && isInf) save = Math.max(3, save - 1);
  return save;
}

export function meleeDicePerFigure(c: Company): number {
  if (c.dismountedKnights) return 1.5;
  if (c.dismountedLH) return 0.5;
  return TROOPS[c.type].meleeDice;
}

export function moraleDice(c: Company): '2d6' | '1d6+1' | '1d6' {
  if (c.dismountedKnights) return '1d6+1';
  if (c.dismountedLH) return '1d6';
  return TROOPS[c.type].morale;
}

export function unitMoveRate(c: Company): { good: number; bad: number | null } {
  const p = TROOPS[c.type];
  if (c.dismountedKnights) return { good: 6, bad: 4 };
  if (c.dismountedLH) return { good: 8, bad: 8 };
  if (c.pavises && p.arm === 'skirmisher') return { good: 6, bad: 6 };
  return { good: p.move, bad: p.badMove };
}

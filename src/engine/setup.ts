import { ARROW_SUPPLY, LEADER_POINTS, TROOPS, companyPoints } from './data';
import type { Formation, GameOptions, GameState, Quality, Side, TroopKey } from './types';

export interface CompanyDef {
  type: TroopKey;
  quality: Quality;
  stakes?: boolean;
  pavises?: boolean;
  mountedShooters?: boolean;
}

export interface UnitDef {
  id: string;
  name: string;
  wardId: string;
  formation: Formation;
  companies: CompanyDef[];
}

export interface LeaderDef {
  id: string;
  name: string;
  rank: string;
  cls: number;
  mounted: boolean;
  isCinC: boolean;
}

export interface WardDef {
  id: string;
  name: string;
  leaderId: string;
}

export interface ArmyDef {
  faction: string;
  leaders: LeaderDef[];
  wards: WardDef[];
  units: UnitDef[];
  fieldDefences?: number;
}

export const DEFAULT_OPTIONS: GameOptions = {
  randomCommandClass: false,
  fullStrengthReroll: false,
  scouting: false,
  premeasure: true,
  brexit: false,
  pointsLimit: 110,
};

export function newGame(id: string, players: { A: string; B: string }, options: Partial<GameOptions> = {}): GameState {
  return {
    version: 1,
    id,
    phase: 'setup',
    turn: 0,
    players: {
      A: { name: players.A, faction: 'York', color: '#e8e4d8' },
      B: { name: players.B, faction: 'Lancaster', color: '#b3202a' },
    },
    options: { ...DEFAULT_OPTIONS, ...options },
    units: {},
    leaders: {},
    wards: {},
    terrain: { areas: [], lines: [] },
    table: { width: 72, height: 48 },
    activeSide: 'A',
    firstSide: 'A',
    terrainSide: 'A',
    deployReady: { A: false, B: false },
    armyReady: { A: false, B: false },
    manoeuvrePasses: 0,
    playDeck: [],
    playDiscard: [],
    bonusDeck: [],
    specialDeck: [],
    specialDrawCount: 0,
    hands: { A: [], B: [] },
    bonusDrawnThisTurn: 0,
    melees: {},
    pending: [],
    armyMorale: { A: 0, B: 0 },
    armyMoraleStart: { A: 0, B: 0 },
    sawRoutTested: [],
    log: [],
    nextLogId: 1,
    idCounter: 0,
    lastIntentId: 0,
    meleeQueue: [],
    defencesToPlace: { A: 0, B: 0 },
  };
}

export function companyDefPoints(c: CompanyDef): number {
  return companyPoints(c.type, c.quality, c);
}

export function armyPoints(a: ArmyDef): { troops: number; leaders: number; extras: number; total: number } {
  let troops = 0;
  for (const u of a.units) for (const c of u.companies) troops += companyDefPoints(c);
  const leaders = Math.max(0, a.leaders.length - 1) * LEADER_POINTS;
  const extras = (a.fieldDefences ?? 0) * 3;
  return { troops, leaders, extras, total: troops + leaders + extras };
}

/** Controlli di composizione (avvisi, non bloccanti). */
export function armyWarnings(a: ArmyDef): string[] {
  const w: string[] = [];
  const pts = armyPoints(a);
  let core = 0;
  let skArt = 0;
  let arch = 0;
  let bill = 0;
  for (const u of a.units)
    for (const c of u.companies) {
      const p = companyDefPoints(c);
      if (c.type === 'archers') {
        core += p;
        arch++;
      }
      if (c.type === 'billmen') {
        core += p;
        bill++;
      }
      const arm = TROOPS[c.type].arm;
      if (arm === 'skirmisher' || arm === 'artillery') skArt += p;
    }
  if (pts.troops > 0 && core < pts.troops / 2) w.push('Arcieri e Alabardieri dovrebbero essere almeno metà dei punti truppa (esercito inglese).');
  if (Math.abs(arch - bill) > 1) w.push('Le Compagnie di Arcieri e Alabardieri dovrebbero essere in numero simile.');
  if (pts.troops > 0 && skArt > pts.troops / 5) w.push('Schermagliatori e Artiglieria non dovrebbero superare un quinto dei punti truppa.');
  if (a.leaders.filter((l) => l.isCinC).length !== 1) w.push('Serve esattamente un Comandante in Capo.');
  if (a.leaders.length < 2 || a.leaders.length > 4) w.push('Si consigliano da 2 a 4 Comandanti.');
  if (a.leaders.filter((l) => l.cls === 3).length > 1) w.push('Un esercito non può avere più di un Eroe.');
  if (a.leaders.some((l) => l.isCinC && l.cls === 1)) w.push('Il Comandante in Capo non può essere un Ottuso.');
  for (const u of a.units) {
    if (u.companies.length === 2) {
      const [x, y] = u.companies;
      if (u.formation === 'mixed') {
        const ok = (x.type === 'archers' && (y.type === 'billmen' || y.type === 'menAtArms')) || (y.type === 'archers' && (x.type === 'billmen' || x.type === 'menAtArms'));
        if (!ok) w.push(`${u.name}: un Blocco Misto unisce Arcieri con Alabardieri o Uomini d'Arme.`);
      } else if (x.type !== y.type) w.push(`${u.name}: una formazione appaiata richiede due Compagnie dello stesso tipo.`);
      if (x.quality !== y.quality) w.push(`${u.name}: le due Compagnie devono avere la stessa qualità.`);
    }
    if (!a.wards.some((wd) => wd.id === u.wardId)) w.push(`${u.name}: non è assegnata a nessuna Schiera.`);
  }
  return w;
}

/** Carica l'esercito nello stato (unità non ancora schierate). */
export function loadArmy(s: GameState, side: Side, a: ArmyDef) {
  for (const id of Object.keys(s.units)) if (s.units[id].side === side) delete s.units[id];
  for (const id of Object.keys(s.leaders)) if (s.leaders[id].side === side) delete s.leaders[id];
  for (const id of Object.keys(s.wards)) if (s.wards[id].side === side) delete s.wards[id];
  s.players[side].faction = a.faction || s.players[side].faction;
  s.defencesToPlace[side] = a.fieldDefences ?? 0;
  const facing = side === 'A' ? 0 : 180;
  const pre = side + '-';
  for (const l of a.leaders) {
    s.leaders[pre + l.id] = {
      id: pre + l.id,
      side,
      name: l.name,
      rank: l.rank,
      maxClass: l.cls,
      cls: l.cls,
      mounted: l.mounted,
      mountSwapUsed: false,
      isCinC: l.isCinC,
      wardId: '',
      x: 0,
      y: 0,
      unplaced: true,
    };
  }
  for (const w of a.wards) {
    s.wards[pre + w.id] = { id: pre + w.id, side, name: w.name, leaderId: pre + w.leaderId };
    const l = s.leaders[pre + w.leaderId];
    if (l) l.wardId = pre + w.id;
  }
  let n = 0;
  for (const u of a.units) {
    const id = pre + u.id;
    s.units[id] = {
      id,
      side,
      name: u.name,
      wardId: pre + u.wardId,
      formation: u.companies.length === 2 ? u.formation : 'single',
      companies: u.companies.map((c, i) => {
        const p = TROOPS[c.type];
        return {
          id: `${id}c${i}`,
          type: c.type,
          quality: c.quality,
          figures: p.figures,
          maxFigures: p.figures,
          kills: 0,
          arrows: c.type === 'archers' ? ARROW_SUPPLY : undefined,
          stakes: c.stakes,
          pavises: c.pavises,
          mountedShooters: c.mountedShooters,
          pointsOriginal: companyDefPoints(c),
        };
      }),
      x: 0,
      y: 0,
      facing,
      disarray: 0,
      daunted: false,
      dauntedThisTurn: false,
      ordered: false,
      initiative: false,
      actionsLeft: 0,
      actionsUsed: 0,
      shotsThisTurn: 0,
      lossesThisTurn: false,
      lossesAfterWin: false,
      wonMeleeThisTurn: false,
      chargesUsed: 0,
      gunDeployed: TROOPS[u.companies[0].type].arm === 'artillery' ? true : undefined,
      unplaced: true,
    };
    n++;
  }
  // Le difese campali acquistate diventano segmenti da posizionare durante lo schieramento.
  return n;
}

/** Eserciti di esempio pronti all'uso (circa 110 punti). */
export function sampleArmy(side: Side): ArmyDef {
  const york = side === 'A';
  const names = york
    ? { c: 'Edoardo di York', l2: 'Lord Hastings', l3: 'Sir John Howard', f: 'York' }
    : { c: 'Enrico Beaufort', l2: 'Lord Clifford', l3: 'Sir Andrew Trollope', f: 'Lancaster' };
  return {
    faction: names.f,
    leaders: [
      { id: 'L1', name: names.c, rank: 'Duca', cls: 2, mounted: false, isCinC: true },
      { id: 'L2', name: names.l2, rank: 'Lord', cls: 2, mounted: false, isCinC: false },
      { id: 'L3', name: names.l3, rank: 'Cavaliere', cls: 2, mounted: true, isCinC: false },
    ],
    wards: [
      { id: 'W1', name: 'Schiera principale', leaderId: 'L1' },
      { id: 'W2', name: 'Avanguardia', leaderId: 'L2' },
      { id: 'W3', name: 'Retroguardia', leaderId: 'L3' },
    ],
    units: [
      { id: 'U1', name: "Uomini d'Arme della casa", wardId: 'W1', formation: 'single', companies: [{ type: 'menAtArms', quality: 'retinue' }] },
      { id: 'U2', name: 'Bill del seguito', wardId: 'W1', formation: 'single', companies: [{ type: 'billmen', quality: 'retinue' }] },
      { id: 'U3', name: 'Arcieri del seguito', wardId: 'W2', formation: 'line', companies: [{ type: 'archers', quality: 'retinue' }, { type: 'archers', quality: 'retinue' }] },
      { id: 'U4', name: 'Bill della contea', wardId: 'W2', formation: 'single', companies: [{ type: 'billmen', quality: 'retinue' }] },
      { id: 'U5', name: 'Arcieri di leva', wardId: 'W3', formation: 'single', companies: [{ type: 'archers', quality: 'levy' }] },
      { id: 'U6', name: 'Bill di leva', wardId: 'W3', formation: 'single', companies: [{ type: 'billmen', quality: 'levy' }] },
      { id: 'U7', name: 'Cavalleggeri', wardId: 'W3', formation: 'single', companies: [{ type: 'lightHorse', quality: 'retinue' }] },
      { id: 'U8', name: 'Schermagliatori', wardId: 'W2', formation: 'single', companies: [{ type: york ? 'handgunners' : 'skirmArchers', quality: 'retinue' }] },
    ],
  };
}

import { TROOPS, armOf, moraleDice, unitMoveRate } from './data';
import { rectCorners, pointInPolygon, polygonsOverlap, type Rect, frontCenter } from './geometry';
import type { Arm, Company, GameState, Leader, Point, Side, Unit } from './types';

export function perRank(c: Company): number {
  if (c.dismountedKnights) return 4;
  if (c.dismountedLH) return 3;
  return TROOPS[c.type].perRank;
}

function baseDims(c: Company): { w: number; d: number } {
  if (c.dismountedKnights) return { w: 0.8, d: 0.8 };
  if (c.dismountedLH) return { w: 1.6, d: 1.2 };
  return { w: TROOPS[c.type].baseW, d: TROOPS[c.type].baseD };
}

/** Dimensioni di una singola compagnia/banda/squadrone. */
export function companyDims(c: Company): { w: number; d: number } {
  const pr = perRank(c);
  const b = baseDims(c);
  const p = TROOPS[c.type];
  if (p.arm === 'artillery') return { w: 2.5, d: 3 };
  const fullRanks = Math.max(1, Math.ceil(c.maxFigures / pr));
  const front = Math.max(1, Math.min(pr, c.figures));
  return { w: front * b.w, d: fullRanks * b.d };
}

export function unitDims(u: Unit): { w: number; d: number } {
  const live = u.companies;
  if (live.length === 1) return companyDims(live[0]);
  const a = companyDims(live[0]);
  const b = companyDims(live[1]);
  if (u.formation === 'line') return { w: a.w + b.w, d: Math.max(a.d, b.d) };
  return { w: Math.max(a.w, b.w), d: a.d + b.d };
}

export function unitRect(u: Unit, at?: { x: number; y: number; facing: number }): Rect {
  const { w, d } = unitDims(u);
  return { cx: at?.x ?? u.x, cy: at?.y ?? u.y, w, d, facing: at?.facing ?? u.facing };
}

export function unitPoly(u: Unit, at?: { x: number; y: number; facing: number }): Point[] {
  return rectCorners(unitRect(u, at));
}

export function unitFront(u: Unit): Point {
  return frontCenter(unitRect(u));
}

export function liveUnits(s: GameState, side?: Side): Unit[] {
  return Object.values(s.units).filter((u) => !u.removed && (!side || u.side === side));
}

export function liveLeaders(s: GameState, side?: Side): Leader[] {
  return Object.values(s.leaders).filter((l) => !l.killed && (!side || l.side === side));
}

export function unitArm(u: Unit): Arm {
  return armOf(u.companies[0]);
}

export function isCavalry(u: Unit) {
  return unitArm(u) === 'cavalry';
}
export function isSkirmisher(u: Unit) {
  return unitArm(u) === 'skirmisher';
}
export function isArtillery(u: Unit) {
  return unitArm(u) === 'artillery';
}
export function isInfantryCompany(u: Unit) {
  return unitArm(u) === 'infantry';
}
export function isLoose(u: Unit) {
  const c = u.companies[0];
  if (c.dismountedLH) return true;
  if (c.dismountedKnights) return false;
  return TROOPS[c.type].loose;
}
export function isKern(u: Unit) {
  return u.companies[0].type === 'kern';
}
export function hasType(u: Unit, t: Company['type']) {
  return u.companies.some((c) => c.type === t);
}
export function isArcherCompany(c: Company) {
  return c.type === 'archers';
}

export function unitFigures(u: Unit): number {
  return u.companies.reduce((a, c) => a + c.figures, 0);
}

export function unitPointsOriginal(u: Unit): number {
  return u.companies.reduce((a, c) => a + c.pointsOriginal, 0);
}

export function companyHalfStrength(c: Company): boolean {
  return c.figures <= c.maxFigures / 2;
}

export function unitHalfStrength(u: Unit): boolean {
  return u.companies.some(companyHalfStrength);
}

export function unitFullStrength(u: Unit): boolean {
  return u.companies.every((c) => c.figures >= c.maxFigures);
}

export function unitMove(u: Unit, bad: boolean): number | null {
  let best: number | null = Infinity;
  for (const c of u.companies) {
    const r = unitMoveRate(c);
    const v = bad ? r.bad : r.good;
    if (v === null) return null;
    best = Math.min(best!, v);
  }
  return best;
}

/** Truppe che contano come "Unità" per le Riserve del Morale d'Armata (Compagnie e Squadroni). */
export function countsForArmyMorale(c: Company): boolean {
  const a = armOf(c);
  return a === 'infantry' || a === 'cavalry';
}

export function moraleKind(u: Unit) {
  return moraleDice(u.companies[0]);
}

export function unitLabel(u: Unit): string {
  return u.name;
}

export function leaderOf(s: GameState, u: Unit): Leader | undefined {
  return Object.values(s.leaders).find((l) => !l.killed && l.attachedTo === u.id);
}

export function wardLeader(s: GameState, u: Unit): Leader | undefined {
  const w = s.wards[u.wardId];
  if (!w) return undefined;
  const l = s.leaders[w.leaderId];
  return l && !l.killed ? l : undefined;
}

export function cinc(s: GameState, side: Side): Leader | undefined {
  return Object.values(s.leaders).find((l) => l.side === side && l.isCinC && !l.killed);
}

export function inArea(s: GameState, p: Point, kinds: string[]): boolean {
  return s.terrain.areas.some((a) => kinds.includes(a.kind) && pointInPolygon(p, a.points));
}

export function unitInArea(s: GameState, u: Unit, kinds: string[], at?: { x: number; y: number; facing: number }): boolean {
  const poly = unitPoly(u, at);
  return s.terrain.areas.some((a) => kinds.includes(a.kind) && polygonsOverlap(poly, a.points));
}

export function unitCentreInArea(s: GameState, u: Unit, kinds: string[]): boolean {
  return inArea(s, { x: u.x, y: u.y }, kinds);
}

export function onHill(s: GameState, p: Point): boolean {
  return inArea(s, p, ['hill', 'steepHill']);
}

export function leaderPos(l: Leader): Point {
  return { x: l.x, y: l.y };
}

/** Ricolloca i comandanti aggregati quando l'unità si sposta. */
export function syncAttachedLeaders(s: GameState, u: Unit) {
  for (const l of Object.values(s.leaders)) {
    if (l.attachedTo === u.id && !l.killed) {
      const r = unitRect(u);
      const back = frontCenter({ ...r, facing: (r.facing + 180) % 360 });
      l.x = back.x;
      l.y = back.y;
    }
  }
}

export function isEngaged(u: Unit): boolean {
  return !!u.meleeId;
}

export function companyName(c: Company): string {
  return TROOPS[c.type].name;
}

import {
  closestPointOnPolygon,
  dist,
  distPointSegment,
  lengthInsidePolygon,
  pointInPolygon,
  polygonDistance,
  samplePerimeter,
  segmentsIntersect,
  toLocal,
} from './geometry';
import type { GameState, Point, Unit } from './types';
import { isSkirmisher, liveUnits, onHill, unitPoly, unitRect } from './units';

export interface LosResult {
  ok: boolean;
  reason?: string;
  /** Il bersaglio è dietro copertura leggera (siepe/muro). */
  lightCover?: boolean;
}

/** Il segmento a-b è sgombro da altre unità (gli Schermagliatori non bloccano)? */
export function unitsBlocking(s: GameState, a: Point, b: Point, exclude: string[], corridor: number, shooter?: Unit): Unit[] {
  const res: Unit[] = [];
  const shooterOnHill = shooter ? onHill(s, { x: shooter.x, y: shooter.y }) : false;
  for (const u of liveUnits(s)) {
    if (u.unplaced || exclude.includes(u.id)) continue;
    // Gli Schermagliatori non bloccano la vista, ma non si tira mai attraverso truppe amiche.
    if (isSkirmisher(u) && !(shooter && u.side === shooter.side)) continue;
    const poly = unitPoly(u);
    let d = Infinity;
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      if (segmentsIntersect(a, b, p, q)) {
        d = 0;
        break;
      }
      d = Math.min(d, distPointSegment(p, a, b));
    }
    if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) d = 0;
    if (d < corridor) {
      // Tiro sopra le teste: tiratori su un'altura, amici più in basso, bersaglio ad almeno 6" oltre.
      if (shooter && shooterOnHill && u.side === shooter.side && !onHill(s, { x: u.x, y: u.y })) {
        const beyond = polygonDistance(poly, [b, b, b]);
        if (beyond >= 6 && shooter.companies.some((c) => c.type === 'archers')) continue;
      }
      res.push(u);
    }
  }
  return res;
}

/** Linea di vista da un punto verso un'unità bersaglio, con le regole di avvistamento. */
export function lineOfSight(s: GameState, from: Point, target: Unit, exclude: string[], opts: { corridor?: number; viewerInWood?: boolean; shooter?: Unit } = {}): LosResult {
  const tPoly = unitPoly(target);
  const to = closestPointOnPolygon(from, tPoly);
  const range = dist(from, to);
  const blockers = unitsBlocking(s, from, to, [...exclude, target.id], opts.corridor ?? 0.01, opts.shooter);
  if (blockers.length) return { ok: false, reason: `Visuale bloccata da ${blockers[0].name}` };

  // Copertura densa: boschi ed edifici.
  for (const a of s.terrain.areas) {
    if (a.kind !== 'wood' && a.kind !== 'building' && a.kind !== 'builtUp') continue;
    const targetInside = pointInPolygon({ x: target.x, y: target.y }, a.points) && !target.woodEdge;
    const viewerInside = pointInPolygon(from, a.points);
    const inside = lengthInsidePolygon(from, to, a.points);
    if (target.inBuilding === a.id && !target.revealed) return { ok: false, reason: `${target.name} è al riparo nell'edificio` };
    if (targetInside || viewerInside) {
      if (!target.revealed && range > 6) return { ok: false, reason: 'Copertura densa: avvistabile solo entro 6"' };
    } else if (inside > 0.3) {
      return { ok: false, reason: 'Visuale bloccata da bosco o edificio' };
    }
  }

  // Copertura leggera: siepi e muri tra i due, vicino al bersaglio.
  let lightCover = false;
  for (const l of s.terrain.lines) {
    if (l.kind !== 'hedge' && l.kind !== 'wall') continue;
    for (let i = 0; i < l.points.length - 1; i++) {
      if (segmentsIntersect(from, to, l.points[i], l.points[i + 1])) {
        const dTarget = Math.min(...tPoly.map((p) => distPointSegment(p, l.points[i], l.points[i + 1])));
        if (dTarget <= 2) lightCover = true;
      }
    }
  }
  if (lightCover && !target.revealed && range > 12) return { ok: false, reason: 'Dietro copertura leggera: avvistabile solo entro 12"', lightCover };
  return { ok: true, lightCover };
}

/** Il bersaglio è (almeno in parte) nell'arco di tiro di 45° misurato dalle estremità del fronte? */
export function inShootingArc(shooter: Unit, target: Unit): boolean {
  const r = unitRect(shooter);
  const pts = samplePerimeter(unitPoly(target), 0.4);
  for (const p of pts) {
    const l = toLocal(r, p);
    const y = l.y - r.d / 2;
    if (y < 0) continue;
    if (l.x >= -r.w / 2 - y && l.x <= r.w / 2 + y) return true;
  }
  return false;
}

/** Arco frontale per il movimento (45° a destra e sinistra dal fronte). */
export function inForwardArc(u: Unit, p: Point): boolean {
  const r = unitRect(u);
  const l = toLocal(r, p);
  const y = l.y;
  if (y < 0) return false;
  return Math.abs(l.x) <= y + 0.01;
}

/** Distanza di tiro: dal centro del fronte del tiratore al punto più vicino del bersaglio. */
export function shootingRange(shooter: Unit, target: Unit): number {
  const r = unitRect(shooter);
  const fc = { x: r.cx + Math.sin((r.facing * Math.PI) / 180) * (r.d / 2), y: r.cy - Math.cos((r.facing * Math.PI) / 180) * (r.d / 2) };
  return dist(fc, closestPointOnPolygon(fc, unitPoly(target)));
}

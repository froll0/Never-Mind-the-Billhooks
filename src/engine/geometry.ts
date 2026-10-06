import type { Point } from './types';

export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

export function normAngle(a: number): number {
  let x = a % 360;
  if (x < 0) x += 360;
  return x;
}

/** Differenza angolare con segno in [-180, 180). */
export function angleDiff(a: number, b: number): number {
  let d = normAngle(a - b);
  if (d >= 180) d -= 360;
  return d;
}

/** Versore "avanti" per un orientamento (0 = verso l'alto, y decresce). */
export function forward(facing: number): Point {
  return { x: Math.sin(rad(facing)), y: -Math.cos(rad(facing)) };
}

export function right(facing: number): Point {
  return { x: Math.cos(rad(facing)), y: Math.sin(rad(facing)) };
}

/** Orientamento che punta da a verso b. */
export function bearing(a: Point, b: Point): number {
  return normAngle(deg(Math.atan2(b.x - a.x, -(b.y - a.y))));
}

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const len = (a: Point) => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export interface Rect {
  cx: number;
  cy: number;
  w: number; // fronte
  d: number; // profondità
  facing: number;
}

/** Angoli del rettangolo: [fronte-sinistra, fronte-destra, retro-destra, retro-sinistra]. */
export function rectCorners(r: Rect): Point[] {
  const f = forward(r.facing);
  const rt = right(r.facing);
  const c = { x: r.cx, y: r.cy };
  const hw = r.w / 2;
  const hd = r.d / 2;
  return [
    add(add(c, mul(f, hd)), mul(rt, -hw)),
    add(add(c, mul(f, hd)), mul(rt, hw)),
    add(add(c, mul(f, -hd)), mul(rt, hw)),
    add(add(c, mul(f, -hd)), mul(rt, -hw)),
  ];
}

export function frontCenter(r: Rect): Point {
  return add({ x: r.cx, y: r.cy }, mul(forward(r.facing), r.d / 2));
}

export function rearCenter(r: Rect): Point {
  return add({ x: r.cx, y: r.cy }, mul(forward(r.facing), -r.d / 2));
}

/** Coordinate locali: x verso destra, y verso avanti, origine al centro. */
export function toLocal(r: Rect, p: Point): Point {
  const v = sub(p, { x: r.cx, y: r.cy });
  return { x: dot(v, right(r.facing)), y: dot(v, forward(r.facing)) };
}

export function fromLocal(r: Rect, p: Point): Point {
  return add(add({ x: r.cx, y: r.cy }, mul(right(r.facing), p.x)), mul(forward(r.facing), p.y));
}

export function pointInRect(r: Rect, p: Point, margin = 0): boolean {
  const l = toLocal(r, p);
  return Math.abs(l.x) <= r.w / 2 + margin && Math.abs(l.y) <= r.d / 2 + margin;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(sub(p2, p1), sub(q1, p1));
  const d2 = cross(sub(p2, p1), sub(q2, p1));
  const d3 = cross(sub(q2, q1), sub(p1, q1));
  const d4 = cross(sub(q2, q1), sub(p2, q1));
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

export function segmentIntersection(p1: Point, p2: Point, q1: Point, q2: Point): Point | null {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q1, p1), s) / den;
  const u = cross(sub(q1, p1), r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return add(p1, mul(r, t));
}

export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, mul(ab, t));
}

export function distPointSegment(p: Point, a: Point, b: Point): number {
  return dist(p, closestPointOnSegment(p, a, b));
}

export function segmentSegmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointSegment(a1, b1, b2),
    distPointSegment(a2, b1, b2),
    distPointSegment(b1, a1, a2),
    distPointSegment(b2, a1, a2),
  );
}

export function polygonEdges(poly: Point[]): [Point, Point][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as [Point, Point]);
}

export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (const [p1, p2] of polygonEdges(a)) for (const [q1, q2] of polygonEdges(b)) if (segmentsIntersect(p1, p2, q1, q2)) return true;
  if (pointInPolygon(a[0], b)) return true;
  if (pointInPolygon(b[0], a)) return true;
  return false;
}

export function polygonDistance(a: Point[], b: Point[]): number {
  if (polygonsOverlap(a, b)) return 0;
  let best = Infinity;
  for (const [p1, p2] of polygonEdges(a)) for (const [q1, q2] of polygonEdges(b)) best = Math.min(best, segmentSegmentDistance(p1, p2, q1, q2));
  return best;
}

/** Punto del poligono più vicino a p (sul bordo, o p stesso se interno). */
export function closestPointOnPolygon(p: Point, poly: Point[]): Point {
  if (pointInPolygon(p, poly)) return p;
  let best = poly[0];
  let bd = Infinity;
  for (const [a, b] of polygonEdges(poly)) {
    const c = closestPointOnSegment(p, a, b);
    const d = dist(p, c);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Il segmento attraversa (o tocca) il poligono? */
export function segmentHitsPolygon(a: Point, b: Point, poly: Point[]): boolean {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (const [p, q] of polygonEdges(poly)) if (segmentsIntersect(a, b, p, q)) return true;
  return false;
}

/** Lunghezza del tratto di segmento a-b che si trova dentro il poligono (campionata). */
export function lengthInsidePolygon(a: Point, b: Point, poly: Point[], step = 0.25): number {
  const L = dist(a, b);
  const n = Math.max(2, Math.ceil(L / step));
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    if (pointInPolygon({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, poly)) inside += L / n;
  }
  return inside;
}

/** Punti campionati sul perimetro di un poligono. */
export function samplePerimeter(poly: Point[], step = 0.5): Point[] {
  const pts: Point[] = [];
  for (const [a, b] of polygonEdges(poly)) {
    const L = dist(a, b);
    const n = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i < n; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  }
  return pts;
}

export function polygonCentroid(poly: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

export function ellipsePolygon(cx: number, cy: number, rx: number, ry: number, n = 20, wobble = 0): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (wobble ? Math.sin(i * 2.7) * wobble : 0);
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  return pts;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

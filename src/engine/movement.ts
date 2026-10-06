import { TROOPS } from './data';
import { add, angleDiff, bearing, dist, fromLocal, mul, normAngle, pointInPolygon, polygonsOverlap, rectCorners, segmentIntersection, sub, toLocal, len, frontCenter } from './geometry';
import type { GameState, Leader, Point, Unit } from './types';
import { isArtillery, isCavalry, isLoose, isSkirmisher, liveUnits, unitArm, unitMove, unitPoly, unitRect } from './units';

export const BAD_GOING = ['wood', 'marsh', 'steepHill', 'builtUp', 'building'];

export interface MovePlan {
  ok: boolean;
  reason?: string;
  dest: { x: number; y: number; facing: number };
  distance: number;
  allowance: number;
  disarray: number;
  notes: string[];
  disarrayOthers: string[];
  badGoing: boolean;
  truncated?: boolean;
}

/** Le unità di schermaglia contano come fanteria per l'attraversamento. */
function crossArm(u: Unit): 'foot' | 'horse' {
  return unitArm(u) === 'cavalry' ? 'horse' : 'foot';
}

function sweep(u: Unit, from: Point, to: Point, facing: number, step = 0.4): Point[][] {
  const L = dist(from, to);
  const n = Math.max(1, Math.ceil(L / step));
  const polys: Point[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    polys.push(unitPoly(u, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, facing }));
  }
  return polys;
}

export function areasTouched(s: GameState, polys: Point[][], kinds: string[]) {
  return s.terrain.areas.filter((a) => kinds.includes(a.kind) && polys.some((p) => polygonsOverlap(p, a.points)));
}

/** Pianifica e valida un movimento rettilineo (azione Muovi). */
export function planMove(
  s: GameState,
  u: Unit,
  target: { x: number; y: number; facing?: number },
  opts: { manoeuvre?: boolean; charge?: boolean; ignoreUnits?: string[]; allowContact?: string[]; evade?: boolean; retreat?: boolean } = {},
): MovePlan {
  const notes: string[] = [];
  const loose = isLoose(u);
  const facing = loose && target.facing !== undefined ? normAngle(target.facing) : u.facing;
  const from = { x: u.x, y: u.y };
  let to = { x: target.x, y: target.y };
  const res: MovePlan = { ok: false, dest: { ...to, facing }, distance: 0, allowance: 0, disarray: 0, notes, disarrayOthers: [], badGoing: false };
  if (isArtillery(u)) {
    if (u.companies[0].type === 'heavyGun') return { ...res, reason: 'I pezzi pesanti non si possono muovere' };
    if (u.gunDeployed) return { ...res, reason: 'Il pezzo è schierato: serve prima l\'azione "Aggancia/Sgancia" (2 azioni)' };
  }
  const distance = dist(from, to);
  res.distance = distance;
  const polys = sweep(u, from, to, facing);
  // Terreno
  const touched = areasTouched(s, polys, BAD_GOING);
  const p0 = TROOPS[u.companies[0].type];
  const ignoresBad = isSkirmisher(u);
  if (touched.some((a) => a.kind === 'building') && !isSkirmisher(u)) return { ...res, reason: 'Solo gli Schermagliatori possono entrare negli edifici' };
  if (touched.some((a) => a.kind === 'wood') && u.companies.some((c) => TROOPS[c.type].noWoods && !c.dismountedKnights)) return { ...res, reason: 'I Cavalieri non possono entrare nei boschi' };
  const bad = touched.length > 0 && !ignoresBad;
  res.badGoing = bad;
  let allowance = unitMove(u, bad);
  if (allowance === null) return { ...res, reason: 'Questa truppa non può muoversi in terreno difficile' };
  if (opts.charge) allowance += 4;
  res.allowance = allowance;
  if (distance > allowance + 0.05) return { ...res, reason: `Troppo lontano: ${distance.toFixed(1)}" su ${allowance}" disponibili` };
  if (bad) {
    res.disarray++;
    notes.push(`terreno difficile (${touched.map((a) => areaName(a.kind)).join(', ')})`);
  }
  // Arco frontale
  if (!loose && distance > 0.05 && !opts.evade && !opts.retreat) {
    const dir = bearing(from, to);
    if (Math.abs(angleDiff(dir, u.facing)) > 45.5) {
      if (!(opts.manoeuvre && !bad)) {
        res.disarray++;
        notes.push("movimento fuori dall'arco frontale");
      }
    }
  }
  // Ostacoli lineari
  if (distance > 0.05) {
    const fc0 = frontCenter(unitRect(u));
    const dir = mul(sub(to, from), 1 / distance);
    for (const l of s.terrain.lines) {
      for (let i = 0; i < l.points.length - 1; i++) {
        const a = l.points[i];
        const b = l.points[i + 1];
        const hitFront = segmentIntersection(fc0, add(fc0, sub(to, from)), a, b);
        const hitCentre = segmentIntersection(from, to, a, b);
        const hit = hitFront ?? hitCentre;
        if (!hit) continue;
        const isDefence = l.kind === 'stakes' || l.kind === 'fieldDefence';
        if (isSkirmisher(u)) continue;
        if (loose && !isDefence) continue; // Cavalleria leggera esente dagli ostacoli normali
        if (isCavalry(u) && isDefence) {
          res.disarray += 2;
          notes.push(`attraversa ${lineName(l.kind)} (cavalleria: 2 Disordini)`);
        } else {
          res.disarray++;
          notes.push(`attraversa ${lineName(l.kind)}`);
        }
        // Il movimento termina appena superato l'ostacolo.
        const tHit = dist(hitFront ? fc0 : from, hit);
        const { d } = unitRect(u);
        const stopAt = Math.min(distance, tHit + (hitFront ? d : d / 2) + 0.2);
        if (stopAt < distance - 0.05) {
          to = add(from, mul(dir, stopAt));
          res.truncated = true;
          notes.push(`si ferma dopo l'ostacolo (${stopAt.toFixed(1)}")`);
        }
        break;
      }
      if (res.truncated) break;
    }
  }
  res.dest = { x: to.x, y: to.y, facing };
  // Attraversare unità
  const finalPolys = res.truncated ? sweep(u, from, to, facing) : polys;
  const myArm = crossArm(u);
  for (const o of liveUnits(s)) {
    if (o.id === u.id || o.unplaced || opts.ignoreUnits?.includes(o.id)) continue;
    const op = unitPoly(o);
    const crosses = finalPolys.some((p) => polygonsOverlap(p, op));
    if (!crosses) continue;
    const endOverlap = polygonsOverlap(finalPolys[finalPolys.length - 1], op);
    if (o.side !== u.side) {
      if (opts.allowContact?.includes(o.id)) continue;
      return { ...res, reason: `Non si può attraversare l'unità nemica ${o.name} (usa "Attacca" per entrare in contatto)` };
    }
    if (endOverlap) return { ...res, reason: `Non si può terminare il movimento sopra ${o.name}` };
    const sameArm = crossArm(o) === myArm;
    if (o.meleeId) return { ...res, reason: `${o.name} è in mischia: non si può attraversare` };
    if (!sameArm) {
      if (!isSkirmisher(o)) {
        res.disarray++;
        notes.push(`attraversa ${o.name} (arma diversa)`);
      }
      if (!isSkirmisher(u)) res.disarrayOthers.push(o.id);
    }
  }
  // Sul tavolo
  const endPoly = unitPoly(u, res.dest);
  if (endPoly.some((p) => p.x < -0.01 || p.y < -0.01 || p.x > s.table.width + 0.01 || p.y > s.table.height + 0.01)) {
    if (!opts.evade && !opts.retreat) return { ...res, reason: 'Il movimento porterebbe l\'unità fuori dal tavolo' };
  }
  if (opts.manoeuvre && !bad) {
    // Nessuna penalità di movimento in terreno buono durante la Manovra.
    res.disarray = 0;
  }
  res.ok = true;
  return res;
}

export function areaName(k: string): string {
  return (
    { wood: 'bosco', hill: 'collina', steepHill: 'collina ripida', marsh: 'palude', building: 'edificio', builtUp: 'abitato' } as Record<string, string>
  )[k] ?? k;
}

export function lineName(k: string): string {
  return (
    { hedge: 'siepe', wall: 'muro', stream: 'torrente', fence: 'staccionata', stakes: 'pali', fieldDefence: 'difese campali' } as Record<string, string>
  )[k] ?? k;
}

/** Ruota attorno a uno dei due angoli anteriori. angle > 0 = senso orario (perno a destra? no: perno sinistro). */
export function planWheel(s: GameState, u: Unit, angle: number): { ok: boolean; reason?: string; dest: { x: number; y: number; facing: number }; disarray: number } {
  const r = unitRect(u);
  const corners = rectCorners(r);
  // Ruotando in senso orario il perno è l'angolo anteriore destro, altrimenti il sinistro.
  const pivot = angle >= 0 ? corners[1] : corners[0];
  const rel = sub({ x: r.cx, y: r.cy }, pivot);
  const a = (angle * Math.PI) / 180;
  const rot = { x: rel.x * Math.cos(a) - rel.y * Math.sin(a), y: rel.x * Math.sin(a) + rel.y * Math.cos(a) };
  const c = add(pivot, rot);
  const dest = { x: c.x, y: c.y, facing: normAngle(u.facing + angle) };
  const disarray = Math.abs(angle) > 45.5 && !isLoose(u) ? 1 : 0;
  const poly = unitPoly(u, dest);
  for (const o of liveUnits(s)) {
    if (o.id === u.id || o.unplaced) continue;
    if (polygonsOverlap(poly, unitPoly(o))) return { ok: false, reason: `La conversione urta ${o.name}`, dest, disarray };
  }
  if (poly.some((p) => p.x < 0 || p.y < 0 || p.x > s.table.width || p.y > s.table.height)) return { ok: false, reason: 'Fuori dal tavolo', dest, disarray };
  return { ok: true, dest, disarray };
}

export function leaderAllowance(s: GameState, l: Leader, to: Point): number {
  const from = { x: l.x, y: l.y };
  const n = Math.max(1, Math.ceil(dist(from, to) / 0.5));
  let bad = false;
  for (let i = 0; i <= n; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n };
    if (s.terrain.areas.some((a) => BAD_GOING.includes(a.kind) && pointInPolygon(p, a.points))) bad = true;
  }
  if (bad) return 6;
  return l.mounted ? 12 : 8;
}

/** Posizione di contatto per un attacco: fronte contro fronte, o contro fianco/retro. */
export function contactPosition(attacker: Unit, target: Unit, side: 'front' | 'left' | 'right' | 'rear'): { x: number; y: number; facing: number } {
  const tr = unitRect(target);
  const ar = unitRect(attacker);
  if (side === 'front') {
    const p = fromLocal(tr, { x: 0, y: tr.d / 2 + ar.d / 2 });
    return { x: p.x, y: p.y, facing: normAngle(target.facing + 180) };
  }
  if (side === 'rear') {
    const p = fromLocal(tr, { x: 0, y: -tr.d / 2 - ar.d / 2 });
    return { x: p.x, y: p.y, facing: target.facing };
  }
  if (side === 'left') {
    const p = fromLocal(tr, { x: -tr.w / 2 - ar.d / 2, y: 0 });
    return { x: p.x, y: p.y, facing: normAngle(target.facing + 90) };
  }
  const p = fromLocal(tr, { x: tr.w / 2 + ar.d / 2, y: 0 });
  return { x: p.x, y: p.y, facing: normAngle(target.facing - 90) };
}

/** Da quale lato del bersaglio arriva l'attaccante (divisione per diagonali del rettangolo). */
export function attackSide(attacker: Unit, target: Unit): 'front' | 'left' | 'right' | 'rear' {
  const tr = unitRect(target);
  const l = toLocal(tr, { x: attacker.x, y: attacker.y });
  const nx = l.x / (tr.w / 2);
  const ny = l.y / (tr.d / 2);
  if (Math.abs(ny) >= Math.abs(nx)) return ny >= 0 ? 'front' : 'rear';
  return nx >= 0 ? 'right' : 'left';
}

export function vecLen(p: Point) {
  return len(p);
}

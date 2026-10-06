import { TROOPS } from '../engine/data';
import { fromLocal, type Rect } from '../engine/geometry';
import type { Company, Point, Unit } from '../engine/types';
import { companyDims, perRank, unitRect } from '../engine/units';

export interface FigureBase {
  x: number;
  y: number;
  w: number;
  d: number;
  alive: boolean;
  company: number;
}

/** Posizioni delle basette di ciascuna figura (coordinate del tavolo) per disegnare l'unità. */
export function figureLayout(u: Unit): FigureBase[] {
  const r = unitRect(u);
  const out: FigureBase[] = [];
  const comps = u.companies;
  const place = (c: Company, ci: number, origin: Point, cw: number, cd: number) => {
    const p = TROOPS[c.type];
    const pr = perRank(c);
    const loose = p.arm === 'skirmisher' || c.dismountedLH;
    if (p.arm === 'artillery') {
      out.push({ ...fromLocal(r, { x: origin.x, y: origin.y + cd / 2 - 0.9 }), w: 1.0, d: 1.6, alive: !u.gunDestroyed, company: ci });
      for (let i = 0; i < c.maxFigures; i++) {
        const lx = origin.x - 0.8 + i * 0.8;
        out.push({ ...fromLocal(r, { x: lx, y: origin.y - cd / 2 + 0.5 }), w: 0.6, d: 0.6, alive: i < c.figures, company: ci });
      }
      return;
    }
    const alive = Math.max(0, c.figures);
    const front = Math.max(1, Math.min(pr, alive));
    const bw = loose ? cw / pr : cw / front;
    const ranks = Math.max(1, Math.ceil(c.maxFigures / pr));
    const bd = cd / ranks;
    let idx = 0;
    for (let rk = 0; rk < ranks; rk++) {
      const n = Math.min(pr, Math.max(alive - rk * pr, 0));
      for (let f = 0; f < n; f++) {
        const lx = loose ? origin.x - cw / 2 + bw * (f + 0.5) + Math.sin((idx + 1) * 7.13) * 0.2 : origin.x - (bw * n) / 2 + bw * (f + 0.5);
        const ly = origin.y + cd / 2 - bd * (rk + 0.5) + (loose ? Math.cos((idx + 1) * 3.7) * 0.2 : 0);
        out.push({ ...fromLocal(r, { x: lx, y: ly }), w: bw * (loose ? 0.55 : 0.9), d: bd * (loose ? 0.55 : 0.88), alive: true, company: ci });
        idx++;
      }
    }
  };
  if (comps.length === 1) {
    place(comps[0], 0, { x: 0, y: 0 }, r.w, r.d);
  } else if (u.formation === 'line') {
    const a = companyDims(comps[0]);
    const b = companyDims(comps[1]);
    place(comps[0], 0, { x: -r.w / 2 + a.w / 2, y: 0 }, a.w, r.d);
    place(comps[1], 1, { x: r.w / 2 - b.w / 2, y: 0 }, b.w, r.d);
  } else {
    const a = companyDims(comps[0]);
    const b = companyDims(comps[1]);
    place(comps[0], 0, { x: 0, y: r.d / 2 - a.d / 2 }, a.w, a.d);
    place(comps[1], 1, { x: 0, y: -r.d / 2 + b.d / 2 }, b.w, b.d);
  }
  return out;
}

export function rectPath(r: Rect): string {
  const pts = [
    fromLocal(r, { x: -r.w / 2, y: r.d / 2 }),
    fromLocal(r, { x: r.w / 2, y: r.d / 2 }),
    fromLocal(r, { x: r.w / 2, y: -r.d / 2 }),
    fromLocal(r, { x: -r.w / 2, y: -r.d / 2 }),
  ];
  return 'M' + pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('L') + 'Z';
}

export function polyPath(pts: Point[], close = true): string {
  if (!pts.length) return '';
  return 'M' + pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('L') + (close ? 'Z' : '');
}

/** Curva morbida chiusa attraverso i punti (per boschi e colline). */
export function smoothPath(pts: Point[]): string {
  if (pts.length < 3) return polyPath(pts);
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    if (i === 0) d += `M${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d + 'Z';
}

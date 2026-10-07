import { createContext, useContext, type ReactNode } from 'react';
import { TROOPS } from '../../engine/data';
import { forward, frontCenter, normAngle } from '../../engine/geometry';
import type { AreaFeature, GameState, Leader, LineFeature, Point, Unit } from '../../engine/types';
import { unitRect } from '../../engine/units';
import { figureLayout, polyPath, rectPath, smoothPath } from '../figures';

/** Vista ruotata di 180° (il giocatore B vede il proprio esercito in basso). */
export const FlipCtx = createContext(false);

export function shrink(pts: Point[], k: number): Point[] {
  const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

export function labelRot(f: number) {
  const n = normAngle(f);
  return n > 90 && n < 270 ? n - 180 : n;
}

export function Defs() {
  return (
    <defs>
      <pattern id="grass" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="var(--table)" />
        <circle cx="1" cy="1.2" r="0.09" fill="var(--table-dot)" />
        <circle cx="4.2" cy="2.6" r="0.08" fill="var(--table-dot)" />
        <circle cx="2.6" cy="4.8" r="0.1" fill="var(--table-dot)" />
        <circle cx="5.3" cy="5.4" r="0.07" fill="var(--table-dot)" />
      </pattern>
      <pattern id="trees" width="2.4" height="2.4" patternUnits="userSpaceOnUse">
        <rect width="2.4" height="2.4" fill="var(--wood)" />
        <circle cx="0.7" cy="0.7" r="0.6" fill="var(--wood-dark)" />
        <circle cx="1.8" cy="1.7" r="0.5" fill="var(--wood-dark)" />
        <circle cx="0.6" cy="0.6" r="0.25" fill="var(--wood)" opacity="0.6" />
      </pattern>
      <pattern id="marsh" width="1.6" height="1.2" patternUnits="userSpaceOnUse">
        <rect width="1.6" height="1.2" fill="var(--marsh)" />
        <path d="M0.2,0.8 l0.15,-0.4 M0.45,0.8 l0,-0.45 M0.7,0.8 l-0.15,-0.4" stroke="var(--marsh-dark)" strokeWidth="0.06" />
      </pattern>
      <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
        <stop offset="70%" stopColor="#000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.18" />
      </radialGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.08" dy="0.12" stdDeviation="0.12" floodColor="#000" floodOpacity="0.45" />
      </filter>
      <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="var(--hl)" />
      </marker>
    </defs>
  );
}

export function TableBase({ W, H, zones }: { W: number; H: number; zones: boolean }) {
  return (
    <>
      <rect x={-0.6} y={-0.6} width={W + 1.2} height={H + 1.2} rx={0.4} fill="var(--table-frame)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#grass)" />
      <g opacity={0.18}>
        {Array.from({ length: Math.floor(W / 6) - 1 }, (_, i) => (
          <line key={'gx' + i} x1={(i + 1) * 6} y1={0} x2={(i + 1) * 6} y2={H} stroke="var(--grid)" strokeWidth={0.05} />
        ))}
        {Array.from({ length: Math.floor(H / 6) - 1 }, (_, i) => (
          <line key={'gy' + i} x1={0} y1={(i + 1) * 6} x2={W} y2={(i + 1) * 6} stroke="var(--grid)" strokeWidth={0.05} />
        ))}
      </g>
      {zones && (
        <g pointerEvents="none">
          <rect x={0} y={H - 9} width={W} height={9} fill="var(--side-a)" opacity={0.18} />
          <rect x={0} y={0} width={W} height={9} fill="var(--side-b)" opacity={0.18} />
          <line x1={0} y1={H - 9} x2={W} y2={H - 9} stroke="var(--side-a-edge)" strokeDasharray="0.6 0.4" strokeWidth={0.1} />
          <line x1={0} y1={9} x2={W} y2={9} stroke="var(--side-b)" strokeDasharray="0.6 0.4" strokeWidth={0.1} />
          <line x1={9} y1={0} x2={9} y2={H} stroke="var(--grid)" strokeDasharray="0.5 0.5" strokeWidth={0.08} />
          <line x1={W - 9} y1={0} x2={W - 9} y2={H} stroke="var(--grid)" strokeDasharray="0.5 0.5" strokeWidth={0.08} />
        </g>
      )}
    </>
  );
}

export function AreaView({ a }: { a: AreaFeature }) {
  if (a.kind === 'hill' || a.kind === 'steepHill')
    return (
      <>
        <path d={smoothPath(a.points)} fill="var(--hill)" stroke="var(--hill-edge)" strokeWidth={0.15} />
        <path d={smoothPath(shrink(a.points, 0.66))} fill="var(--hill-top)" stroke="var(--hill-edge)" strokeWidth={0.08} opacity={0.85} />
        {a.kind === 'steepHill' && <path d={smoothPath(shrink(a.points, 0.36))} fill="var(--hill-peak)" stroke="var(--hill-edge)" strokeWidth={0.08} />}
      </>
    );
  if (a.kind === 'wood') return <path d={smoothPath(a.points)} fill="url(#trees)" stroke="var(--wood-dark)" strokeWidth={0.18} />;
  if (a.kind === 'marsh') return <path d={smoothPath(a.points)} fill="url(#marsh)" stroke="var(--marsh-dark)" strokeWidth={0.1} />;
  if (a.kind === 'builtUp') return <path d={polyPath(a.points)} fill="var(--builtup)" stroke="var(--building-edge)" strokeWidth={0.08} strokeDasharray="0.4 0.25" />;
  return (
    <g filter="url(#shadow)">
      <path d={polyPath(a.points)} fill="var(--building)" stroke="var(--building-edge)" strokeWidth={0.12} />
    </g>
  );
}

export function LineView({ l }: { l: LineFeature }) {
  const d = polyPath(l.points, false);
  switch (l.kind) {
    case 'hedge':
      return (
        <>
          <path d={d} fill="none" stroke="var(--hedge)" strokeWidth={0.75} strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} fill="none" stroke="var(--wood-dark)" strokeWidth={0.35} strokeDasharray="0.3 0.25" strokeLinecap="round" />
        </>
      );
    case 'wall':
      return (
        <>
          <path d={d} fill="none" stroke="var(--wall-dark)" strokeWidth={0.55} strokeLinecap="square" />
          <path d={d} fill="none" stroke="var(--wall)" strokeWidth={0.35} strokeDasharray="0.5 0.08" strokeLinecap="square" />
        </>
      );
    case 'stream':
      return <path d={d} fill="none" stroke="var(--water)" strokeWidth={0.9} strokeLinecap="round" strokeLinejoin="round" />;
    case 'fence':
      return <path d={d} fill="none" stroke="var(--fence)" strokeWidth={0.18} strokeDasharray="0.6 0.15" />;
    case 'stakes':
      return <path d={d} fill="none" stroke="var(--stakes)" strokeWidth={0.4} strokeDasharray="0.1 0.22" />;
    default:
      return <path d={d} fill="none" stroke="var(--defence)" strokeWidth={0.6} strokeDasharray="1 0.2" />;
  }
}

export type UnitLook = 'normal' | 'ready' | 'spent' | 'blocked';

export function UnitView({ s, u, selected, look, hl }: { s: GameState; u: Unit; selected: boolean; look: UnitLook; hl?: 'target' | 'target-no' | null }) {
  const r = unitRect(u);
  const figs = figureLayout(u);
  const fc = frontCenter(r);
  const f = forward(u.facing);
  const rt = { x: Math.cos((u.facing * Math.PI) / 180), y: Math.sin((u.facing * Math.PI) / 180) };
  const flip = useContext(FlipCtx);
  // Segnalini sul fianco destro, frecce sul sinistro.
  const side0 = { x: u.x + rt.x * (r.w / 2 + 0.75) + f.x * (r.d / 2 - 0.5), y: u.y + rt.y * (r.w / 2 + 0.75) + f.y * (r.d / 2 - 0.5) };
  const tokens: ReactNode[] = [];
  let ti = 0;
  const tokenAt = () => {
    const o = ti * 1.15;
    ti++;
    return { x: side0.x + rt.x * o, y: side0.y + rt.y * o };
  };
  for (let i = 0; i < u.disarray; i++) tokens.push(<Token key={'d' + i} p={tokenAt()} cls="tok-dis" t="D" />);
  if (u.rumourDisarray) tokens.push(<Token key="r" p={tokenAt()} cls="tok-dis" t="V" />);
  if (u.daunted) tokens.push(<Token key="s" p={tokenAt()} cls="tok-daunt" t="S" />);
  if (u.ordered || u.initiative) tokens.push(<Token key="o" p={tokenAt()} cls={`tok-order side-${u.side}`} t={u.initiative ? 'I' : 'O'} />);
  const arrows = u.companies.find((c) => c.type === 'archers')?.arrows;
  const t0 = TROOPS[u.companies[0].type];
  const label = u.companies.map((c) => (c.dismountedKnights ? 'UdA*' : TROOPS[c.type].short)).join('+');
  const lr = flip ? labelRot(u.facing + 180) - 180 : labelRot(u.facing);
  const tray = rectPath({ ...r, w: r.w + 0.2, d: r.d + 0.2 });
  return (
    <g className={`unit side-${u.side} look-${look} ${selected ? 'selected' : ''} ${hl ?? ''}`} data-unit={u.id}>
      <path d={rectPath({ ...r, w: r.w + 1.2, d: r.d + 1.2 })} className="unit-hit" />
      {(selected || look === 'ready' || hl) && <path d={rectPath({ ...r, w: r.w + 0.7, d: r.d + 0.7 })} className="unit-ring" />}
      <path d={tray} className="unit-tray" filter="url(#shadow)" />
      {figs.map((b, i) => (
        <rect
          key={i}
          x={b.x - b.w / 2}
          y={b.y - b.d / 2}
          width={b.w}
          height={b.d}
          rx={t0.arm === 'cavalry' ? 0.18 : 0.12}
          transform={`rotate(${u.facing} ${b.x} ${b.y})`}
          className={`fig fig-${t0.arm} ${u.gunDestroyed && i === 0 ? 'destroyed' : ''}`}
        />
      ))}
      <line x1={fc.x - rt.x * (r.w / 2 + 0.1)} y1={fc.y - rt.y * (r.w / 2 + 0.1)} x2={fc.x + rt.x * (r.w / 2 + 0.1)} y2={fc.y + rt.y * (r.w / 2 + 0.1)} className="front-line" />
      <g transform={`rotate(${lr} ${u.x} ${u.y})`} pointerEvents="none">
        <rect x={u.x - label.length * 0.33 - 0.3} y={u.y - 0.55} width={label.length * 0.66 + 0.6} height={1.1} rx={0.5} className="unit-label-bg" />
        <text x={u.x} y={u.y + 0.33} fontSize={0.9} textAnchor="middle" className="unit-label">
          {label}
        </text>
      </g>
      {tokens}
      {arrows !== undefined && (
        <g transform={`translate(${u.x - rt.x * (r.w / 2 + 0.8) + f.x * (r.d / 2 - 0.55)},${u.y - rt.y * (r.w / 2 + 0.8) + f.y * (r.d / 2 - 0.55)})${flip ? ' rotate(180)' : ''}`} pointerEvents="none">
          <rect x={-0.55} y={-0.55} width={1.1} height={1.1} rx={0.22} className="tok-arrows" />
          <text y={0.35} fontSize={0.9} textAnchor="middle" className="tok-text dark">
            {arrows}
          </text>
        </g>
      )}
    </g>
  );
}

export function Token({ p, cls, t }: { p: Point; cls: string; t: string }) {
  const flip = useContext(FlipCtx);
  return (
    <g transform={`translate(${p.x},${p.y})${flip ? ' rotate(180)' : ''}`} pointerEvents="none">
      <circle r={0.52} className={`tok ${cls}`} />
      <text y={0.32} fontSize={0.8} textAnchor="middle" className="tok-text">
        {t}
      </text>
    </g>
  );
}

export function LeaderView({ l, s, selected, ready }: { l: Leader; s: GameState; selected: boolean; ready: boolean }) {
  const active = s.activation?.leaderId === l.id;
  const flip = useContext(FlipCtx);
  return (
    <g className={`leader side-${l.side} ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${ready ? 'ready' : ''}`} transform={`translate(${l.x},${l.y})${flip ? ' rotate(180)' : ''}`} data-leader={l.id}>
      <circle r={0.95} className="leader-hit" />
      {active && <circle r={1.05} className="leader-halo" />}
      <path d="M-0.7,-0.75 L0.7,-0.75 L0.7,0.1 Q0.7,0.75 0,1 Q-0.7,0.75 -0.7,0.1 Z" className="leader-shield" filter="url(#shadow)" />
      <text y={0.32} fontSize={0.85} textAnchor="middle" className="leader-text">
        {l.isCinC ? '♛' : l.mounted ? '♞' : '★'}
      </text>
      <text x={0.85} y={0.2} fontSize={0.55} textAnchor="start" className="leader-class" pointerEvents="none">
        {'★'.repeat(Math.max(0, l.cls))}
      </text>
    </g>
  );
}

export function Label({ at, text, bad, dy = 2.4 }: { at: Point; text: string; bad?: boolean; dy?: number }) {
  const flip = useContext(FlipCtx);
  const w = Math.max(3, text.length * 0.5 + 1);
  return (
    <g pointerEvents="none" transform={flip ? `translate(${at.x},${at.y + dy}) rotate(180)` : `translate(${at.x},${at.y - dy})`}>
      <rect x={-w / 2} y={-0.95} width={w} height={1.5} rx={0.6} className={bad ? 'label-bg bad' : 'label-bg'} />
      <text x={0} y={0.15} fontSize={0.85} textAnchor="middle" className={bad ? 'label-text bad' : 'label-text'}>
        {text}
      </text>
    </g>
  );
}

export function FacingTick({ u, at }: { u: Unit; at: { x: number; y: number; facing: number } }) {
  const r = unitRect(u, at);
  const fc = frontCenter(r);
  const f = forward(at.facing);
  return <line x1={fc.x} y1={fc.y} x2={fc.x + f.x * 1.6} y2={fc.y + f.y * 1.6} stroke="var(--hl)" strokeWidth={0.2} markerEnd="url(#arrow)" />;
}

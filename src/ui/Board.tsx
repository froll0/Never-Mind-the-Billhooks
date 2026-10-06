import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TROOPS } from '../engine/data';
import { closestPointOnPolygon, dist, ellipsePolygon, forward, frontCenter, normAngle, pointInPolygon, distPointSegment, bearing } from '../engine/geometry';
import { checkAttack } from '../engine/melee';
import { leaderAllowance, planMove } from '../engine/movement';
import { validTargets } from '../engine/shooting';
import type { GameState, Leader, Point, Side, Unit } from '../engine/types';
import { otherSide } from '../engine/types';
import { isLoose, leaderOf, liveLeaders, liveUnits, unitPoly, unitRect } from '../engine/units';
import { figureLayout, polyPath, rectPath, smoothPath } from './figures';
import type { Selection, Tool } from './tools';
import type { IntentIn } from './useGame';

interface Props {
  state: GameState;
  me: Side;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  dispatch: (it: IntentIn) => boolean;
  onPickUnit: (u: Unit) => void;
  onPickLeader: (l: Leader) => void;
  onPickFeature: (id: string) => void;
}

const SIDE_FILL: Record<Side, string> = { A: 'var(--side-a)', B: 'var(--side-b)' };

/** Vista ruotata di 180° (il giocatore B vede il proprio esercito in basso). */
const FlipCtx = createContext(false);

export function Board(p: Props) {
  const { state: s, tool } = p;
  const W = s.table.width;
  const H = s.table.height;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: -1, y: -1, w: W + 2, h: H + 2 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [ghostFacing, setGhostFacing] = useState<number | null>(null);
  const [flipPref, setFlipPref] = useState<boolean | null>(null);
  const flip = flipPref ?? p.me === 'B';

  // Ruota l'anteprima con Q/E (5° con Maiusc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const step = e.shiftKey ? 5 : 15;
      if (e.key === 'q' || e.key === 'Q') rotate(-step);
      if (e.key === 'e' || e.key === 'E') rotate(step);
      if (e.key === 'Escape') {
        p.setTool({ k: 'none' });
        setGhostFacing(null);
      }
      if (e.key === 'Enter' && (tool.k === 'line' || tool.k === 'defence')) finishLine();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => setGhostFacing(null), [tool.k, (tool as any).unitId]);

  function rotate(delta: number) {
    if (tool.k === 'place') p.setTool({ ...tool, facing: normAngle(tool.facing + delta) });
    if (tool.k === 'move') {
      const u = s.units[tool.unitId];
      if (u && isLoose(u)) setGhostFacing(normAngle((ghostFacing ?? u.facing) + delta));
    }
  }

  function toWorld(e: { clientX: number; clientY: number }): Point {
    const r = toSvg(e);
    return flip ? { x: W - r.x, y: H - r.y } : r;
  }

  function toSvg(e: { clientX: number; clientY: number }): Point {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const r = pt.matrixTransform(m.inverse());
    return { x: r.x, y: r.y };
  }

  function onWheel(e: React.WheelEvent) {
    const w = toSvg(e);
    const k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const nw = Math.max(10, Math.min(W * 1.6, view.w * k));
    const nh = nw * (view.h / view.w);
    setView({ x: w.x - ((w.x - view.x) * nw) / view.w, y: w.y - ((w.y - view.y) * nh) / view.h, w: nw, h: nh });
  }

  function finishLine() {
    if (tool.k === 'line' && tool.points.length >= 2) {
      p.dispatch({ t: 'addLine', feature: { kind: tool.kind, points: tool.points } });
      p.setTool({ ...tool, points: [] });
    }
    if (tool.k === 'defence' && tool.points.length >= 2) {
      p.dispatch({ t: 'placeDefence', kind: tool.kind, points: tool.points });
      p.setTool({ ...tool, points: [] });
    }
  }

  const myUnits = liveUnits(s, p.me);
  const units = liveUnits(s).filter((u) => !u.unplaced);
  const leaders = liveLeaders(s).filter((l) => !l.unplaced);

  // ------------------------------------------------------------- anteprime
  const preview = useMemo(() => {
    if (!cursor) return null;
    if (tool.k === 'move') {
      const u = s.units[tool.unitId];
      if (!u) return null;
      const facing = isLoose(u) ? (ghostFacing ?? (dist(cursor, u) > 0.5 ? bearing(u, cursor) : u.facing)) : u.facing;
      const plan = planMove(s, u, { x: cursor.x, y: cursor.y, facing }, { manoeuvre: s.phase === 'manoeuvre' });
      return { kind: 'move' as const, u, plan, facing };
    }
    if (tool.k === 'place') {
      const u = s.units[tool.unitId];
      if (!u) return null;
      return { kind: 'place' as const, u, at: { x: cursor.x, y: cursor.y, facing: tool.facing } };
    }
    if (tool.k === 'leaderMove') {
      const l = s.leaders[tool.leaderId];
      if (!l) return null;
      return { kind: 'leader' as const, l, allowance: leaderAllowance(s, l, cursor) };
    }
    return null;
  }, [cursor, tool, s, ghostFacing]);

  const attackInfo = useMemo(() => {
    if (tool.k !== 'attack') return null;
    const u = s.units[tool.unitId];
    if (!u) return null;
    const res: Record<string, ReturnType<typeof checkAttack>> = {};
    for (const t of liveUnits(s, otherSide(u.side))) if (!t.unplaced) res[t.id] = checkAttack(s, u, t, { charge: tool.charge, manoeuvre: s.phase === 'manoeuvre' });
    return res;
  }, [tool, s]);

  const shootInfo = useMemo(() => {
    if (tool.k !== 'shoot') return null;
    const u = s.units[tool.unitId];
    if (!u) return null;
    const res: Record<string, { allowed: boolean; why?: string; range?: number; dice?: number; hitOn?: number }> = {};
    for (const v of validTargets(s, u)) res[v.target.id] = { allowed: v.allowed, why: v.why, range: v.check.range, dice: v.check.dice, hitOn: v.check.hitOn };
    return res;
  }, [tool, s]);

  // ------------------------------------------------------------- input
  function onBgDown(e: React.PointerEvent) {
    if (e.button === 1 || e.button === 2 || (tool.k === 'none' && e.button === 0)) {
      setDrag({ sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    const w = toWorld(e);
    if (tool.k === 'area') p.setTool({ ...tool, start: w });
    if (tool.k === 'measure') p.setTool({ ...tool, start: w });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (drag) {
      const svg = svgRef.current!;
      const scale = view.w / svg.clientWidth;
      setView({ ...view, x: drag.vx - (e.clientX - drag.sx) * scale, y: drag.vy - (e.clientY - drag.sy) * scale });
      return;
    }
    setCursor(toWorld(e));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (drag) {
      const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
      setDrag(null);
      if (moved < 4 && e.button === 0 && tool.k === 'none') p.setSelection(null);
      return;
    }
    const w = toWorld(e);
    if (tool.k === 'area' && tool.start) {
      const a = tool.start;
      const rx = Math.abs(w.x - a.x) / 2;
      const ry = Math.abs(w.y - a.y) / 2;
      if (rx > 0.5 && ry > 0.5) {
        const cx = (a.x + w.x) / 2;
        const cy = (a.y + w.y) / 2;
        const rect = tool.kind === 'building';
        const points = rect
          ? [{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy - ry }, { x: cx + rx, y: cy + ry }, { x: cx - rx, y: cy + ry }]
          : ellipsePolygon(cx, cy, rx, ry, 20, tool.kind === 'wood' || tool.kind === 'marsh' ? 0.1 : 0.04);
        p.dispatch({ t: 'addArea', feature: { kind: tool.kind, points } });
      }
      p.setTool({ k: 'area', kind: tool.kind });
      return;
    }
    if (tool.k === 'measure') {
      p.setTool({ k: 'measure' });
      return;
    }
  }

  function onBgClick(e: React.MouseEvent) {
    const w = toWorld(e);
    if (tool.k === 'move' && preview?.kind === 'move') {
      if (p.dispatch({ t: 'move', unitId: tool.unitId, x: preview.plan.dest.x, y: preview.plan.dest.y, facing: preview.facing })) p.setTool({ k: 'none' });
      return;
    }
    if (tool.k === 'place') {
      if (p.dispatch({ t: 'place', unitId: tool.unitId, x: w.x, y: w.y, facing: tool.facing })) {
        const next = myUnits.find((u) => u.unplaced && u.id !== tool.unitId);
        p.setTool(next ? { k: 'place', unitId: next.id, facing: tool.facing } : { k: 'none' });
      }
      return;
    }
    if (tool.k === 'placeLeader') {
      if (p.dispatch({ t: 'placeLeader', leaderId: tool.leaderId, x: w.x, y: w.y })) p.setTool({ k: 'none' });
      return;
    }
    if (tool.k === 'leaderMove') {
      if (p.dispatch({ t: 'leaderMove', leaderId: tool.leaderId, x: w.x, y: w.y })) p.setTool({ k: 'none' });
      return;
    }
    if (tool.k === 'line' || tool.k === 'defence') {
      p.setTool({ ...tool, points: [...tool.points, w] } as Tool);
      return;
    }
    if (tool.k === 'manualMove') {
      if (tool.unitId) {
        const u = s.units[tool.unitId];
        p.dispatch({ t: 'manualUnit', unitId: tool.unitId, patch: { x: w.x, y: w.y, facing: ghostFacing ?? u.facing } });
        p.setTool({ k: 'manualMove' });
      } else if (tool.leaderId) {
        p.dispatch({ t: 'manualLeader', leaderId: tool.leaderId, patch: { x: w.x, y: w.y, attachedTo: null } });
        p.setTool({ k: 'manualMove' });
      }
      return;
    }
  }

  function onUnitClick(e: React.MouseEvent, u: Unit) {
    e.stopPropagation();
    if (tool.k === 'attack') {
      if (u.side !== s.units[tool.unitId]?.side) {
        if (p.dispatch({ t: 'attack', unitId: tool.unitId, targetId: u.id, charge: tool.charge })) p.setTool({ k: 'none' });
      }
      return;
    }
    if (tool.k === 'shoot') {
      if (u.side !== p.me) {
        const ok = tool.free ? p.dispatch({ t: 'freeAction', unitId: tool.unitId, kind: 'shoot', targetId: u.id }) : p.dispatch({ t: 'shoot', unitId: tool.unitId, targetId: u.id });
        if (ok) p.setTool({ k: 'none' });
      }
      return;
    }
    if (tool.k === 'leaderMove') {
      if (u.side === p.me && p.dispatch({ t: 'leaderMove', leaderId: tool.leaderId, x: u.x, y: u.y, attachTo: u.id })) p.setTool({ k: 'none' });
      return;
    }
    if (tool.k === 'placeLeader') {
      if (p.dispatch({ t: 'placeLeader', leaderId: tool.leaderId, x: u.x, y: u.y, attachTo: u.id })) p.setTool({ k: 'none' });
      return;
    }
    if (tool.k === 'pickUnit') {
      p.onPickUnit(u);
      return;
    }
    if (tool.k === 'manualMove') {
      p.setTool({ k: 'manualMove', unitId: u.id });
      setGhostFacing(u.facing);
      return;
    }
    if (tool.k === 'move' || tool.k === 'place' || tool.k === 'line' || tool.k === 'area') return;
    p.setSelection({ kind: 'unit', id: u.id });
  }

  function onLeaderClick(e: React.MouseEvent, l: Leader) {
    e.stopPropagation();
    if (tool.k === 'pickLeader') {
      p.onPickLeader(l);
      return;
    }
    if (tool.k === 'manualMove') {
      p.setTool({ k: 'manualMove', leaderId: l.id });
      return;
    }
    if (tool.k === 'attack' && !l.attachedTo && l.side !== p.me) {
      if (p.dispatch({ t: 'attackLeader', unitId: tool.unitId, leaderId: l.id })) p.setTool({ k: 'none' });
      return;
    }
    if (l.attachedTo && tool.k !== 'none') {
      onUnitClick(e, s.units[l.attachedTo]);
      return;
    }
    p.setSelection({ kind: 'leader', id: l.id });
  }

  function onFeatureClick(e: React.MouseEvent, id: string) {
    if (tool.k !== 'pickFeature') return;
    e.stopPropagation();
    p.onPickFeature(id);
  }

  // ------------------------------------------------------------- rendering
  const selUnit = p.selection?.kind === 'unit' ? s.units[p.selection.id] : undefined;
  const selLeader = p.selection?.kind === 'leader' ? s.leaders[p.selection.id] : undefined;
  const hoverUnit = hover ? s.units[hover] : undefined;

  const zones = s.phase === 'deploy' || s.phase === 'setup' || s.phase === 'terrain';

  return (
    <div className="board-wrap">
      <svg
        ref={svgRef}
        data-flip={flip ? '1' : '0'}
        className={`board tool-${tool.k}`}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onBgDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onClick={onBgClick}
        onDoubleClick={() => finishLine()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grass" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="var(--table)" />
            <circle cx="1" cy="1" r="0.08" fill="var(--table-dot)" />
            <circle cx="3" cy="2.6" r="0.07" fill="var(--table-dot)" />
          </pattern>
          <pattern id="trees" width="2.2" height="2.2" patternUnits="userSpaceOnUse">
            <rect width="2.2" height="2.2" fill="var(--wood)" />
            <circle cx="0.7" cy="0.7" r="0.55" fill="var(--wood-dark)" />
            <circle cx="1.7" cy="1.6" r="0.45" fill="var(--wood-dark)" />
          </pattern>
          <pattern id="marsh" width="1.6" height="1.2" patternUnits="userSpaceOnUse">
            <rect width="1.6" height="1.2" fill="var(--marsh)" />
            <path d="M0.2,0.8 l0.15,-0.4 M0.45,0.8 l0,-0.45 M0.7,0.8 l-0.15,-0.4" stroke="var(--marsh-dark)" strokeWidth="0.06" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
        </defs>
        <FlipCtx.Provider value={flip}>
        <g transform={flip ? `rotate(180 ${W / 2} ${H / 2})` : undefined}>
        <rect x={0} y={0} width={W} height={H} fill="url(#grass)" stroke="var(--table-edge)" strokeWidth={0.3} />
        {/* griglia leggera ogni 6" */}
        <g opacity={0.25}>
          {Array.from({ length: Math.floor(W / 6) - 1 }, (_, i) => (
            <line key={'gx' + i} x1={(i + 1) * 6} y1={0} x2={(i + 1) * 6} y2={H} stroke="var(--grid)" strokeWidth={0.05} />
          ))}
          {Array.from({ length: Math.floor(H / 6) - 1 }, (_, i) => (
            <line key={'gy' + i} x1={0} y1={(i + 1) * 6} x2={W} y2={(i + 1) * 6} stroke="var(--grid)" strokeWidth={0.05} />
          ))}
        </g>
        {zones && (
          <g>
            <rect x={0} y={H - 9} width={W} height={9} fill="var(--side-a)" opacity={0.12} />
            <rect x={0} y={0} width={W} height={9} fill="var(--side-b)" opacity={0.12} />
            <line x1={9} y1={0} x2={9} y2={H} stroke="var(--grid)" strokeDasharray="0.5 0.5" strokeWidth={0.08} />
            <line x1={W - 9} y1={0} x2={W - 9} y2={H} stroke="var(--grid)" strokeDasharray="0.5 0.5" strokeWidth={0.08} />
          </g>
        )}
        {/* terreno */}
        {s.terrain.areas.map((a) => (
          <g key={a.id} onClick={(e) => onFeatureClick(e, a.id)} className={tool.k === 'pickFeature' ? 'pickable' : ''}>
            {a.kind === 'hill' || a.kind === 'steepHill' ? (
              <>
                <path d={smoothPath(a.points)} fill="var(--hill)" stroke="var(--hill-edge)" strokeWidth={0.15} />
                <path d={smoothPath(shrink(a.points, 0.65))} fill="var(--hill-top)" stroke="var(--hill-edge)" strokeWidth={0.08} opacity={0.8} />
                {a.kind === 'steepHill' && <path d={smoothPath(shrink(a.points, 0.35))} fill="none" stroke="var(--hill-edge)" strokeWidth={0.08} />}
              </>
            ) : a.kind === 'wood' ? (
              <path d={smoothPath(a.points)} fill="url(#trees)" stroke="var(--wood-dark)" strokeWidth={0.15} />
            ) : a.kind === 'marsh' ? (
              <path d={smoothPath(a.points)} fill="url(#marsh)" stroke="var(--marsh-dark)" strokeWidth={0.1} />
            ) : (
              <path d={polyPath(a.points)} fill={a.kind === 'building' ? 'var(--building)' : 'var(--builtup)'} stroke="var(--building-edge)" strokeWidth={0.12} />
            )}
          </g>
        ))}
        {s.terrain.lines.map((l) => (
          <g key={l.id} onClick={(e) => onFeatureClick(e, l.id)} className={tool.k === 'pickFeature' ? 'pickable' : ''}>
            <path d={polyPath(l.points, false)} fill="none" stroke="transparent" strokeWidth={1.2} />
            <LineFeatureView kind={l.kind} points={l.points} />
          </g>
        ))}
        {/* mischie */}
        {Object.values(s.melees).map((m) => {
          const a = s.units[m.attackers[0]];
          const d = s.units[m.defenders[0]];
          if (!a || !d) return null;
          const mx = (a.x + d.x) / 2;
          const my = (a.y + d.y) / 2;
          return (
            <g key={m.id} pointerEvents="none">
              <text x={mx} y={my + 0.5} fontSize={1.6} textAnchor="middle" className="melee-icon" transform={flip ? `rotate(180 ${mx} ${my})` : undefined}>
                ⚔
              </text>
            </g>
          );
        })}
        {/* unità */}
        {units.map((u) => (
          <UnitView
            key={u.id}
            s={s}
            u={u}
            me={p.me}
            selected={selUnit?.id === u.id}
            highlight={attackInfo?.[u.id]?.ok ? 'attack' : shootInfo?.[u.id] ? (shootInfo[u.id].allowed ? 'shoot' : 'shoot-no') : null}
            onClick={(e) => onUnitClick(e, u)}
            onHover={(h) => setHover(h ? u.id : null)}
          />
        ))}
        {/* comandanti */}
        {leaders.map((l) => (
          <LeaderView key={l.id} l={l} s={s} selected={selLeader?.id === l.id} onClick={(e) => onLeaderClick(e, l)} />
        ))}
        {/* raggio di comando */}
        {selLeader && <circle cx={selLeader.x} cy={selLeader.y} r={6} fill="none" stroke="var(--accent)" strokeDasharray="0.4 0.3" strokeWidth={0.1} pointerEvents="none" />}
        {selUnit && leaderOf(s, selUnit) === undefined && null}
        {/* anteprime */}
        {preview?.kind === 'move' && (
          <g pointerEvents="none">
            <circle cx={preview.u.x} cy={preview.u.y} r={preview.plan.allowance || 0} fill="none" stroke="var(--accent)" strokeWidth={0.08} strokeDasharray="0.3 0.3" opacity={0.6} />
            <path d={rectPath(unitRect(preview.u, preview.plan.dest))} className={preview.plan.ok ? 'ghost ok' : 'ghost bad'} />
            <line x1={preview.u.x} y1={preview.u.y} x2={preview.plan.dest.x} y2={preview.plan.dest.y} stroke="var(--accent)" strokeWidth={0.1} markerEnd="url(#arrow)" />
            <Label at={preview.plan.dest} text={preview.plan.ok ? `${preview.plan.distance.toFixed(1)}"${preview.plan.disarray ? ` · +${preview.plan.disarray} Disordine` : ''}` : preview.plan.reason ?? ''} bad={!preview.plan.ok} />
          </g>
        )}
        {preview?.kind === 'place' && (
          <g pointerEvents="none">
            <path d={rectPath(unitRect(preview.u, preview.at))} className="ghost ok" />
            <FacingTick u={preview.u} at={preview.at} />
          </g>
        )}
        {preview?.kind === 'leader' && cursor && (
          <g pointerEvents="none">
            <circle cx={preview.l.x} cy={preview.l.y} r={preview.allowance} fill="none" stroke="var(--accent)" strokeWidth={0.08} strokeDasharray="0.3 0.3" />
            <circle cx={cursor.x} cy={cursor.y} r={0.6} className={dist(preview.l, cursor) <= preview.allowance ? 'ghost ok' : 'ghost bad'} />
            <Label at={cursor} text={`${dist(preview.l, cursor).toFixed(1)}" / ${preview.allowance}"`} bad={dist(preview.l, cursor) > preview.allowance} />
          </g>
        )}
        {tool.k === 'manualMove' && tool.unitId && cursor && (
          <path d={rectPath(unitRect(s.units[tool.unitId], { x: cursor.x, y: cursor.y, facing: ghostFacing ?? s.units[tool.unitId].facing }))} className="ghost ok" pointerEvents="none" />
        )}
        {tool.k === 'area' && tool.start && cursor && (
          <rect x={Math.min(tool.start.x, cursor.x)} y={Math.min(tool.start.y, cursor.y)} width={Math.abs(cursor.x - tool.start.x)} height={Math.abs(cursor.y - tool.start.y)} className="ghost ok" pointerEvents="none" />
        )}
        {(tool.k === 'line' || tool.k === 'defence') && tool.points.length > 0 && (
          <path d={polyPath(cursor ? [...tool.points, cursor] : tool.points, false)} fill="none" stroke="var(--accent)" strokeWidth={0.25} strokeDasharray="0.4 0.2" pointerEvents="none" />
        )}
        {tool.k === 'measure' && tool.start && cursor && (
          <g pointerEvents="none">
            <line x1={tool.start.x} y1={tool.start.y} x2={cursor.x} y2={cursor.y} stroke="var(--accent)" strokeWidth={0.15} />
            <Label at={cursor} text={`${dist(tool.start, cursor).toFixed(1)}"`} />
          </g>
        )}
        {tool.k === 'attack' && hover && attackInfo?.[hover] && (
          <g pointerEvents="none">
            {attackInfo[hover].ok && attackInfo[hover].dest && <path d={rectPath(unitRect(s.units[tool.unitId], attackInfo[hover].dest!))} className="ghost ok" />}
            <Label at={s.units[hover]} text={attackInfo[hover].ok ? `${attackInfo[hover].distance!.toFixed(1)}" — ${attackInfo[hover].side === 'front' ? 'di fronte' : attackInfo[hover].side === 'rear' ? 'alle spalle' : 'sul fianco'}${tool.charge ? (attackInfo[hover].chargeBonus ? ' (carica con bonus)' : ' (carica senza bonus)') : ''}` : attackInfo[hover].reason ?? ''} bad={!attackInfo[hover].ok} />
          </g>
        )}
        {tool.k === 'shoot' && hover && shootInfo?.[hover] && (
          <Label at={s.units[hover]} text={shootInfo[hover].allowed ? `${shootInfo[hover].range?.toFixed(1)}" · ${shootInfo[hover].dice} dadi, colpisce con ${shootInfo[hover].hitOn}+` : shootInfo[hover].why ?? ''} bad={!shootInfo[hover].allowed} />
        )}
        {tool.k === 'shoot' && hover && !shootInfo?.[hover] && s.units[hover]?.side !== p.me && <Label at={s.units[hover]} text="Bersaglio non valido (fuori arco, portata o vista)" bad />}
        </g>
        </FlipCtx.Provider>
        {cursor && tool.k !== 'none' && (
          <text x={view.x + 0.6} y={view.y + view.h - 0.6} fontSize={1} className="coords">
            {cursor.x.toFixed(1)}", {cursor.y.toFixed(1)}"
          </text>
        )}
      </svg>
      {hoverUnit && tool.k === 'none' && <UnitTooltip s={s} u={hoverUnit} me={p.me} />}
      <button className="small flip-btn" onClick={() => setFlipPref(!flip)} title="Ruota la vista del tavolo di 180°">
        ⟲ Ruota vista
      </button>
      <div className="board-help">
        Rotella: zoom · trascina: sposta la vista{tool.k === 'place' || tool.k === 'move' || tool.k === 'manualMove' ? ' · Q/E: ruota (Maiusc = 5°)' : ''}
        {tool.k === 'line' || tool.k === 'defence' ? ' · clic per i punti, doppio clic o Invio per finire' : ''} · Esc: annulla
      </div>
    </div>
  );
}

function shrink(pts: Point[], k: number): Point[] {
  const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

function Label({ at, text, bad }: { at: Point; text: string; bad?: boolean }) {
  const flip = useContext(FlipCtx);
  const w = Math.max(3, text.length * 0.48);
  return (
    <g pointerEvents="none" transform={flip ? `translate(${at.x},${at.y + 2.2}) rotate(180)` : `translate(${at.x},${at.y - 2.2})`}>
      <rect x={-w / 2} y={-0.9} width={w} height={1.4} rx={0.3} className={bad ? 'label-bg bad' : 'label-bg'} />
      <text x={0} y={0.15} fontSize={0.85} textAnchor="middle" className="label-text">
        {text}
      </text>
    </g>
  );
}

function FacingTick({ u, at }: { u: Unit; at: { x: number; y: number; facing: number } }) {
  const r = unitRect(u, at);
  const fc = frontCenter(r);
  const f = forward(at.facing);
  return <line x1={fc.x} y1={fc.y} x2={fc.x + f.x * 1.5} y2={fc.y + f.y * 1.5} stroke="var(--accent)" strokeWidth={0.2} markerEnd="url(#arrow)" />;
}

function LineFeatureView({ kind, points }: { kind: string; points: Point[] }) {
  const d = polyPath(points, false);
  switch (kind) {
    case 'hedge':
      return (
        <>
          <path d={d} fill="none" stroke="var(--hedge)" strokeWidth={0.7} strokeLinecap="round" />
          <path d={d} fill="none" stroke="var(--wood-dark)" strokeWidth={0.35} strokeDasharray="0.3 0.25" strokeLinecap="round" />
        </>
      );
    case 'wall':
      return <path d={d} fill="none" stroke="var(--wall)" strokeWidth={0.45} strokeLinecap="square" />;
    case 'stream':
      return <path d={d} fill="none" stroke="var(--water)" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />;
    case 'fence':
      return <path d={d} fill="none" stroke="var(--fence)" strokeWidth={0.18} strokeDasharray="0.6 0.15" />;
    case 'stakes':
      return <path d={d} fill="none" stroke="var(--stakes)" strokeWidth={0.35} strokeDasharray="0.12 0.25" />;
    default:
      return <path d={d} fill="none" stroke="var(--defence)" strokeWidth={0.6} strokeDasharray="1 0.2" />;
  }
}

function UnitView({ s, u, me, selected, highlight, onClick, onHover }: { s: GameState; u: Unit; me: Side; selected: boolean; highlight: 'attack' | 'shoot' | 'shoot-no' | null; onClick: (e: React.MouseEvent) => void; onHover: (h: boolean) => void }) {
  const r = unitRect(u);
  const figs = figureLayout(u);
  const fill = SIDE_FILL[u.side];
  const fc = frontCenter(r);
  const f = forward(u.facing);
  const rt = { x: Math.cos((u.facing * Math.PI) / 180), y: Math.sin((u.facing * Math.PI) / 180) };
  // Segnalini sul fianco destro, frecce sul sinistro.
  const side0 = { x: u.x + rt.x * (r.w / 2 + 0.7) + f.x * (r.d / 2 - 0.5), y: u.y + rt.y * (r.w / 2 + 0.7) + f.y * (r.d / 2 - 0.5) };
  const tokens: ReactNode[] = [];
  let ti = 0;
  const tokenAt = () => {
    const o = ti * 1.1;
    ti++;
    return { x: side0.x + rt.x * o, y: side0.y + rt.y * o };
  };
  for (let i = 0; i < u.disarray; i++) {
    const p = tokenAt();
    tokens.push(<Token key={'d' + i} p={p} cls="tok-dis" t="D" />);
  }
  if (u.rumourDisarray) tokens.push(<Token key="r" p={tokenAt()} cls="tok-dis" t="V" />);
  if (u.daunted) tokens.push(<Token key="s" p={tokenAt()} cls="tok-daunt" t="S" />);
  if (u.ordered || u.initiative) tokens.push(<Token key="o" p={tokenAt()} cls={`tok-order side-${u.side}`} t={u.initiative ? 'I' : 'O'} />);
  const arrows = u.companies.find((c) => c.type === 'archers')?.arrows;
  const t0 = TROOPS[u.companies[0].type];
  const label = u.companies.map((c) => (c.dismountedKnights ? 'UdA*' : TROOPS[c.type].short)).join('+');
  const actionsBadge = u.actionsLeft > 0 && u.side === me && s.phase === 'battle';
  const flip = useContext(FlipCtx);
  const lr = flip ? labelRot(u.facing + 180) - 180 : labelRot(u.facing);
  return (
    <g className={`unit ${selected ? 'selected' : ''} ${highlight ?? ''} ${u.side === me ? 'mine' : 'theirs'}`} onClick={onClick} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <path d={rectPath({ ...r, w: r.w + 0.3, d: r.d + 0.3 })} className="unit-hit" />
      {figs.map((b, i) => (
        <rect
          key={i}
          x={b.x - b.w / 2}
          y={b.y - b.d / 2}
          width={b.w}
          height={b.d}
          rx={t0.arm === 'cavalry' ? 0.15 : 0.08}
          transform={`rotate(${u.facing} ${b.x} ${b.y})`}
          fill={fill}
          className={`fig fig-${TROOPS[u.companies[b.company]?.type ?? u.companies[0].type].arm} ${u.gunDestroyed && i === 0 ? 'destroyed' : ''}`}
        />
      ))}
      <line x1={fc.x - rt.x * (r.w / 2)} y1={fc.y - rt.y * (r.w / 2)} x2={fc.x + rt.x * (r.w / 2)} y2={fc.y + rt.y * (r.w / 2)} className="front-line" />
      <text x={u.x} y={u.y + 0.35} fontSize={0.95} textAnchor="middle" className="unit-label" transform={`rotate(${lr} ${u.x} ${u.y})`}>
        {label}
      </text>
      {tokens}
      {arrows !== undefined && (
        <g transform={`translate(${u.x - rt.x * (r.w / 2 + 0.75) + f.x * (r.d / 2 - 0.55)},${u.y - rt.y * (r.w / 2 + 0.75) + f.y * (r.d / 2 - 0.55)})${flip ? ' rotate(180)' : ''}`}>
          <rect x={-0.55} y={-0.55} width={1.1} height={1.1} rx={0.2} className="tok-arrows" />
          <text y={0.35} fontSize={0.9} textAnchor="middle" className="tok-text dark">
            {arrows}
          </text>
        </g>
      )}
      {actionsBadge && (
        <circle cx={fc.x + f.x * 0.8} cy={fc.y + f.y * 0.8} r={0.35} className="actions-dot" />
      )}
    </g>
  );
}

function labelRot(f: number) {
  const n = normAngle(f);
  return n > 90 && n < 270 ? n - 180 : n;
}

function Token({ p, cls, t }: { p: Point; cls: string; t: string }) {
  const flip = useContext(FlipCtx);
  return (
    <g transform={`translate(${p.x},${p.y})${flip ? ' rotate(180)' : ''}`} pointerEvents="none">
      <circle r={0.5} className={`tok ${cls}`} />
      <text y={0.32} fontSize={0.8} textAnchor="middle" className="tok-text">
        {t}
      </text>
    </g>
  );
}

function LeaderView({ l, s, selected, onClick }: { l: Leader; s: GameState; selected: boolean; onClick: (e: React.MouseEvent) => void }) {
  const active = s.activation?.leaderId === l.id;
  const flip = useContext(FlipCtx);
  return (
    <g className={`leader ${selected ? 'selected' : ''} ${active ? 'active' : ''}`} transform={`translate(${l.x},${l.y})${flip ? ' rotate(180)' : ''}`} onClick={onClick}>
      {l.mounted ? <ellipse rx={0.55} ry={0.85} className={`leader-base side-${l.side}`} /> : <circle r={0.6} className={`leader-base side-${l.side}`} />}
      <text y={0.32} fontSize={0.85} textAnchor="middle" className="leader-text">
        {l.isCinC ? '♛' : '★'}
      </text>
      <text y={-1} fontSize={0.6} textAnchor="middle" className="leader-class">
        {'★'.repeat(Math.max(0, l.cls))}
      </text>
    </g>
  );
}

export function UnitTooltip({ s, u, me }: { s: GameState; u: Unit; me: Side }) {
  const l = leaderOf(s, u);
  return (
    <div className="tooltip">
      <div className="tt-title">
        {u.name} <span className={`chip side-${u.side}`}>{s.players[u.side].name}</span>
      </div>
      {u.companies.map((c, i) => (
        <div key={i}>
          {c.dismountedKnights ? "Cavalieri appiedati (Uomini d'Arme)" : TROOPS[c.type].name} · {c.quality === 'levy' ? 'Leva' : c.quality === 'veteran' ? 'Veterani' : 'Seguito'} · {c.figures}/{c.maxFigures} figure · {c.kills} perdite
          {c.arrows !== undefined ? ` · frecce ${c.arrows}` : ''}
          {c.noShooting ? ' · non può più tirare' : ''}
        </div>
      ))}
      <div className="muted">
        {u.formation !== 'single' ? `Formazione: ${{ line: 'Linea', block: 'Blocco', mixed: 'Blocco misto', hedgehog: 'Riccio', single: '' }[u.formation]} · ` : ''}
        Schiera: {s.wards[u.wardId]?.name ?? '—'}
        {l ? ` · con ${l.name}` : ''}
      </div>
      <div className="muted">
        {u.disarray ? `Disordine ×${u.disarray} · ` : ''}
        {u.daunted ? 'SCOSSA · ' : ''}
        {u.meleeId ? 'in mischia · ' : ''}
        {u.ordered ? 'ha ricevuto un ordine · ' : ''}
        {u.side === me && u.actionsLeft > 0 ? `azioni rimaste: ${u.actionsLeft}` : ''}
      </div>
    </div>
  );
}

export function nearestUnitAt(s: GameState, p: Point): Unit | undefined {
  return liveUnits(s).find((u) => !u.unplaced && pointInPolygon(p, unitPoly(u)));
}

export function distToUnit(p: Point, u: Unit) {
  return dist(p, closestPointOnPolygon(p, unitPoly(u)));
}

export { distPointSegment };

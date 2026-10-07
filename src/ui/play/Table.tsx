import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TROOPS } from '../../engine/data';
import { add, bearing, dist, ellipsePolygon, normAngle, rectCorners, sub } from '../../engine/geometry';
import { leaderAllowance, planMove, planWheel } from '../../engine/movement';
import type { GameState, Leader, Point, Side, Unit } from '../../engine/types';
import { otherSide } from '../../engine/types';
import { isArtillery, isLoose, leaderOf, liveLeaders, liveUnits, unitPoly, unitRect } from '../../engine/units';
import { polyPath, rectPath } from '../figures';
import type { Selection, Tool } from '../tools';
import type { IntentIn } from '../useGame';
import { targetOptions, troopLabel, unitCaps, type TargetOption, type UnitCaps } from './caps';
import { AreaView, Defs, FacingTick, FlipCtx, Label, LeaderView, LineView, TableBase, UnitView, type UnitLook } from './render';

export interface TableProps {
  state: GameState;
  me: Side;
  dispatch: (it: IntentIn) => boolean;
  selection: Selection;
  setSelection: (s: Selection) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  onPickUnit: (u: Unit) => void;
  onPickLeader: (l: Leader) => void;
  onPickFeature: (id: string) => void;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; click: ClickTarget }
  | { kind: 'unit'; id: string; sx: number; sy: number; grab: Point; moved: boolean; mode: 'move' | 'place' | 'manual' }
  | { kind: 'leader'; id: string; sx: number; sy: number; moved: boolean; mode: 'move' | 'place' | 'manual' }
  | { kind: 'wheel'; id: string; pivotRight: boolean; start: Point }
  | { kind: 'area'; start: Point }
  | { kind: 'measure'; start: Point };

type ClickTarget = { kind: 'unit'; id: string } | { kind: 'leader'; id: string } | { kind: 'feature'; id: string } | { kind: 'ground' };

interface Proposal {
  unitId: string;
  x: number;
  y: number;
  facing: number;
}

export function Table(p: TableProps) {
  const { state: s, me, tool } = p;
  const W = s.table.width;
  const H = s.table.height;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Vista iniziale con margini sopra (banner) e sotto (carte, vassoio).
  const narrow = typeof window !== 'undefined' && window.innerWidth < 700;
  const fullView = narrow ? { x: -1, y: -1, w: W + 2, h: H + 2 } : { x: -2, y: -10, w: W + 4, h: H + 20 };
  const [view, setView] = useState(fullView);
  const [flipPref, setFlipPref] = useState<boolean | null>(null);
  const flip = flipPref ?? me === 'B';
  const [cursor, setCursor] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<ClickTarget | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [targetMenu, setTargetMenu] = useState<{ targetId: string; leader?: boolean } | null>(null);
  const [wheelMode, setWheelMode] = useState<string | null>(null);
  const [ghostFacing, setGhostFacing] = useState<number | null>(null);
  const [, force] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; view: typeof view } | null>(null);

  const selUnit = p.selection?.kind === 'unit' ? s.units[p.selection.id] : undefined;
  const selLeader = p.selection?.kind === 'leader' ? s.leaders[p.selection.id] : undefined;
  const selCaps = selUnit ? unitCaps(s, me, selUnit) : null;

  // Chiude menu e anteprime quando cambia la selezione o lo stato.
  useEffect(() => {
    setProposal(null);
    setTargetMenu(null);
    setWheelMode(null);
    setGhostFacing(null);
  }, [p.selection?.kind, (p.selection as any)?.id]);
  useEffect(() => {
    setProposal(null);
    setTargetMenu(null);
    setWheelMode(null);
  }, [s.lastIntentId]);
  // Deseleziona le unità rimosse.
  useEffect(() => {
    if (selUnit?.removed) p.setSelection(null);
  });

  useLayoutEffect(() => {
    const onResize = () => force((x) => x + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const step = e.shiftKey ? 5 : 15;
      if (e.key === 'q' || e.key === 'Q') rotateGhost(-step);
      if (e.key === 'e' || e.key === 'E') rotateGhost(step);
      if (e.key === 'Escape') {
        if (proposal || targetMenu || wheelMode) {
          setProposal(null);
          setTargetMenu(null);
          setWheelMode(null);
        } else if (tool.k !== 'none') p.setTool({ k: 'none' });
        else p.setSelection(null);
      }
      if (e.key === 'Enter' && proposal) confirmProposal();
      if (e.key === 'Enter' && (tool.k === 'line' || tool.k === 'defence')) finishLine();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function rotateGhost(delta: number) {
    if (tool.k === 'place') {
      p.setTool({ ...tool, facing: normAngle(tool.facing + delta) });
      return;
    }
    const u = proposal ? s.units[proposal.unitId] : drag?.kind === 'unit' ? s.units[drag.id] : selUnit;
    if (!u) return;
    if (proposal && isLoose(u)) setProposal({ ...proposal, facing: normAngle(proposal.facing + delta) });
    else if (s.phase === 'deploy' && u.side === me && !u.unplaced) p.dispatch({ t: 'place', unitId: u.id, x: u.x, y: u.y, facing: normAngle(u.facing + delta) });
    else if (isLoose(u) || tool.k === 'manualMove') setGhostFacing(normAngle((ghostFacing ?? u.facing) + delta));
  }

  // ------------------------------------------------------------- coordinate
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
  function toWorld(e: { clientX: number; clientY: number }): Point {
    const r = toSvg(e);
    return flip ? { x: W - r.x, y: H - r.y } : r;
  }
  /** Mondo → pixel relativi al contenitore (per gli elementi HTML sovrapposti). */
  function project(pt: Point): { x: number; y: number } | null {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return null;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const sp = svg.createSVGPoint();
    sp.x = flip ? W - pt.x : pt.x;
    sp.y = flip ? H - pt.y : pt.y;
    const r = sp.matrixTransform(m);
    const wr = wrap.getBoundingClientRect();
    return { x: r.x - wr.left, y: r.y - wr.top };
  }
  function screenBox(pts: Point[]) {
    const ps = pts.map(project).filter(Boolean) as { x: number; y: number }[];
    if (!ps.length) return null;
    return { x0: Math.min(...ps.map((q) => q.x)), x1: Math.max(...ps.map((q) => q.x)), y0: Math.min(...ps.map((q) => q.y)), y1: Math.max(...ps.map((q) => q.y)) };
  }

  function zoomAt(svgPt: Point, k: number, base = view) {
    const nw = Math.max(8, Math.min(W * 1.7, base.w * k));
    const nh = nw * (base.h / base.w);
    setView({ x: svgPt.x - ((svgPt.x - base.x) * nw) / base.w, y: svgPt.y - ((svgPt.y - base.y) * nh) / base.h, w: nw, h: nh });
  }
  function zoomBy(k: number) {
    zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, k);
  }

  // ------------------------------------------------------------- azioni
  /** Esegue un'azione dell'unità, dando prima l'Ordine se serve. */
  function act(u: Unit, it: IntentIn, caps?: UnitCaps): boolean {
    const c = caps ?? unitCaps(s, me, u);
    if (c.needsOrder && !p.dispatch({ t: 'order', leaderId: c.needsOrder, unitId: u.id })) return false;
    return p.dispatch(it);
  }

  function confirmProposal() {
    if (!proposal) return;
    const u = s.units[proposal.unitId];
    if (!u) return;
    if (act(u, { t: 'move', unitId: u.id, x: proposal.x, y: proposal.y, facing: proposal.facing })) setProposal(null);
  }

  function finishLine() {
    if (tool.k === 'line' && tool.points.length >= 2) {
      p.dispatch({ t: 'addLine', feature: { kind: tool.kind, points: tool.points } });
      p.setTool({ ...tool, points: [] });
    }
    if (tool.k === 'defence' && tool.points.length >= 2) {
      if (p.dispatch({ t: 'placeDefence', kind: tool.kind, points: tool.points })) p.setTool({ k: 'none' });
      else p.setTool({ ...tool, points: [] });
    }
  }

  function chooseTarget(t: Unit, opt: TargetOption) {
    if (!selUnit || !opt.ok) return;
    const caps = unitCaps(s, me, selUnit);
    let ok = false;
    if (opt.kind === 'shoot') ok = caps.free ? p.dispatch({ t: 'freeAction', unitId: selUnit.id, kind: 'shoot', targetId: t.id }) : act(selUnit, { t: 'shoot', unitId: selUnit.id, targetId: t.id }, caps);
    else ok = act(selUnit, { t: 'attack', unitId: selUnit.id, targetId: t.id, charge: opt.kind === 'charge' }, caps);
    if (ok) setTargetMenu(null);
  }

  // ------------------------------------------------------------- click
  function hitTarget(el: EventTarget | null): ClickTarget & { handle?: 'left' | 'right' } {
    const e = el as Element | null;
    const h = e?.closest?.('[data-handle]');
    if (h) return { kind: 'ground', handle: h.getAttribute('data-handle') as 'left' | 'right' };
    const ld = e?.closest?.('[data-leader]');
    if (ld) return { kind: 'leader', id: ld.getAttribute('data-leader')! };
    const un = e?.closest?.('[data-unit]');
    if (un) return { kind: 'unit', id: un.getAttribute('data-unit')! };
    const ft = e?.closest?.('[data-feature]');
    if (ft) return { kind: 'feature', id: ft.getAttribute('data-feature')! };
    return { kind: 'ground' };
  }

  function clickUnit(u: Unit) {
    if (tool.k === 'pickUnit') return p.onPickUnit(u);
    if (tool.k === 'placeLeader') {
      if (p.dispatch({ t: 'placeLeader', leaderId: tool.leaderId, x: u.x, y: u.y, attachTo: u.id })) p.setTool({ k: 'none' });
      return;
    }
    if (tool.k === 'manualMove' || tool.k === 'measure') return;
    if (u.side !== me && selUnit && selCaps?.canAct) {
      setTargetMenu({ targetId: u.id });
      setProposal(null);
      return;
    }
    p.setSelection({ kind: 'unit', id: u.id });
  }

  function clickLeader(l: Leader) {
    if (tool.k === 'pickLeader') return p.onPickLeader(l);
    if (l.side !== me && !l.attachedTo && selUnit && selCaps?.attack) {
      setTargetMenu({ targetId: l.id, leader: true });
      return;
    }
    if (l.attachedTo && l.side !== me && selUnit && selCaps?.canAct) {
      clickUnit(s.units[l.attachedTo]);
      return;
    }
    p.setSelection({ kind: 'leader', id: l.id });
  }

  function clickGround(w: Point) {
    if (tool.k === 'place') {
      if (p.dispatch({ t: 'place', unitId: tool.unitId, x: w.x, y: w.y, facing: tool.facing })) {
        const next = liveUnits(s, me).find((u) => u.unplaced && u.id !== tool.unitId);
        p.setTool(next ? { k: 'place', unitId: next.id, facing: tool.facing } : { k: 'none' });
      }
      return;
    }
    if (tool.k === 'placeLeader') {
      if (p.dispatch({ t: 'placeLeader', leaderId: tool.leaderId, x: w.x, y: w.y })) p.setTool({ k: 'none' });
      return;
    }
    if (tool.k === 'line' || tool.k === 'defence') {
      p.setTool({ ...tool, points: [...tool.points, w] } as Tool);
      return;
    }
    if (tool.k !== 'none') return;
    if (targetMenu) {
      setTargetMenu(null);
      return;
    }
    if (selUnit && selCaps?.move) {
      const facing = isLoose(selUnit) ? (dist(selUnit, w) > 0.5 ? bearing(selUnit, w) : selUnit.facing) : selUnit.facing;
      setProposal({ unitId: selUnit.id, x: w.x, y: w.y, facing });
      return;
    }
    if (selLeader && leaderCanMove(selLeader)) {
      if (p.dispatch({ t: 'leaderMove', leaderId: selLeader.id, x: w.x, y: w.y })) return;
    }
    p.setSelection(null);
  }

  function leaderCanMove(l: Leader): boolean {
    if (l.side !== me || l.killed) return false;
    if (s.phase === 'manoeuvre') return s.activeSide === me && !s.pending.length;
    const a = s.activation;
    return s.phase === 'battle' && a?.kind === 'leader' && a.leaderId === l.id && a.side === me && a.tokensLeft > 0 && !s.pending.length;
  }

  // ------------------------------------------------------------- puntatore
  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view };
      setDrag(null);
      return;
    }
    const w = toWorld(e);
    const tgt = hitTarget(e.target);
    if (e.button === 1 || e.button === 2) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, click: { kind: 'ground' } });
      return;
    }
    if (tgt.handle && wheelMode) {
      setDrag({ kind: 'wheel', id: wheelMode, pivotRight: tgt.handle === 'left', start: w });
      return;
    }
    if (tool.k === 'area') return setDrag({ kind: 'area', start: w });
    if (tool.k === 'measure') return setDrag({ kind: 'measure', start: w });
    if (tgt.kind === 'unit') {
      const u = s.units[tgt.id];
      if (u) {
        let mode: 'move' | 'place' | 'manual' | null = null;
        if (tool.k === 'manualMove') mode = 'manual';
        else if (s.phase === 'deploy' && u.side === me && tool.k === 'none') mode = 'place';
        else if (tool.k === 'none' && u.side === me && unitCaps(s, me, u).move) mode = 'move';
        if (mode) return setDrag({ kind: 'unit', id: u.id, sx: e.clientX, sy: e.clientY, grab: w, moved: false, mode });
      }
    }
    if (tgt.kind === 'leader') {
      const l = s.leaders[tgt.id];
      if (l) {
        let mode: 'move' | 'place' | 'manual' | null = null;
        if (tool.k === 'manualMove') mode = 'manual';
        else if (s.phase === 'deploy' && l.side === me && tool.k === 'none') mode = 'place';
        else if (tool.k === 'none' && leaderCanMove(l)) mode = 'move';
        if (mode) return setDrag({ kind: 'leader', id: l.id, sx: e.clientX, sy: e.clientY, moved: false, mode });
      }
    }
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, click: tgt });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      zoomAt(mid, pinch.current.d / Math.max(10, d), pinch.current.view);
      return;
    }
    const w = toWorld(e);
    setCursor(w);
    if (!drag) {
      const t = hitTarget(e.target);
      setHover(t.kind === 'ground' ? null : t);
      return;
    }
    if (drag.kind === 'pan') {
      const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5;
      if (moved) {
        const svg = svgRef.current!;
        const scale = view.w / svg.clientWidth;
        setView({ ...view, x: drag.vx - (e.clientX - drag.sx) * scale, y: drag.vy - (e.clientY - drag.sy) * scale });
        if (!drag.moved) setDrag({ ...drag, moved: true });
      }
      return;
    }
    if ((drag.kind === 'unit' || drag.kind === 'leader') && !drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) {
      setDrag({ ...drag, moved: true });
      setProposal(null);
      setTargetMenu(null);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      setDrag(null);
      return;
    }
    const d = drag;
    setDrag(null);
    if (!d) return;
    const w = toWorld(e);
    if (d.kind === 'pan') {
      if (d.moved) return;
      if (d.click.kind === 'unit' && s.units[d.click.id]) return clickUnit(s.units[d.click.id]);
      if (d.click.kind === 'leader' && s.leaders[d.click.id]) return clickLeader(s.leaders[d.click.id]);
      if (d.click.kind === 'feature' && tool.k === 'pickFeature') return p.onPickFeature(d.click.id);
      return clickGround(w);
    }
    if (d.kind === 'unit') {
      const u = s.units[d.id];
      if (!u) return;
      if (!d.moved) return clickUnit(u);
      const ghost = unitGhost(u, d, w);
      if (d.mode === 'move') act(u, { t: 'move', unitId: u.id, x: ghost.x, y: ghost.y, facing: ghost.facing });
      else if (d.mode === 'place') p.dispatch({ t: 'place', unitId: u.id, x: ghost.x, y: ghost.y, facing: ghost.facing });
      else p.dispatch({ t: 'manualUnit', unitId: u.id, patch: { x: ghost.x, y: ghost.y, facing: ghost.facing } });
      setGhostFacing(null);
      return;
    }
    if (d.kind === 'leader') {
      const l = s.leaders[d.id];
      if (!l) return;
      if (!d.moved) return clickLeader(l);
      const under = unitUnder(e.clientX, e.clientY);
      const attach = under && under.side === l.side ? under : undefined;
      if (d.mode === 'move') p.dispatch({ t: 'leaderMove', leaderId: l.id, x: w.x, y: w.y, attachTo: attach?.id });
      else if (d.mode === 'place') p.dispatch({ t: 'placeLeader', leaderId: l.id, x: w.x, y: w.y, attachTo: attach?.id });
      else p.dispatch({ t: 'manualLeader', leaderId: l.id, patch: { x: w.x, y: w.y, attachedTo: attach ? attach.id : null } });
      return;
    }
    if (d.kind === 'wheel') {
      const u = s.units[d.id];
      const ang = wheelAngle(u, d, w);
      if (u && Math.abs(ang) >= 1) act(u, { t: 'wheel', unitId: u.id, angle: ang });
      return;
    }
    if (d.kind === 'area' && tool.k === 'area') {
      const a = d.start;
      const rx = Math.abs(w.x - a.x) / 2;
      const ry = Math.abs(w.y - a.y) / 2;
      if (rx > 0.5 && ry > 0.5) {
        const cx = (a.x + w.x) / 2;
        const cy = (a.y + w.y) / 2;
        const points =
          tool.kind === 'building'
            ? [{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy - ry }, { x: cx + rx, y: cy + ry }, { x: cx - rx, y: cy + ry }]
            : ellipsePolygon(cx, cy, rx, ry, 20, tool.kind === 'wood' || tool.kind === 'marsh' ? 0.1 : 0.04);
        p.dispatch({ t: 'addArea', feature: { kind: tool.kind, points } });
      }
    }
  }

  function unitUnder(cx: number, cy: number): Unit | undefined {
    const els = document.elementsFromPoint(cx, cy);
    for (const el of els) {
      const un = (el as Element).closest?.('[data-unit]');
      if (un) return s.units[un.getAttribute('data-unit')!];
    }
    return undefined;
  }

  function unitGhost(u: Unit, d: Extract<Drag, { kind: 'unit' }>, w: Point) {
    const dest = add({ x: u.x, y: u.y }, sub(w, d.grab));
    let facing = u.facing;
    if (ghostFacing !== null) facing = ghostFacing;
    else if (d.mode === 'move' && isLoose(u) && dist(u, dest) > 0.5) facing = bearing(u, dest);
    return { x: dest.x, y: dest.y, facing };
  }

  function wheelAngle(u: Unit | undefined, d: Extract<Drag, { kind: 'wheel' }>, w: Point): number {
    if (!u) return 0;
    const corners = rectCorners(unitRect(u));
    // Perno: angolo opposto a quello trascinato.
    const pivot = d.pivotRight ? corners[1] : corners[0];
    const a0 = Math.atan2(d.start.y - pivot.y, d.start.x - pivot.x);
    const a1 = Math.atan2(w.y - pivot.y, w.x - pivot.x);
    let deg = ((a1 - a0) * 180) / Math.PI;
    while (deg > 180) deg -= 360;
    while (deg < -180) deg += 360;
    deg = Math.round(deg / 5) * 5;
    // Trascinando l'angolo sinistro si ruota attorno al destro (senso antiorario) e viceversa.
    if (d.pivotRight && deg < 0) deg = 0;
    if (!d.pivotRight && deg > 0) deg = 0;
    return deg;
  }

  // ------------------------------------------------------------- dati per il disegno
  const units = liveUnits(s).filter((u) => !u.unplaced);
  const leaders = liveLeaders(s).filter((l) => !l.unplaced);
  const zones = s.phase === 'deploy' || s.phase === 'terrain';
  const activeLeader = s.activation?.kind === 'leader' ? s.leaders[s.activation.leaderId!] : undefined;

  const looks = useMemo(() => {
    const res: Record<string, UnitLook> = {};
    const myMove = (s.phase === 'battle' && s.activation?.side === me) || (s.phase === 'manoeuvre' && s.activeSide === me) || (s.phase === 'endTurn' && !s.endTurn?.freeDone[me]);
    for (const u of units) {
      if (u.side !== me || !myMove) res[u.id] = 'normal';
      else res[u.id] = unitCaps(s, me, u).canAct ? 'ready' : u.ordered || u.initiative ? 'spent' : 'normal';
    }
    return res;
  }, [s, me]);

  const targetHl = useMemo(() => {
    const res: Record<string, 'target' | 'target-no'> = {};
    if (!selUnit || !selCaps?.canAct || (!selCaps.shoot && !selCaps.attack)) return res;
    for (const t of liveUnits(s, otherSide(me))) {
      if (t.unplaced) continue;
      const opts = targetOptions(s, me, selUnit, t);
      if (opts.some((o) => o.ok)) res[t.id] = 'target';
    }
    return res;
  }, [s, me, selUnit?.id, selCaps?.canAct]);

  // Anteprima del trascinamento o della proposta.
  let movePreview: { u: Unit; dest: { x: number; y: number; facing: number }; ok: boolean; text: string; allowance: number } | null = null;
  if (drag?.kind === 'unit' && drag.moved && cursor) {
    const u = s.units[drag.id];
    if (u) {
      const g = unitGhost(u, drag, cursor);
      if (drag.mode === 'move') {
        const plan = planMove(s, u, g, { manoeuvre: s.phase === 'manoeuvre' });
        movePreview = { u, dest: plan.ok ? plan.dest : g, ok: plan.ok, allowance: plan.allowance, text: plan.ok ? moveText(plan) : plan.reason ?? '' };
      } else movePreview = { u, dest: g, ok: true, allowance: 0, text: drag.mode === 'place' ? 'Rilascia per schierare · Q/E ruota' : 'Spostamento libero' };
    }
  } else if (proposal) {
    const u = s.units[proposal.unitId];
    if (u) {
      const plan = planMove(s, u, proposal, { manoeuvre: s.phase === 'manoeuvre' });
      movePreview = { u, dest: plan.ok ? plan.dest : { ...proposal }, ok: plan.ok, allowance: plan.allowance, text: plan.ok ? moveText(plan) : plan.reason ?? '' };
    }
  }
  let wheelPreview: { u: Unit; dest: { x: number; y: number; facing: number }; angle: number; ok: boolean; reason?: string; disarray: number } | null = null;
  if (drag?.kind === 'wheel' && cursor) {
    const u = s.units[drag.id];
    if (u) {
      const ang = wheelAngle(u, drag, cursor);
      const w = planWheel(s, u, ang);
      wheelPreview = { u, dest: w.dest, angle: ang, ok: w.ok, reason: w.reason, disarray: w.disarray };
    }
  }
  let leaderPreview: { l: Leader; allowance: number; at: Point } | null = null;
  if (drag?.kind === 'leader' && drag.moved && cursor) {
    const l = s.leaders[drag.id];
    if (l) leaderPreview = { l, allowance: drag.mode === 'move' ? leaderAllowance(s, l, cursor) : 0, at: cursor };
  }

  // ------------------------------------------------------------- overlay HTML
  const overlays: ReactNode[] = [];
  const wrapW = wrapRef.current?.clientWidth ?? 800;
  const clampX = (x: number, w: number) => Math.max(8, Math.min(wrapW - w - 8, x - w / 2));
  // Su schermi stretti le schede diventano un pannello in fondo al tavolo.
  const compact = wrapW < 700;
  const place = (left: number, top: number, width: number, above: boolean) =>
    compact ? { cls: 'sheet', style: {} } : { cls: above ? 'above' : 'below', style: { left, top, width } };

  if (selUnit && !drag && !targetMenu && !(compact && proposal)) {
    const box = screenBox(unitPoly(selUnit));
    if (box) {
      const width = 300;
      // Le proprie unità mostrano la scheda dietro di sé (verso il proprio bordo), per non coprire i nemici davanti.
      const wrapH = wrapRef.current?.clientHeight ?? 800;
      const roomBelow = wrapH - box.y1 > 230;
      const above = selUnit.side === me ? !roomBelow : box.y0 > 200;
      const pl = place(clampX((box.x0 + box.x1) / 2, width), above ? box.y0 - 12 : box.y1 + 12, width, above);
      overlays.push(
        <div key="bar" className={`float-card ${pl.cls}`} style={pl.style} onPointerDown={(e) => e.stopPropagation()}>
          <UnitBar s={s} me={me} u={selUnit} caps={selCaps!} act={act} setWheelMode={setWheelMode} wheelMode={wheelMode === selUnit.id} close={() => p.setSelection(null)} setTool={p.setTool} dispatch={p.dispatch} />
        </div>,
      );
    }
  }
  if (selLeader && !drag) {
    const pt = project(selLeader);
    if (pt) {
      const width = 280;
      const above = pt.y > 170;
      const pl = place(clampX(pt.x, width), above ? pt.y - 26 : pt.y + 26, width, above);
      overlays.push(
        <div key="lbar" className={`float-card ${pl.cls}`} style={pl.style} onPointerDown={(e) => e.stopPropagation()}>
          <LeaderBar s={s} me={me} l={selLeader} canMove={leaderCanMove(selLeader)} dispatch={p.dispatch} close={() => p.setSelection(null)} />
        </div>,
      );
    }
  }
  if (targetMenu && selUnit) {
    const isLeader = !!targetMenu.leader;
    const t = isLeader ? undefined : s.units[targetMenu.targetId];
    const tl = isLeader ? s.leaders[targetMenu.targetId] : undefined;
    const anchor = t ? screenBox(unitPoly(t)) : tl ? (() => { const q = project(tl); return q ? { x0: q.x, x1: q.x, y0: q.y, y1: q.y } : null; })() : null;
    if (anchor) {
      const width = 300;
      const above = anchor.y0 > 200;
      const opts = t ? targetOptions(s, me, selUnit, t) : [];
      const pl = place(clampX((anchor.x0 + anchor.x1) / 2, width), above ? anchor.y0 - 12 : anchor.y1 + 12, width, above);
      overlays.push(
        <div key="tm" className={`float-card target ${pl.cls}`} style={pl.style} onPointerDown={(e) => e.stopPropagation()}>
          <div className="fc-head">
            <span>
              {selUnit.name} → <b>{t ? t.name : tl?.name}</b>
            </span>
            <button className="icon-btn" onClick={() => setTargetMenu(null)} aria-label="Chiudi">
              ✕
            </button>
          </div>
          {t && !opts.length && <div className="fc-note">Questa unità non può né tirare né attaccare.</div>}
          {opts.map((o) => (
            <button key={o.kind} className={`target-opt ${o.kind} ${o.ok ? '' : 'no'}`} disabled={!o.ok} onClick={() => chooseTarget(t!, o)}>
              <span className="to-icon">{o.kind === 'shoot' ? '🏹' : o.kind === 'charge' ? '🐎' : '⚔'}</span>
              <span className="to-text">
                <b>{o.label}</b>
                <small>{o.detail}</small>
              </span>
            </button>
          ))}
          {tl && (
            <button className="target-opt attack" onClick={() => act(selUnit, { t: 'attackLeader', unitId: selUnit.id, leaderId: tl.id }) && setTargetMenu(null)}>
              <span className="to-icon">⚔</span>
              <span className="to-text">
                <b>Attacca il comandante isolato</b>
                <small>Può sottrarsi, a meno che non sia raggiunto dalla cavalleria</small>
              </span>
            </button>
          )}
        </div>,
      );
    }
  }
  if (proposal && movePreview && !drag) {
    const pt = screenBox(unitPoly(movePreview.u, movePreview.dest));
    if (pt) {
      const width = 260;
      const pl = place(clampX((pt.x0 + pt.x1) / 2, width), pt.y1 + 10, width, false);
      overlays.push(
        <div key="prop" className={`float-card confirm ${pl.cls}`} style={pl.style} onPointerDown={(e) => e.stopPropagation()}>
          <div className={`fc-note ${movePreview.ok ? '' : 'bad'}`}>{movePreview.text}</div>
          <div className="row">
            <button className="primary" disabled={!movePreview.ok} onClick={confirmProposal}>
              ✓ Muovi qui
            </button>
            {isLoose(movePreview.u) && (
              <>
                <button onClick={() => rotateGhost(-15)} title="Ruota (Q)">
                  ↺
                </button>
                <button onClick={() => rotateGhost(15)} title="Ruota (E)">
                  ↻
                </button>
              </>
            )}
            <button onClick={() => setProposal(null)}>Annulla</button>
          </div>
        </div>,
      );
    }
  }

  // Suggerimento al passaggio del mouse sui nemici.
  let hoverLabel: { at: Point; text: string; bad?: boolean } | null = null;
  if (!drag && hover?.kind === 'unit' && selUnit && selCaps?.canAct && !targetMenu) {
    const t = s.units[hover.id];
    if (t && t.side !== me) {
      const opts = targetOptions(s, me, selUnit, t);
      const good = opts.filter((o) => o.ok);
      if (good.length) hoverLabel = { at: t, text: good.map((o) => `${o.kind === 'shoot' ? '🏹' : o.kind === 'charge' ? '🐎' : '⚔'} ${o.label}`).join('   ') + ' — clicca' };
      else if (opts.length) hoverLabel = { at: t, text: opts[0].detail, bad: true };
    }
  }

  const handles = wheelMode && selUnit && !drag ? rectCorners(unitRect(selUnit)).slice(0, 2) : null;

  return (
    <div className="table-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        data-flip={flip ? '1' : '0'}
        className={`table-svg tool-${tool.k} ${drag?.kind === 'pan' && drag.moved ? 'panning' : ''}`}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={(e) => zoomAt(toSvg(e), e.deltaY > 0 ? 1.12 : 1 / 1.12)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !drag && setCursor(null)}
        onDoubleClick={() => finishLine()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Defs />
        <FlipCtx.Provider value={flip}>
          <g transform={flip ? `rotate(180 ${W / 2} ${H / 2})` : undefined}>
            <TableBase W={W} H={H} zones={zones} />
            {s.terrain.areas.map((a) => (
              <g key={a.id} data-feature={a.id} className={tool.k === 'pickFeature' ? 'pickable' : ''}>
                <AreaView a={a} />
              </g>
            ))}
            {s.terrain.lines.map((l) => (
              <g key={l.id} data-feature={l.id} className={tool.k === 'pickFeature' ? 'pickable' : ''}>
                <path d={polyPath(l.points, false)} fill="none" stroke="transparent" strokeWidth={1.4} />
                <LineView l={l} />
              </g>
            ))}
            <rect x={0} y={0} width={W} height={H} fill="url(#vignette)" pointerEvents="none" />
            {activeLeader && !activeLeader.killed && (
              <circle cx={activeLeader.x} cy={activeLeader.y} r={6} className="command-radius" pointerEvents="none" />
            )}
            {selLeader && selLeader.id !== activeLeader?.id && <circle cx={selLeader.x} cy={selLeader.y} r={6} className="command-radius dim" pointerEvents="none" />}
            {Object.values(s.melees).map((m) => {
              const a = s.units[m.attackers[0]];
              const d = s.units[m.defenders[0]];
              if (!a || !d) return null;
              const mx = (a.x + d.x) / 2;
              const my = (a.y + d.y) / 2;
              return (
                <g key={m.id} pointerEvents="none" transform={`translate(${mx},${my})${flip ? ' rotate(180)' : ''}`}>
                  <circle r={1.1} className="melee-badge" />
                  <text y={0.45} fontSize={1.3} textAnchor="middle" className="melee-icon">
                    ⚔
                  </text>
                </g>
              );
            })}
            {units.map((u) => (
              <UnitView key={u.id} s={s} u={u} selected={selUnit?.id === u.id} look={drag?.kind === 'unit' && drag.id === u.id && drag.moved ? 'spent' : looks[u.id]} hl={targetHl[u.id] ?? (targetMenu?.targetId === u.id ? 'target' : null)} />
            ))}
            {leaders.map((l) => (
              <LeaderView key={l.id} l={l} s={s} selected={selLeader?.id === l.id} ready={leaderCanMove(l)} />
            ))}
            {/* anteprime */}
            {movePreview && (
              <g pointerEvents="none">
                {movePreview.allowance > 0 && <circle cx={movePreview.u.x} cy={movePreview.u.y} r={movePreview.allowance} className="move-ring" />}
                <line x1={movePreview.u.x} y1={movePreview.u.y} x2={movePreview.dest.x} y2={movePreview.dest.y} className="move-path" markerEnd="url(#arrow)" />
                <path d={rectPath(unitRect(movePreview.u, movePreview.dest))} className={movePreview.ok ? 'ghost ok' : 'ghost bad'} />
                <FacingTick u={movePreview.u} at={movePreview.dest} />
                {drag && <Label at={movePreview.dest} text={movePreview.text} bad={!movePreview.ok} />}
              </g>
            )}
            {wheelPreview && (
              <g pointerEvents="none">
                <path d={rectPath(unitRect(wheelPreview.u, wheelPreview.dest))} className={wheelPreview.ok ? 'ghost ok' : 'ghost bad'} />
                <FacingTick u={wheelPreview.u} at={wheelPreview.dest} />
                <Label
                  at={wheelPreview.dest}
                  text={wheelPreview.ok ? `${Math.abs(wheelPreview.angle)}°${wheelPreview.disarray && s.phase !== 'manoeuvre' ? ' · oltre 45°: +1 Disordine' : ''}` : wheelPreview.reason ?? ''}
                  bad={!wheelPreview.ok || (!!wheelPreview.disarray && s.phase !== 'manoeuvre')}
                />
              </g>
            )}
            {leaderPreview && (
              <g pointerEvents="none">
                {leaderPreview.allowance > 0 && <circle cx={leaderPreview.l.x} cy={leaderPreview.l.y} r={leaderPreview.allowance} className="move-ring" />}
                <circle cx={leaderPreview.at.x} cy={leaderPreview.at.y} r={0.8} className={leaderPreview.allowance === 0 || dist(leaderPreview.l, leaderPreview.at) <= leaderPreview.allowance ? 'ghost ok' : 'ghost bad'} />
                {leaderPreview.allowance > 0 && (
                  <Label at={leaderPreview.at} text={`${dist(leaderPreview.l, leaderPreview.at).toFixed(1)}" / ${leaderPreview.allowance}" · rilascia su un'unità per aggregarti`} bad={dist(leaderPreview.l, leaderPreview.at) > leaderPreview.allowance} />
                )}
              </g>
            )}
            {handles &&
              handles.map((h, i) => (
                <g key={i} data-handle={i === 0 ? 'left' : 'right'} className="wheel-handle" transform={`translate(${h.x},${h.y})`}>
                  <circle r={1.1} className="wh-hit" />
                  <circle r={0.55} className="wh-dot" />
                </g>
              ))}
            {tool.k === 'place' && cursor && s.units[tool.unitId] && (
              <g pointerEvents="none">
                <path d={rectPath(unitRect(s.units[tool.unitId], { x: cursor.x, y: cursor.y, facing: tool.facing }))} className="ghost ok" />
                <FacingTick u={s.units[tool.unitId]} at={{ x: cursor.x, y: cursor.y, facing: tool.facing }} />
                <Label at={cursor} text="Clicca per schierare · Q/E ruota" />
              </g>
            )}
            {tool.k === 'placeLeader' && cursor && <circle cx={cursor.x} cy={cursor.y} r={0.8} className="ghost ok" pointerEvents="none" />}
            {drag?.kind === 'area' && cursor && (
              <rect x={Math.min(drag.start.x, cursor.x)} y={Math.min(drag.start.y, cursor.y)} width={Math.abs(cursor.x - drag.start.x)} height={Math.abs(cursor.y - drag.start.y)} className="ghost ok" pointerEvents="none" />
            )}
            {(tool.k === 'line' || tool.k === 'defence') && tool.points.length > 0 && (
              <path d={polyPath(cursor ? [...tool.points, cursor] : tool.points, false)} fill="none" stroke="var(--hl)" strokeWidth={0.3} strokeDasharray="0.4 0.2" pointerEvents="none" />
            )}
            {drag?.kind === 'measure' && cursor && (
              <g pointerEvents="none">
                <line x1={drag.start.x} y1={drag.start.y} x2={cursor.x} y2={cursor.y} stroke="var(--hl)" strokeWidth={0.18} />
                <circle cx={drag.start.x} cy={drag.start.y} r={0.25} fill="var(--hl)" />
                <Label at={cursor} text={`${dist(drag.start, cursor).toFixed(1)}"`} />
              </g>
            )}
            {hoverLabel && <Label at={hoverLabel.at} text={hoverLabel.text} bad={hoverLabel.bad} dy={2.8} />}
          </g>
        </FlipCtx.Provider>
      </svg>
      {overlays}
      {wheelMode && selUnit && !drag && (
        <div className="wheel-bar" onPointerDown={(e) => e.stopPropagation()}>
          <span>Trascina una maniglia gialla per convergere, oppure:</span>
          {[-90, -45, 45, 90].map((a) => (
            <button key={a} onClick={() => act(selUnit, { t: 'wheel', unitId: selUnit.id, angle: a })}>
              {a < 0 ? `↺ ${-a}°` : `↻ ${a}°`}
            </button>
          ))}
          <button onClick={() => setWheelMode(null)}>Fine</button>
        </div>
      )}
      <div className="zoom-ctl" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => zoomBy(1 / 1.3)} title="Ingrandisci">
          +
        </button>
        <button onClick={() => zoomBy(1.3)} title="Riduci">
          −
        </button>
        <button onClick={() => setView(fullView)} title="Tutto il tavolo">
          ⤢
        </button>
        <button onClick={() => setFlipPref(!flip)} title="Ruota la vista di 180°">
          ⟲
        </button>
        <button className={tool.k === 'measure' ? 'on' : ''} onClick={() => p.setTool(tool.k === 'measure' ? { k: 'none' } : { k: 'measure' })} title="Righello: trascina per misurare">
          📏
        </button>
      </div>
    </div>
  );
}

function moveText(plan: ReturnType<typeof planMove>): string {
  const parts = [`${plan.distance.toFixed(1)}" su ${plan.allowance}"`];
  if (plan.disarray) parts.push(`+${plan.disarray} Disordine`);
  if (plan.notes.length) parts.push(plan.notes.join(', '));
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Barre sul tavolo
// ---------------------------------------------------------------------------

function UnitBar({
  s,
  me,
  u,
  caps,
  act,
  setWheelMode,
  wheelMode,
  close,
  setTool,
  dispatch,
}: {
  s: GameState;
  me: Side;
  u: Unit;
  caps: UnitCaps;
  act: (u: Unit, it: IntentIn, c?: UnitCaps) => boolean;
  setWheelMode: (id: string | null) => void;
  wheelMode: boolean;
  close: () => void;
  setTool: (t: Tool) => void;
  dispatch: (it: IntentIn) => boolean;
}) {
  const mine = u.side === me;
  const l = leaderOf(s, u);
  const c0 = u.companies[0];
  const figs = u.companies.reduce((a, c) => a + c.figures, 0);
  const max = u.companies.reduce((a, c) => a + c.maxFigures, 0);
  const arrows = u.companies.find((c) => c.type === 'archers')?.arrows;
  const special = mine && caps.canAct && !caps.free && s.phase === 'battle' ? specialOptions(u) : [];
  return (
    <>
      <div className="fc-head">
        <span className={`fc-dot side-${u.side}`} />
        <span className="fc-title">{u.name}</span>
        <button className="icon-btn" onClick={close} aria-label="Chiudi">
          ✕
        </button>
      </div>
      <div className="fc-sub">
        {troopLabel(u)} · {c0.quality === 'levy' ? 'Leva' : c0.quality === 'veteran' ? 'Veterani' : 'Seguito'}
      </div>
      <div className="chips">
        <span className="chip">
          {figs}/{max} figure
        </span>
        {u.companies.some((c) => c.kills) && <span className="chip">{u.companies.reduce((a, c) => a + c.kills, 0)} perdite</span>}
        {arrows !== undefined && <span className="chip">🏹 {arrows}/6</span>}
        {u.disarray > 0 && <span className="chip warn">Disordine ×{u.disarray}</span>}
        {u.daunted && <span className="chip bad">Scossa</span>}
        {u.meleeId && <span className="chip bad">In mischia</span>}
        {l && <span className="chip">con {l.name}</span>}
        {c0.type === 'knights' && !c0.dismountedKnights && <span className="chip">cariche {u.chargesUsed}/2</span>}
      </div>
      {mine && !caps.canAct && caps.reason && <div className="fc-note">{caps.reason}</div>}
      {mine && caps.canAct && (
        <>
          <div className="fc-note">
            {caps.needsOrder ? (
              <>
                <b>Riceverà un Ordine</b> da {s.leaders[caps.needsOrder]?.name} alla prima azione.{' '}
              </>
            ) : caps.free ? (
              <b>Azione gratuita di fine turno. </b>
            ) : (
              <>
                Azioni: <b>{'●'.repeat(caps.actionsLeft)}</b>{' '}
              </>
            )}
            {caps.move && 'Trascina per muovere (o clicca sul tavolo). '}
            {(caps.shoot || caps.attack) && 'Clicca un nemico per tirare o attaccare.'}
          </div>
          <div className="fc-actions">
            {caps.wheel && (
              <button className={wheelMode ? 'on' : ''} onClick={() => setWheelMode(wheelMode ? null : u.id)}>
                ↻ Converge
              </button>
            )}
            {caps.aboutFace && <button onClick={() => act(u, { t: 'aboutFace', unitId: u.id }, caps)}>⟲ Dietro-front</button>}
            {caps.pivot && (
              <>
                <button onClick={() => act(u, { t: 'pivot', unitId: u.id, angle: -45 }, caps)}>↺ 45°</button>
                <button onClick={() => act(u, { t: 'pivot', unitId: u.id, angle: 45 }, caps)}>↻ 45°</button>
              </>
            )}
            {caps.packUp && <button onClick={() => act(u, { t: 'packUp', unitId: u.id }, caps)}>{u.gunDeployed ? 'Aggancia il pezzo' : 'Schiera il pezzo'}</button>}
            {caps.rally && !caps.free && u.disarray > 0 && <button onClick={() => act(u, { t: 'rally', unitId: u.id, what: 'disarray' }, caps)}>✚ Riordina</button>}
            {caps.rally && !caps.free && u.daunted && (
              <button onClick={() => act(u, { t: 'rally', unitId: u.id, what: 'daunted' }, caps)}>✚ Riprendi ({u.rallyCount ?? 0}/2)</button>
            )}
            {caps.free && u.disarray > 0 && <button onClick={() => dispatch({ t: 'freeAction', unitId: u.id, kind: 'rally' })}>✚ Togli un Disordine</button>}
            {special.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'join' || v === 'formBlock') setTool({ k: 'pickUnit', purpose: v, unitId: u.id });
                  else if (v === 'chopHedge') setTool({ k: 'pickFeature', purpose: 'chopHedge', unitId: u.id });
                  else if (v) act(u, { t: 'special', unitId: u.id, kind: v as any }, caps);
                }}
              >
                <option value="">Altro…</option>
                {special.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}
      {mine && s.phase !== 'deploy' && s.terrain.areas.some((a) => a.kind === 'wood') && (
        <button className="link-btn" onClick={() => dispatch({ t: 'toggleWoodEdge', unitId: u.id })}>
          {u.woodEdge ? '▸ è al margine del bosco (cambia)' : '▸ segna come schierata al margine del bosco'}
        </button>
      )}
      {mine && s.phase === 'deploy' && (
        <div className="fc-actions">
          <button onClick={() => dispatch({ t: 'place', unitId: u.id, x: u.x, y: u.y, facing: normAngle(u.facing - 15) })}>↺ Ruota</button>
          <button onClick={() => dispatch({ t: 'place', unitId: u.id, x: u.x, y: u.y, facing: normAngle(u.facing + 15) })}>↻ Ruota</button>
          <button onClick={() => dispatch({ t: 'unplace', unitId: u.id })}>Togli dal tavolo</button>
        </div>
      )}
    </>
  );
}

function specialOptions(u: Unit): { v: string; label: string }[] {
  const c = u.companies[0];
  const opts: { v: string; label: string }[] = [];
  if (u.formation === 'hedgehog') opts.push({ v: 'reformBlock', label: 'Riforma il blocco (1 azione)' });
  if (u.companies.length === 2 && u.formation !== 'hedgehog') opts.push({ v: 'split', label: 'Dividi la formazione (2 azioni)' });
  if (u.companies.length === 1 && TROOPS[c.type].arm === 'infantry') {
    opts.push({ v: 'join', label: 'Forma una Linea con… (2 azioni)' });
    opts.push({ v: 'formBlock', label: 'Forma un Blocco con… (2 azioni)' });
  }
  if (u.companies.some((x) => x.stakes && !x.stakesPlanted)) opts.push({ v: 'stakes', label: 'Pianta i pali (2 azioni)' });
  if (c.type === 'knights' && !c.dismountedKnights) opts.push({ v: 'dismountKnights', label: 'Smonta e combatte a piedi (2 azioni)' });
  if (c.type === 'lightHorse' && c.mountedShooters && !c.dismountedLH) opts.push({ v: 'dismountLH', label: 'Smonta e schermaglia (2 azioni)' });
  if (c.dismountedLH) opts.push({ v: 'remountLH', label: 'Rimonta a cavallo (2 azioni)' });
  if (u.companies.some((x) => x.type === 'billmen')) opts.push({ v: 'chopHedge', label: 'Apri un varco in una siepe (2 azioni)' });
  if (isArtillery(u)) return [];
  return opts;
}

function LeaderBar({ s, me, l, canMove, dispatch, close }: { s: GameState; me: Side; l: Leader; canMove: boolean; dispatch: (it: IntentIn) => boolean; close: () => void }) {
  const att = l.attachedTo ? s.units[l.attachedTo] : undefined;
  const a = s.activation;
  const active = s.phase === 'battle' && a?.kind === 'leader' && a.leaderId === l.id && a.side === me;
  const cls = ['Fuori combattimento', 'Ottuso', 'Comandante', 'Eroe'][l.cls] ?? '';
  return (
    <>
      <div className="fc-head">
        <span className={`fc-dot side-${l.side}`} />
        <span className="fc-title">
          {l.isCinC ? '♛ ' : ''}
          {l.name}
        </span>
        <button className="icon-btn" onClick={close} aria-label="Chiudi">
          ✕
        </button>
      </div>
      <div className="fc-sub">
        {l.rank} · {cls} ({'★'.repeat(l.cls)}) · {l.mounted ? 'a cavallo' : 'a piedi'} · {s.wards[l.wardId]?.name}
      </div>
      <div className="chips">
        {att ? <span className="chip">con {att.name}</span> : <span className="chip warn">isolato</span>}
        {active && <span className="chip good">Segnalini Ordine: {a!.tokensLeft}</span>}
        {l.needsRemount && <span className="chip warn">disarcionato</span>}
      </div>
      {l.side === me && canMove && <div className="fc-note">Trascinalo per muoverlo ({l.mounted ? 12 : 8}"); rilascialo su un'unità amica per aggregarlo. Muoversi costa un Segnalino Ordine.</div>}
      {active && (
        <div className="fc-actions">
          {(!l.mountSwapUsed || l.needsRemount) && <button onClick={() => dispatch({ t: 'mount', leaderId: l.id })}>{l.mounted ? 'Smonta' : 'Monta a cavallo'}</button>}
          {att && (att.disarray > 0 || att.daunted) && !att.meleeId && (
            <button onClick={() => dispatch({ t: 'leaderRally', leaderId: l.id, what: att.daunted ? 'daunted' : 'disarray' })}>✚ Riordina {att.name}</button>
          )}
        </div>
      )}
    </>
  );
}

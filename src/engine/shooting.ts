import { TROOPS, shootSaveTarget } from './data';
import { Ctx, fail } from './ctx';
import { closestPointOnPolygon, dist, distPointSegment, pointInPolygon, segmentsIntersect, frontCenter } from './geometry';
import { claimArmyMorale, leaderRiskFromKills, unitWipedOut } from './morale';
import type { Company, GameState, Unit } from './types';
import {
  isArtillery,
  isSkirmisher,
  leaderOf,
  liveUnits,
  perRank,
  unitHalfStrength,
  unitPoly,
  unitRect,
} from './units';
import { inShootingArc, lineOfSight, shootingRange } from './vision';

/** Compagnie che tirano per l'unità (il fronte di un blocco, entrambe in linea). */
export function shootingCompanies(u: Unit): Company[] {
  if (u.formation === 'line') return u.companies.filter(canCompanyShoot);
  const front = u.companies[0];
  return canCompanyShoot(front) ? [front] : [];
}

export function canCompanyShoot(c: Company): boolean {
  const p = TROOPS[c.type];
  if (!p.shoot || c.noShooting || c.figures <= 0) return false;
  if (c.dismountedKnights) return false;
  if (c.type === 'lightHorse') return false;
  if (c.type === 'archers' && (c.arrows ?? 0) <= 0) return false;
  return true;
}

export function maxShotsPerTurn(u: Unit): number {
  return u.companies[0].type === 'archers' ? 2 : 1;
}

function inWoodInterior(s: GameState, u: Unit): boolean {
  return !u.woodEdge && s.terrain.areas.some((a) => a.kind === 'wood' && pointInPolygon({ x: u.x, y: u.y }, a.points));
}

export function inBuildingArea(s: GameState, u: Unit): boolean {
  return s.terrain.areas.some((a) => (a.kind === 'building' || a.kind === 'builtUp') && pointInPolygon({ x: u.x, y: u.y }, a.points));
}

export interface ShotCheck {
  ok: boolean;
  reason?: string;
  range?: number;
  dice?: number;
  hitOn?: number;
  long?: boolean;
}

/** Portata massima e risultato per colpire. */
function rangeBand(s: GameState, shooter: Unit, range: number): { hitOn: number; long: boolean } | null {
  const p = TROOPS[shooter.companies[0].type].shoot!;
  let max = p.longRange ?? p.shortRange;
  if (isSkirmisher(shooter) && inWoodInterior(s, shooter)) max = Math.min(max, 6);
  if (range > max + 0.05) return null;
  if (p.longRange && range >= p.shortRange) return { hitOn: p.longHit!, long: true };
  return { hitOn: p.shortHit, long: false };
}

/** Numero di dadi che l'unità tira. */
export function shootingDice(shooter: Unit, target: Unit): number {
  if (isArtillery(shooter)) {
    const crew = shooter.companies[0].figures;
    if (crew < 2) return 0;
    let n = shooter.pivotedThisTurn ? crew : crew * 2;
    if (isSkirmisher(target) || isArtillery(target)) n = Math.ceil(n / 2);
    return n;
  }
  let n = 0;
  for (const c of shootingCompanies(shooter)) {
    const pr = perRank(c);
    const ranks = isSkirmisher(shooter) ? 99 : shooter.disarray > 0 || shooter.daunted || shooter.rumourDisarray ? 1 : 2;
    n += Math.min(c.figures, pr * ranks);
  }
  if (isSkirmisher(shooter) && (isSkirmisher(target) || isArtillery(target))) n = Math.ceil(n / 2);
  return n;
}

/** Verifica geometrica e di regolamento per un tiro (senza vincolo del bersaglio più vicino). */
export function basicShotCheck(s: GameState, shooter: Unit, target: Unit, opts: { reaction?: boolean } = {}): ShotCheck {
  if (target.side === shooter.side) return { ok: false, reason: 'Bersaglio amico' };
  if (target.removed || target.unplaced) return { ok: false, reason: 'Bersaglio non valido' };
  if (target.meleeId) return { ok: false, reason: 'Non si può tirare su truppe in mischia' };
  if (!opts.reaction && shooter.meleeId) return { ok: false, reason: 'Il tiratore è in mischia' };
  if (shootingCompanies(shooter).length === 0 && !isArtillery(shooter)) return { ok: false, reason: 'Nessuna compagnia in grado di tirare (frecce finite o armi abbandonate)' };
  if (isArtillery(shooter)) {
    const c = shooter.companies[0];
    if (shooter.gunDestroyed) return { ok: false, reason: 'Il pezzo è esploso' };
    if (!shooter.gunDeployed) return { ok: false, reason: 'Il pezzo è agganciato al traino' };
    if (c.figures < 2) return { ok: false, reason: 'Servono almeno due serventi' };
  }
  if (!isSkirmisher(shooter) && inBuildingArea(s, shooter)) return { ok: false, reason: 'Solo gli Schermagliatori tirano dagli edifici' };
  if (!isSkirmisher(shooter) && inWoodInterior(s, shooter)) return { ok: false, reason: "Solo gli Schermagliatori tirano dall'interno di un bosco (schierati al margine?)" };
  if (!inShootingArc(shooter, target)) return { ok: false, reason: "Fuori dall'arco di tiro (45°)" };
  const range = shootingRange(shooter, target);
  const band = rangeBand(s, shooter, range);
  if (!band) return { ok: false, reason: `Fuori portata (${range.toFixed(1)}")`, range };
  const fc = frontCenter(unitRect(shooter));
  const los = lineOfSight(s, fc, target, [shooter.id], { corridor: 2, shooter });
  if (!los.ok) return { ok: false, reason: los.reason, range };
  if (isArtillery(shooter)) {
    // La linea di tiro non deve passare entro 3" da truppe amiche.
    const to = closestPointOnPolygon(fc, unitPoly(target));
    for (const f of liveUnits(s, shooter.side)) {
      if (f.id === shooter.id || f.unplaced) continue;
      const poly = unitPoly(f);
      let d = Infinity;
      for (let i = 0; i < 4; i++) {
        if (segmentsIntersect(fc, to, poly[i], poly[(i + 1) % 4])) d = 0;
        d = Math.min(d, distPointSegment(poly[i], fc, to));
      }
      if (d < 3) return { ok: false, reason: `La linea di tiro passa entro 3" da ${f.name}`, range };
    }
  }
  let hitOn = band.hitOn;
  let long = band.long;
  if (opts.reaction) {
    long = false;
    hitOn = TROOPS[shooter.companies[0].type].shoot!.shortHit;
  }
  return { ok: true, range, hitOn, long, dice: shootingDice(shooter, target) };
}

/** Bersagli validi e quello (o quelli) che l'unità è obbligata a scegliere. */
export function validTargets(s: GameState, shooter: Unit): { target: Unit; check: ShotCheck; allowed: boolean; why?: string }[] {
  const res: { target: Unit; check: ShotCheck; allowed: boolean; why?: string }[] = [];
  const enemies = liveUnits(s).filter((u) => u.side !== shooter.side && !u.unplaced);
  for (const t of enemies) {
    const c = basicShotCheck(s, shooter, t);
    if (c.ok) res.push({ target: t, check: c, allowed: true });
  }
  if (res.length <= 1) return res;
  const leader = leaderOf(s, shooter);
  if (isArtillery(shooter)) {
    const shotAt = shooter.shotAtByThisTurn ?? [];
    const returnFire = res.filter((r) => shotAt.includes(r.target.id));
    if (returnFire.length) {
      for (const r of res) if (!shotAt.includes(r.target.id)) {
        r.allowed = false;
        r.why = "L'artiglieria deve rispondere al fuoco";
      }
      return res;
    }
    const formed = res.filter((r) => !isSkirmisher(r.target) && !isArtillery(r.target));
    const pool = formed.length ? formed : res;
    const min = Math.min(...pool.map((r) => r.check.range!));
    for (const r of res) if (!pool.includes(r) || r.check.range! > min + 0.5) {
      r.allowed = false;
      r.why = "L'artiglieria tira sulla Compagnia o Squadrone nemico più vicino";
    }
    return res;
  }
  if (leader) return res; // con un comandante può scegliere
  const min = Math.min(...res.map((r) => r.check.range!));
  if (shooter.formation === 'line' && shooter.companies.length === 2) {
    // Due compagnie in linea: il nemico più vicino a una delle due, se è nell'arco di entrambe.
    for (const r of res) if (r.check.range! > min + 0.5) {
      r.allowed = false;
      r.why = 'Si deve tirare sul bersaglio più vicino';
    }
    return res;
  }
  for (const r of res) if (r.check.range! > min + 0.5) {
    r.allowed = false;
    r.why = 'Si deve tirare sul bersaglio più vicino (aggrega un comandante per scegliere)';
  }
  return res;
}

function targetCover(s: GameState, shooter: Unit, target: Unit): boolean {
  const tc = target.companies[0];
  if (TROOPS[tc.type].arm === 'cavalry' && !tc.dismountedKnights) return false;
  if (inWoodInterior(s, target) || target.woodEdge) return true;
  if (inBuildingArea(s, target)) return true;
  if (target.companies.some((c) => c.pavises)) return true;
  // Muri, carri, barricate tra tiratore e bersaglio, a contatto con il bersaglio.
  const fc = frontCenter(unitRect(shooter));
  const tPoly = unitPoly(target);
  const to = closestPointOnPolygon(fc, tPoly);
  for (const l of s.terrain.lines) {
    if (l.kind !== 'wall' && l.kind !== 'fieldDefence') continue;
    for (let i = 0; i < l.points.length - 1; i++) {
      const a = l.points[i];
      const b = l.points[i + 1];
      const near = Math.min(...tPoly.map((p) => distPointSegment(p, a, b)));
      if (near <= 1.0 && (segmentsIntersect(fc, to, a, b) || distPointSegment(to, a, b) <= 1.0)) return true;
    }
  }
  return false;
}

/** Compagnia del bersaglio più vicina ai tiratori. */
function nearestCompanyIndex(shooter: Unit, target: Unit): number {
  if (target.companies.length === 1) return 0;
  const fc = frontCenter(unitRect(shooter));
  // Posizione dei centri delle due compagnie.
  const r = unitRect(target);
  const f = { x: Math.sin((r.facing * Math.PI) / 180), y: -Math.cos((r.facing * Math.PI) / 180) };
  const rt = { x: Math.cos((r.facing * Math.PI) / 180), y: Math.sin((r.facing * Math.PI) / 180) };
  let c0: { x: number; y: number };
  let c1: { x: number; y: number };
  if (target.formation === 'line') {
    c0 = { x: r.cx - (rt.x * r.w) / 4, y: r.cy - (rt.y * r.w) / 4 };
    c1 = { x: r.cx + (rt.x * r.w) / 4, y: r.cy + (rt.y * r.w) / 4 };
  } else {
    c0 = { x: r.cx + (f.x * r.d) / 4, y: r.cy + (f.y * r.d) / 4 };
    c1 = { x: r.cx - (f.x * r.d) / 4, y: r.cy - (f.y * r.d) / 4 };
  }
  return dist(fc, c0) <= dist(fc, c1) ? 0 : 1;
}

/** Applica perdite a una compagnia; restituisce le uccisioni effettive. */
export function applyKills(c: Company, n: number): number {
  const k = Math.min(n, c.figures);
  c.figures -= k;
  c.kills += k;
  return k;
}

/** Esegue un'azione di tiro (già validata). */
export function resolveShooting(ctx: Ctx, shooter: Unit, target: Unit, opts: { reaction?: boolean; free?: boolean } = {}): number {
  const s = ctx.s;
  const check = basicShotCheck(s, shooter, target, opts);
  if (!check.ok) fail(check.reason ?? 'Tiro non valido');
  const nDice = check.dice!;
  if (nDice <= 0) fail('Nessun dado da tirare');
  const prof = TROOPS[shooter.companies[0].type].shoot!;
  const veteranArchers = shooter.companies[0].type === 'archers' && shooter.companies[0].quality === 'veteran';
  const dice = veteranArchers
    ? ctx.dice.rollWithReroll(nDice, shooter.side, `Tiro di ${shooter.name}`, (v) => v === 1, target.id)
    : ctx.dice.roll(nDice, shooter.side, `Tiro di ${shooter.name}`, target.id);
  let hits = dice.filter((d) => d >= check.hitOn!).length;
  shooter.shotsThisTurn++;
  for (const c of shootingCompanies(shooter)) if (c.type === 'archers') c.arrows = Math.max(0, (c.arrows ?? 0) - 1);
  if (inBuildingArea(s, shooter) || inWoodInterior(s, shooter)) shooter.revealed = true;
  if (isArtillery(target)) target.shotAtByThisTurn = [...(target.shotAtByThisTurn ?? []), shooter.id];

  const rangeTxt = `${check.range!.toFixed(1)}" (${check.long ? 'lunga' : 'corta'} gittata, colpisce con ${check.hitOn}+)`;
  // Artiglieria: esplode con tre o più 1.
  if (prof.artillery && dice.filter((d) => d === 1).length >= 3) {
    shooter.gunDestroyed = true;
    ctx.log(`${shooter.name} tira ${nDice} dadi a ${rangeTxt}: tre o più 1, IL PEZZO ESPLODE ed è fuori gioco!`, 'combat', shooter.side);
    return 0;
  }
  if (hits === 0) {
    ctx.log(`${shooter.name} tira ${nDice} dadi su ${target.name} a ${rangeTxt}: nessun colpo.`, 'combat', shooter.side);
    return 0;
  }
  const ci = nearestCompanyIndex(shooter, target);
  const tc = target.companies[ci];
  let kills = 0;
  if (prof.artillery) {
    kills = applyKills(tc, hits);
    // Un blocco di picche subisce una perdita in più sulla compagnia posteriore.
    if (target.companies.length === 2 && target.companies.every((c) => c.type === 'pikemen') && target.formation !== 'line') {
      const rear = target.companies[1 - ci];
      kills += applyKills(rear, 1);
    }
    ctx.log(`${shooter.name} tira ${nDice} dadi su ${target.name} a ${rangeTxt}: ${hits} colpi, tutti mortali (artiglieria) → ${kills} perdite.`, 'combat', shooter.side);
  } else {
    const cover = targetCover(s, shooter, target);
    const save = shootSaveTarget(tc, { cover, armourPiercing: !!prof.armourPiercing });
    const saves = ctx.dice.roll(hits, target.side, `Salvezza ${target.name} (${save}+)`);
    const k = saves.filter((d) => d < save).length;
    kills = applyKills(tc, k);
    ctx.log(
      `${shooter.name} tira ${nDice} dadi su ${target.name} a ${rangeTxt}: ${hits} colpi. Salvezza su ${save}+${cover ? ' (in copertura)' : ''} → ${kills} perdite.`,
      'combat',
      shooter.side,
    );
  }
  if (kills > 0) {
    target.lossesThisTurn = true;
    if (target.wonMeleeThisTurn) target.lossesAfterWin = true;
    const l = leaderOf(s, target);
    leaderRiskFromKills(ctx, target, kills, l?.mounted ? 2 : 3);
  }
  cleanupDeadCompanies(ctx, target, 'tiro');
  if (!target.removed && unitHalfStrength(target)) ctx.log(`${target.name} è ridotta a metà forza o meno: testerà il morale a fine turno.`, 'morale', target.side);
  return kills;
}

/** Rimuove compagnie senza figure; se l'unità è vuota è annientata. */
export function cleanupDeadCompanies(ctx: Ctx, u: Unit, how: string) {
  const s = ctx.s;
  const alive = u.companies.filter((c) => c.figures > 0);
  if (alive.length === u.companies.length) return;
  if (alive.length === 0) {
    const l = leaderOf(s, u);
    if (l && how === 'tiro') {
      l.attachedTo = undefined;
      ctx.log(`${l.name} sopravvive all'annientamento di ${u.name} e si allontana.`, 'info', u.side);
    }
    unitWipedOut(ctx, u, how);
    return;
  }
  const dead = u.companies.filter((c) => c.figures <= 0);
  u.companies = alive;
  u.formation = 'single';
  ctx.log(`Una compagnia di ${u.name} (${dead.map((d) => TROOPS[d.type].name).join(', ')}) è stata annientata.`, 'important', u.side);
  const n = dead.filter((c) => TROOPS[c.type].arm === 'infantry' || TROOPS[c.type].arm === 'cavalry').length;
  if (n > 0) claimArmyMorale(ctx, u.side, u.daunted ? n : 2 * n, `compagnia di ${u.name} annientata`);
}

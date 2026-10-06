import { CHARGE_BONUS, MAX_KNIGHT_CHARGES, TROOPS, meleeDicePerFigure, meleeSaveTarget, shootSaveTarget } from './data';
import { Ctx, fail } from './ctx';
import { add, angleDiff, bearing, dist, mul, normAngle, pointInPolygon, polygonsOverlap, segmentIntersection, sub, frontCenter, distPointSegment } from './geometry';
import { attackSide, contactPosition, planMove } from './movement';
import { detachFromMelee, killLeader, leaderRiskFromKills, moraleTest, removeUnit, woundLeader, type MoraleResult } from './morale';
import { applyKills, cleanupDeadCompanies, shootingDice } from './shooting';
import type { Company, GameState, Leader, Melee, Side, Unit } from './types';
import { otherSide } from './types';
import {
  isArtillery,
  isCavalry,
  isInfantryCompany,
  isKern,
  isLoose,
  isSkirmisher,
  leaderOf,
  liveUnits,
  onHill,
  perRank,
  syncAttachedLeaders,
  unitMove,
  unitPoly,
  unitRect,
} from './units';
import { lineOfSight } from './vision';

// ---------------------------------------------------------------------------
// Verifiche per l'attacco
// ---------------------------------------------------------------------------

export interface AttackCheck {
  ok: boolean;
  reason?: string;
  side?: 'front' | 'left' | 'right' | 'rear';
  dest?: { x: number; y: number; facing: number };
  distance?: number;
  allowance?: number;
  charge?: boolean;
  chargeBonus?: boolean;
  disarray?: number;
  notes?: string[];
}

function isDefended(s: GameState, attacker: Unit, target: Unit): { obstacle: boolean; building: boolean; wall: boolean } {
  const a = { x: attacker.x, y: attacker.y };
  const t = { x: target.x, y: target.y };
  let obstacle = false;
  let wall = false;
  for (const l of s.terrain.lines) {
    for (let i = 0; i < l.points.length - 1; i++) {
      const hit = segmentIntersection(a, t, l.points[i], l.points[i + 1]);
      if (!hit) continue;
      // L'ostacolo è difeso se il difensore gli sta a ridosso.
      const near = Math.min(...unitPoly(target).map((p) => distPointSegment(p, l.points[i], l.points[i + 1])));
      if (near <= 1.2) {
        obstacle = true;
        if (l.kind === 'wall' || l.kind === 'fieldDefence') wall = true;
      }
    }
  }
  const building = s.terrain.areas.some((ar) => (ar.kind === 'building' || ar.kind === 'builtUp') && pointInPolygon(t, ar.points));
  return { obstacle, building, wall };
}

export function canAttackTarget(s: GameState, u: Unit, t: Unit): string | null {
  const c = u.companies[0];
  if (isArtillery(u)) return "L'artiglieria non può attaccare";
  if (u.daunted) return 'Le unità Scosse non possono attaccare';
  if (isSkirmisher(u) && !isKern(u)) return 'Gli Schermagliatori (tranne i Kern) non possono attaccare';
  if (u.companies.some((x) => x.quality === 'levy') && !leaderOf(s, u)) return 'Le truppe di Leva attaccano solo con un comandante aggregato';
  if (c.dismountedLH) return 'Gli schermagliatori appiedati non possono attaccare';
  if (isKern(u)) {
    const side = attackSide(u, t);
    const ok = isSkirmisher(t) || t.disarray > 0 || t.daunted || side !== 'front';
    if (!ok) return 'I Kern attaccano solo Schermagliatori, truppe in Disordine o Scosse, o un fianco/retro esposto';
  }
  if (t.side === u.side) return 'Bersaglio amico';
  return null;
}

export function checkAttack(s: GameState, u: Unit, t: Unit, opts: { charge?: boolean; manoeuvre?: boolean; firstAction?: boolean }): AttackCheck {
  const why = canAttackTarget(s, u, t);
  if (why) return { ok: false, reason: why };
  if (t.removed || t.unplaced) return { ok: false, reason: 'Bersaglio non valido' };
  // Visibilità all'inizio del movimento (dall'unità o dal comandante che dà l'ordine).
  const fc = frontCenter(unitRect(u));
  const los = lineOfSight(s, fc, t, [u.id]);
  const l = leaderOf(s, u);
  const los2 = l ? lineOfSight(s, { x: l.x, y: l.y }, t, [u.id]) : { ok: false };
  if (!los.ok && !los2.ok) return { ok: false, reason: `Il bersaglio non era visibile: ${los.reason}` };
  const side = t.meleeId ? attackSide(u, t) : attackSide(u, t);
  const dest = contactPosition(u, t, side);
  const charge = !!opts.charge;
  if (charge) {
    if (!isCavalry(u)) return { ok: false, reason: 'Solo la cavalleria può caricare' };
    if (u.companies[0].type === 'knights' && u.chargesUsed >= MAX_KNIGHT_CHARGES) return { ok: false, reason: 'I Cavalieri hanno già caricato due volte' };
  }
  const plan = planMove(s, u, { x: dest.x, y: dest.y }, { charge, manoeuvre: opts.manoeuvre, ignoreUnits: [t.id], allowContact: [t.id] });
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const distance = plan.distance;
  let chargeBonus = false;
  if (charge) {
    const full = (unitMove(u, false) ?? 0) + CHARGE_BONUS;
    if (distance < full / 2 - 0.05) return { ok: false, reason: `Una carica deve partire ad almeno ${full / 2}" dal nemico` };
    const straight = Math.abs(angleDiff(bearing({ x: u.x, y: u.y }, dest), u.facing)) <= 20;
    const uphill = onHill(s, { x: t.x, y: t.y }) && !onHill(s, { x: u.x, y: u.y });
    chargeBonus = straight && !uphill && !plan.badGoing;
  }
  return { ok: true, side, dest: plan.truncated ? undefined : dest, distance, allowance: plan.allowance, charge, chargeBonus, disarray: plan.disarray, notes: plan.notes, ...(plan.truncated ? { ok: false, reason: "Un ostacolo interrompe il movimento prima del contatto" } : {}) };
}

// ---------------------------------------------------------------------------
// Esecuzione dell'attacco e reazioni
// ---------------------------------------------------------------------------

function newMelee(ctx: Ctx, attacker: Unit, defender: Unit): Melee {
  const id = ctx.newId('m');
  const m: Melee = {
    id,
    attackers: [attacker.id],
    defenders: [defender.id],
    round: 0,
    flanked: {},
    charged: [],
    uphill: [],
    acrossObstacle: [],
    intoBuilding: [],
    followUp: [],
    startedTurn: ctx.s.turn,
    targets: { [attacker.id]: defender.id, [defender.id]: attacker.id },
    turned: [],
    wipedFormation: [],
    stage: 'fight',
  };
  ctx.s.melees[id] = m;
  attacker.meleeId = id;
  defender.meleeId = id;
  return m;
}

/** Esegue un attacco: movimento a contatto, reazione del difensore, primo round. */
export function performAttack(ctx: Ctx, u: Unit, t: Unit, opts: { charge?: boolean; manoeuvre?: boolean; ambush?: boolean }) {
  const s = ctx.s;
  const oneAction = u.actionsUsed === 0 || !!opts.manoeuvre;
  const chk = checkAttack(s, u, t, opts);
  if (!chk.ok || !chk.dest) fail(chk.reason ?? 'Attacco non valido');
  const startPos = { x: u.x, y: u.y };
  const def = defendedInfo(s, u, t);
  // Muovi l'attaccante a contatto.
  u.x = chk.dest.x;
  u.y = chk.dest.y;
  u.facing = chk.dest.facing;
  u.disarray = Math.min(2, u.disarray + (chk.disarray ?? 0));
  if (chk.charge) {
    if (u.companies[0].type === 'knights') u.chargesUsed++;
  }
  syncAttachedLeaders(s, u);
  const sideName = { front: 'fronte', left: 'fianco sinistro', right: 'fianco destro', rear: 'retro' }[chk.side!];
  ctx.log(
    `${u.name} ${chk.charge ? 'CARICA' : 'attacca'} ${t.name} sul ${sideName} (${chk.distance!.toFixed(1)}"${chk.notes?.length ? '; ' + chk.notes.join(', ') : ''}).`,
    'combat',
    u.side,
  );

  // Attacco a una mischia già in corso: si unisce.
  if (t.meleeId && s.melees[t.meleeId]) {
    const m = s.melees[t.meleeId];
    const mySide = m.attackers.includes(t.id) ? 'defenders' : 'attackers';
    m[mySide].push(u.id);
    m.targets[u.id] = t.id;
    u.meleeId = m.id;
    if (chk.side !== 'front') m.flanked[t.id] = chk.side === 'rear' ? 'rear' : 'flank';
    if (chk.chargeBonus) m.charged.push(u.id);
    if (def.uphill) m.uphill.push(u.id);
    if (def.obstacle) m.acrossObstacle.push(u.id);
    if (def.building) m.intoBuilding.push(u.id);
    // Rischio di "tradimento": truppe di un'altra Schiera sul fianco di una mischia in corso.
    if (chk.side === 'left' || chk.side === 'right') {
      const friends = m[mySide].filter((id) => id !== u.id).map((id) => s.units[id]).filter((f) => f && f.wardId !== u.wardId);
      for (const f of friends) {
        moraleTest(ctx, f, { reason: 'truppe di un\'altra Schiera attaccano sul fianco della mischia (tradimento?)', enemyFacing: undefined });
        if (s.phase === 'gameOver') return;
      }
    }
    ctx.log(`${u.name} si unisce alla mischia: si combatte subito un nuovo round.`, 'combat', u.side);
    enqueueMelee(s, m.id, true);
    return;
  }

  const m = newMelee(ctx, u, t);
  if (chk.chargeBonus) m.charged.push(u.id);
  if (def.uphill) m.uphill.push(u.id);
  if (def.obstacle) {
    m.acrossObstacle.push(u.id);
    if (isCavalry(u)) {
      u.disarray = Math.min(2, u.disarray + 1);
      ctx.log(`${u.name} attacca attraverso un ostacolo difeso e va in Disordine.`, 'combat', u.side);
    }
  }
  if (def.building) m.intoBuilding.push(u.id);

  // Reazione: girarsi verso un attacco sul fianco o sul retro.
  let side = chk.side!;
  if (side !== 'front') {
    const canTurn = !opts.ambush && !oneAction && t.formation !== 'hedgehog';
    if (canTurn && !isLoose(t) && !isArtillery(t)) {
      t.facing = normAngle(u.facing + 180);
      const back = contactPosition(u, t, 'front');
      u.x = back.x;
      u.y = back.y;
      syncAttachedLeaders(s, u);
      m.turned.push(t.id);
      ctx.log(`${t.name} si gira per fronteggiare l'attacco (nessun Disordine).`, 'combat', t.side);
      side = 'front';
    } else if (t.formation !== 'hedgehog' && !isLoose(t)) {
      m.flanked[t.id] = side === 'rear' ? 'rear' : 'flank';
      ctx.log(`${t.name} non fa in tempo a girarsi: attaccata sul ${sideName}!`, 'combat', t.side);
    }
  }
  const ctxR = { meleeId: m.id, attackerId: u.id, defenderId: t.id, oneAction, startPos, side, charge: !!chk.charge };
  reaction(ctx, ctxR);
}

interface ReactionCtx {
  meleeId: string;
  attackerId: string;
  defenderId: string;
  oneAction: boolean;
  startPos: { x: number; y: number };
  side: 'front' | 'left' | 'right' | 'rear';
  charge: boolean;
  choice?: string;
}

function defendedInfo(s: GameState, u: Unit, t: Unit) {
  const d = isDefended(s, u, t);
  const uphill = isInfantryCompany(u) && onHill(s, { x: t.x, y: t.y }) && !onHill(s, { x: u.x, y: u.y });
  return { ...d, uphill };
}

function behindStakes(s: GameState, u: Unit): boolean {
  const poly = unitPoly(u);
  return s.terrain.lines.some(
    (l) => (l.kind === 'stakes' || l.kind === 'fieldDefence') && l.points.some((_, i) => i < l.points.length - 1 && Math.min(...poly.map((p) => distPointSegment(p, l.points[i], l.points[i + 1]))) <= 1.5),
  );
}

/** Reazione del difensore in base al tipo di truppa. Può chiedere una decisione al giocatore. */
export function reaction(ctx: Ctx, r: ReactionCtx) {
  const s = ctx.s;
  const u = s.units[r.attackerId];
  const t = s.units[r.defenderId];
  const m = s.melees[r.meleeId];
  if (!u || !t || !m) return;
  const tc = t.companies[0];
  const cavAttacker = isCavalry(u);
  const caughtByCav = cavAttacker && r.oneAction;
  const flankFacing = r.side !== 'front';

  // Picche in blocco: possono formare il riccio.
  if (t.formation === 'block' && t.companies.every((c) => c.type === 'pikemen')) {
    if (!r.choice) {
      ctx.ask({ side: t.side, kind: 'reaction', prompt: `${t.name} è attaccata da ${u.name}. Formare il "riccio" (nessun fianco né retro, ma immobile)?`, options: [{ value: 'hedgehog', label: 'Forma il riccio' }, { value: 'stand', label: 'Resta in blocco' }], ctx: r });
      return;
    }
    if (r.choice === 'hedgehog') {
      t.formation = 'hedgehog';
      delete m.flanked[t.id];
      ctx.log(`${t.name} forma il riccio di picche.`, 'combat', t.side);
    }
    return startFight(ctx, m.id);
  }

  if (isInfantryCompany(t) && tc.type !== 'archers') return startFight(ctx, m.id);

  if (isArtillery(t)) {
    if (t.gunDeployed && !t.gunDestroyed && t.shotsThisTurn === 0 && t.companies[0].figures >= 2) {
      ctx.log(`${t.name} resta al pezzo e spara a bruciapelo!`, 'combat', t.side);
      reactionShot(ctx, t, u);
      if (u.removed || !u.meleeId) return;
      return startFight(ctx, m.id);
    }
    ctx.log(`I serventi di ${t.name} fuggono e non tornano.`, 'combat', t.side);
    detachFromMelee(ctx, t);
    removeUnit(ctx, t, 'serventi in fuga');
    return;
  }

  if (isSkirmisher(t)) {
    if (caughtByCav) {
      ctx.log(`${t.name} tenta di sganciarsi ma la cavalleria la raggiunge!`, 'combat', t.side);
      return startFight(ctx, m.id);
    }
    return doEvade(ctx, t, u, m);
  }

  if (tc.type === 'knights') {
    if (cavAttacker) {
      ctx.log(`${t.name} contro-carica la cavalleria nemica!`, 'combat', t.side);
      if (t.chargesUsed < MAX_KNIGHT_CHARGES) {
        t.chargesUsed++;
        m.charged.push(t.id);
      }
      return startFight(ctx, m.id);
    }
    if (!r.choice) {
      ctx.ask({ side: t.side, kind: 'reaction', prompt: `${t.name} è attaccata dalla fanteria ${u.name}. Come reagisce?`, options: [{ value: 'counter', label: 'Contro-carica' }, { value: 'evade', label: 'Si sgancia (evade)' }], ctx: r });
      return;
    }
    if (r.choice === 'evade') return doEvade(ctx, t, u, m);
    if (t.chargesUsed < MAX_KNIGHT_CHARGES) {
      t.chargesUsed++;
      m.charged.push(t.id);
    }
    ctx.log(`${t.name} contro-carica!`, 'combat', t.side);
    return startFight(ctx, m.id);
  }

  if (tc.type === 'lightHorse') {
    if (!r.choice) {
      ctx.ask({ side: t.side, kind: 'reaction', prompt: `${t.name} è attaccata da ${u.name}. Come reagisce?`, options: [{ value: 'counter', label: 'Contro-carica' }, { value: 'evade', label: 'Si sgancia fino a 14"' }], ctx: r });
      return;
    }
    if (r.choice === 'evade') return doEvade(ctx, t, u, m, 14);
    ctx.log(`${t.name} contro-carica!`, 'combat', t.side);
    return startFight(ctx, m.id);
  }

  if (tc.type === 'archers') {
    if (flankFacing && m.turned.includes(t.id)) {
      ctx.log(`${t.name} si è girata verso l'attacco sul fianco: combatte senza tirare.`, 'combat', t.side);
      return startFight(ctx, m.id);
    }
    if (m.flanked[t.id]) return startFight(ctx, m.id);
    const canShoot = t.companies[0].figures > 0 && !t.companies[0].noShooting && (t.companies[0].arrows ?? 0) > 0;
    const mixedFront = t.formation === 'mixed';
    const chooses = t.companies[0].quality === 'veteran' || !!leaderOf(s, t) || behindStakes(s, t);
    let choice = r.choice;
    if (!choice && chooses) {
      const opts = [{ value: 'shoot', label: 'Tira una volta a corta gittata' }, { value: 'evade', label: mixedFront ? 'Scambia posto con la compagnia dietro' : 'Si sgancia (evade)' }];
      if (!canShoot) opts.shift();
      opts.push({ value: 'stand', label: 'Resta e combatte' });
      ctx.ask({ side: t.side, kind: 'reaction', prompt: `${t.name} (può scegliere la reazione) è attaccata da ${u.name}.`, options: opts, ctx: r });
      return;
    }
    if (!choice) {
      const levyOrDaunted = t.companies[0].quality === 'levy' || t.daunted;
      const d = levyOrDaunted ? ctx.dice.rollWithReroll(1, t.side, `Reazione ${t.name}`, (v) => v === 6) : ctx.dice.roll(1, t.side, `Reazione ${t.name}`);
      choice = d[0] >= 4 ? 'shoot' : 'evade';
      ctx.log(`Reazione degli arcieri ${t.name}: ${d[0]} → ${choice === 'shoot' ? 'tirano!' : mixedFront ? 'si ritirano dietro la compagnia di supporto' : 'si sganciano'}`, 'combat', t.side);
    }
    if (choice === 'shoot') {
      if (canShoot) reactionShot(ctx, t, u);
      else ctx.log(`${t.name} non ha più frecce: resta e combatte.`, 'combat', t.side);
      if (u.removed || !s.melees[m.id]) return;
      return startFight(ctx, m.id);
    }
    if (choice === 'stand') return startFight(ctx, m.id);
    if (mixedFront && t.companies.length === 2) {
      t.companies.reverse();
      ctx.log(`Gli arcieri di ${t.name} si ritirano dietro la compagnia di supporto, che riceve l'attacco.`, 'combat', t.side);
      return startFight(ctx, m.id);
    }
    if (caughtByCav) {
      ctx.log(`${t.name} tenta di sganciarsi ma la cavalleria la raggiunge!`, 'combat', t.side);
      return startFight(ctx, m.id);
    }
    return doEvade(ctx, t, u, m);
  }
  return startFight(ctx, m.id);
}

/** Tiro di reazione a corta gittata. */
export function reactionShot(ctx: Ctx, shooter: Unit, target: Unit) {
  const s = ctx.s;
  const prof = TROOPS[shooter.companies[0].type].shoot;
  if (!prof) return;
  const n = shootingDice(shooter, target);
  if (n <= 0) return;
  const vet = shooter.companies[0].type === 'archers' && shooter.companies[0].quality === 'veteran';
  const dice = vet ? ctx.dice.rollWithReroll(n, shooter.side, `Tiro di reazione ${shooter.name}`, (v) => v === 1) : ctx.dice.roll(n, shooter.side, `Tiro di reazione ${shooter.name}`);
  shooter.shotsThisTurn++;
  for (const c of shooter.companies) if (c.type === 'archers') c.arrows = Math.max(0, (c.arrows ?? 0) - 1);
  if (prof.artillery && dice.filter((d) => d === 1).length >= 3) {
    shooter.gunDestroyed = true;
    ctx.log(`${shooter.name}: il pezzo esplode!`, 'combat', shooter.side);
    return;
  }
  const hits = dice.filter((d) => d >= prof.shortHit).length;
  const tc = target.companies[0];
  let kills: number;
  if (prof.artillery) kills = applyKills(tc, hits);
  else {
    const save = shootSaveTarget(tc, { cover: false, armourPiercing: !!prof.armourPiercing });
    const saves = hits ? ctx.dice.roll(hits, target.side, `Salvezza ${target.name} (${save}+)`) : [];
    kills = applyKills(tc, saves.filter((d) => d < save).length);
  }
  ctx.log(`${shooter.name} tira ${n} dadi a bruciapelo: ${hits} colpi → ${kills} perdite a ${target.name}.`, 'combat', shooter.side);
  if (kills > 0) {
    target.lossesThisTurn = true;
    leaderRiskFromKills(ctx, target, kills, leaderOf(s, target)?.mounted ? 2 : 3);
  }
  cleanupDeadCompanies(ctx, target, 'tiro');
}

/** Sganciamento: dietro-front, un Disordine, un movimento lontano dal nemico. */
function doEvade(ctx: Ctx, t: Unit, u: Unit, m: Melee, distOverride?: number) {
  const s = ctx.s;
  detachFromMelee(ctx, t);
  detachFromMelee(ctx, u);
  const away = bearing({ x: u.x, y: u.y }, { x: t.x, y: t.y });
  t.facing = away;
  t.disarray = Math.min(2, t.disarray + 1);
  const d = distOverride ?? unitMove(t, false) ?? 6;
  const dir = { x: Math.sin((away * Math.PI) / 180), y: -Math.cos((away * Math.PI) / 180) };
  let moved = 0;
  const start = { x: t.x, y: t.y };
  for (let step = 0.25; step <= d + 0.001; step += 0.25) {
    const p = add(start, mul(dir, step));
    const poly = unitPoly(t, { x: p.x, y: p.y, facing: t.facing });
    if (liveUnits(s).some((o) => o.id !== t.id && o.id !== u.id && !o.unplaced && o.side !== t.side && polygonsOverlap(poly, unitPoly(o)))) break;
    moved = step;
  }
  const dest = add(start, mul(dir, moved));
  t.x = dest.x;
  t.y = dest.y;
  syncAttachedLeaders(s, t);
  const off = dest.x < 0 || dest.y < 0 || dest.x > s.table.width || dest.y > s.table.height;
  if (off) {
    t.offTable = true;
    removeUnit(ctx, t, 'sganciata fuori dal tavolo');
    ctx.log(`${t.name} si sgancia fuori dal tavolo e non torna (nessuna perdita di Morale d'Armata).`, 'combat', t.side);
  } else ctx.log(`${t.name} si sgancia di ${moved.toFixed(1)}" (dietro-front e un Disordine).`, 'combat', t.side);
  // L'attaccante si ferma nella posizione originale del nemico.
  ctx.log(`${u.name} si ferma sulla posizione lasciata dal nemico.`, 'combat', u.side);
}

// ---------------------------------------------------------------------------
// Coda delle mischie e duelli
// ---------------------------------------------------------------------------

export function enqueueMelee(s: GameState, id: string, front = false) {
  if (s.meleeQueue.includes(id)) return;
  if (front) s.meleeQueue.unshift(id);
  else s.meleeQueue.push(id);
}

function startFight(ctx: Ctx, meleeId: string) {
  enqueueMelee(ctx.s, meleeId, true);
}

/** Processa la coda delle mischie finché non serve una decisione dei giocatori. */
export function processMeleeQueue(ctx: Ctx) {
  const s = ctx.s;
  while (s.meleeQueue.length && s.pending.length === 0 && s.phase !== 'gameOver') {
    const id = s.meleeQueue[0];
    const m = s.melees[id];
    if (!m) {
      s.meleeQueue.shift();
      continue;
    }
    // Duello tra Comandanti in Capo.
    if (!m.duelDone) {
      const la = findCinC(s, m.attackers);
      const ld = findCinC(s, m.defenders);
      if (la && ld) {
        ctx.ask({
          side: ld.side,
          kind: 'duel',
          prompt: `I due Comandanti in Capo si fronteggiano nella mischia! ${ld.name} accetta il duello con ${la.name}?`,
          options: [
            { value: 'duel', label: 'Accetta il duello' },
            { value: 'quit', label: 'Abbandona la mischia (Test del Morale per l\'unità)' },
          ],
          ctx: { meleeId: id, a: la.id, d: ld.id },
        });
        return;
      }
      m.duelDone = true;
    }
    s.meleeQueue.shift();
    fightRound(ctx, m);
  }
}

function findCinC(s: GameState, ids: string[]): Leader | undefined {
  for (const id of ids) {
    const l = Object.values(s.leaders).find((x) => x.attachedTo === id && x.isCinC && !x.killed);
    if (l) return l;
  }
  return undefined;
}

export function answerDuel(ctx: Ctx, d: { meleeId: string; a: string; d: string }, choice: string) {
  const s = ctx.s;
  const m = s.melees[d.meleeId];
  const la = s.leaders[d.a];
  const ld = s.leaders[d.d];
  if (!m) return;
  m.duelDone = true;
  if (choice === 'quit') {
    const u = s.units[ld.attachedTo!];
    ld.attachedTo = undefined;
    ld.x += 2;
    ctx.log(`${ld.name} rifiuta il duello e abbandona la mischia!`, 'important', ld.side);
    if (u) moraleTest(ctx, u, { reason: 'il Comandante in Capo ha rifiutato il duello' });
    return;
  }
  let wa = 0;
  let wd = 0;
  for (let round = 1; round <= 3 && wa < 2 && wd < 2; round++) {
    if (round === 1 && la.cls >= 3 && ld.cls < 3) {
      wa++;
      ctx.log(`Duello, 1° scontro: l'Eroe ${la.name} vince automaticamente.`, 'combat');
      continue;
    }
    if (round === 1 && ld.cls >= 3 && la.cls < 3) {
      wd++;
      ctx.log(`Duello, 1° scontro: l'Eroe ${ld.name} vince automaticamente.`, 'combat');
      continue;
    }
    let ra = 0;
    let rd = 0;
    while (ra === rd) {
      ra = ctx.dice.roll(1, la.side, `Duello ${la.name}`)[0];
      rd = ctx.dice.roll(1, ld.side, `Duello ${ld.name}`)[0];
    }
    if (ra > rd) wa++;
    else wd++;
    ctx.log(`Duello, ${round}° scontro: ${la.name} ${ra} – ${rd} ${ld.name}`, 'combat');
  }
  const loser = wa >= 2 ? ld : la;
  killLeader(ctx, loser, 'ucciso in duello');
}

// ---------------------------------------------------------------------------
// Round di mischia
// ---------------------------------------------------------------------------

function sideOf(m: Melee, id: string): 'attackers' | 'defenders' {
  return m.attackers.includes(id) ? 'attackers' : 'defenders';
}

function figuresFighting(s: GameState, m: Melee, u: Unit): { comp: Company; figs: number }[] {
  const res: { comp: Company; figs: number }[] = [];
  const disordered = u.disarray > 0 || u.daunted || !!u.rumourDisarray;
  const flank = m.flanked[u.id];
  const attacking = m.attackers.includes(u.id) && m.round === 0;
  const comps = u.companies;
  if (isCavalry(u) || isSkirmisher(u)) {
    const c = comps[0];
    let f = c.figures;
    if (flank) f = Math.ceil(perRank(c) / 2);
    if (disordered && (isCavalry(u) || isKern(u))) f = Math.ceil(f / 2);
    res.push({ comp: c, figs: Math.min(f, c.figures) });
    return res;
  }
  if (isArtillery(u)) {
    res.push({ comp: comps[0], figs: comps[0].figures });
    return res;
  }
  // Fanteria
  if (u.formation === 'line' && comps.length === 2) {
    for (const c of comps) {
      let f = disordered ? Math.min(c.figures, perRank(c)) : c.figures;
      if (flank) f = Math.min(f, Math.ceil(perRank(c) / 2));
      res.push({ comp: c, figs: f });
    }
    if (flank) res.splice(1); // sul fianco combatte solo la compagnia d'estremità
    return res;
  }
  const front = comps[0];
  const rear = comps[1];
  if (flank) {
    if (comps.length === 2) {
      // Blocco attaccato sul fianco: solo la fila d'estremità (una figura per rango).
      const ranksF = Math.ceil(front.figures / perRank(front));
      const ranksR = Math.ceil(rear.figures / perRank(rear));
      res.push({ comp: front, figs: Math.min(front.figures, ranksF) });
      res.push({ comp: rear, figs: Math.min(rear.figures, ranksR) });
      return res;
    }
    res.push({ comp: front, figs: Math.min(front.figures, Math.ceil(perRank(front) / 2)) });
    return res;
  }
  if (disordered) {
    res.push({ comp: front, figs: Math.min(front.figures, perRank(front)) });
    return res;
  }
  if (m.intoBuilding.includes(u.id)) {
    res.push({ comp: front, figs: Math.min(front.figures, perRank(front)) });
    return res;
  }
  res.push({ comp: front, figs: Math.min(front.figures, perRank(front) * 2) });
  if (rear && !m.acrossObstacle.includes(u.id)) {
    const pikeBlock = front.type === 'pikemen' && rear.type === 'pikemen';
    if (pikeBlock && attacking) res.push({ comp: rear, figs: Math.min(rear.figures, perRank(rear) * 2) });
    else if (pikeBlock && u.formation === 'hedgehog') res.push({ comp: rear, figs: Math.min(rear.figures, perRank(rear)) });
    else if (m.round < 2) res.push({ comp: rear, figs: Math.min(rear.figures, perRank(rear)) });
  }
  return res;
}

function leaderBonus(s: GameState, u: Unit): number {
  const l = leaderOf(s, u);
  if (!l) return 0;
  if (isCavalry(u) && !l.mounted) return 0;
  return l.cls;
}

/** Determina come applicare i ritiri al lancio per colpire. */
function hitRerolls(s: GameState, m: Melee, u: Unit, opp: Unit, roundIdx: number, sideWonFirst: boolean): { rr: (v: number) => boolean; label: string } {
  const none = { rr: () => false, label: '' };
  const isAtt = m.attackers.includes(u.id);
  if (roundIdx >= 3) return none;
  if (roundIdx === 2) return sideWonFirst ? { rr: (v) => v === 1, label: 'ritira gli 1 (ha vinto il 1° round)' } : none;
  // Primo round
  if (isAtt) {
    if (isCavalry(u) && opp.companies.some((c) => c.type === 'pikemen')) return none;
    if (u.disarray > 0 || u.daunted) return none;
    if (m.uphill.includes(u.id)) return none;
    if (m.acrossObstacle.includes(u.id) || m.intoBuilding.includes(u.id)) return none;
  }
  if (m.charged.includes(u.id) && u.companies[0].type === 'knights' && !opp.companies.some((c) => c.type === 'pikemen')) return { rr: (v) => v <= 3, label: 'carica: ritira 1-3' };
  if (isCavalry(u) && opp.companies.some((c) => c.type === 'pikemen')) return none;
  const vet = u.companies[0].quality === 'veteran';
  if (vet || isAtt || m.followUp.includes(u.id)) return { rr: (v) => v === 1, label: vet ? 'veterani: ritira gli 1' : 'attacca: ritira gli 1' };
  return none;
}

function defenderCover(s: GameState, m: Melee, def: Unit, att: Unit): boolean {
  if (!m.defenders.includes(def.id)) return false;
  if (m.intoBuilding.includes(att.id)) return true;
  const d = isDefended(s, att, def);
  return d.wall;
}

/** Applica i colpi a un'unità; ritorna le perdite. */
function applyMeleeHits(ctx: Ctx, m: Melee, target: Unit, hits: number, from: Unit): number {
  const s = ctx.s;
  if (hits <= 0 || target.removed) return 0;
  const cover = defenderCover(s, m, target, from);
  const comps = target.companies;
  let kills = 0;
  if (comps.length === 2 && m.flanked[target.id] === 'flank' && target.formation !== 'line') {
    const h0 = Math.ceil(hits / 2);
    const h1 = hits - h0;
    kills += saveAndKill(ctx, target, comps[0], h0, cover);
    kills += saveAndKill(ctx, target, comps[1], h1, cover);
    return kills;
  }
  const front = comps[0];
  const save0 = meleeSaveTarget(front, { cover });
  const dice = ctx.dice.roll(hits, target.side, `Salvezza ${target.name} (${save0}+)`);
  let k = dice.filter((d) => d < save0).length;
  const applied = applyKills(front, k);
  kills += applied;
  let over = k - applied;
  if (over > 0 && comps[1] && target.formation !== 'line') {
    const rear = comps[1];
    const save1 = meleeSaveTarget(rear, { cover });
    if (save1 < save0) {
      const re = ctx.dice.roll(over, target.side, `Salvezza (sfondamento) ${target.name} (${save1}+)`);
      over = re.filter((d) => d < save1).length;
    }
    kills += applyKills(rear, over);
  } else if (over > 0 && comps[1]) {
    kills += applyKills(comps[1], over);
  }
  return kills;
}

function saveAndKill(ctx: Ctx, u: Unit, c: Company, hits: number, cover: boolean): number {
  if (hits <= 0) return 0;
  const save = meleeSaveTarget(c, { cover });
  const d = ctx.dice.roll(hits, u.side, `Salvezza ${u.name} (${save}+)`);
  return applyKills(c, d.filter((x) => x < save).length);
}

/** Combatte un round della mischia e ne applica le conseguenze. */
export function fightRound(ctx: Ctx, m: Melee) {
  const s = ctx.s;
  const units = (ids: string[]) => ids.map((id) => s.units[id]).filter((u) => u && !u.removed);
  const atts = units(m.attackers);
  const defs = units(m.defenders);
  if (!atts.length || !defs.length) {
    for (const u of [...atts, ...defs]) detachFromMelee(ctx, u);
    delete s.melees[m.id];
    return;
  }
  const roundIdx = m.round + 1;
  const hitOn = roundIdx === 1 ? 4 : 5;
  ctx.log(`— Mischia: ${atts.map((u) => u.name).join(' + ')} contro ${defs.map((u) => u.name).join(' + ')} — round ${roundIdx} (colpisce con ${hitOn}+)`, 'combat');
  const wonFirst = m.firstRoundWinner;
  // Calcola tutti i colpi prima di applicare le perdite (combattimento simultaneo).
  const hitsOn: Record<string, { hits: number; from: Unit }[]> = {};
  const lines: string[] = [];
  for (const u of [...atts, ...defs]) {
    const isAtt = m.attackers.includes(u.id);
    const oppPool = isAtt ? defs : atts;
    let opp = s.units[m.targets[u.id]];
    if (!opp || opp.removed || !oppPool.includes(opp)) opp = oppPool[0];
    m.targets[u.id] = opp.id;
    const parts = figuresFighting(s, m, u);
    let dice = 0;
    for (const p of parts) dice += p.figs * meleeDicePerFigure(p.comp);
    dice = Math.ceil(dice - 1e-9);
    const sideWonFirst = wonFirst === u.side;
    const rr = hitRerolls(s, m, u, opp, roundIdx, sideWonFirst);
    const rolled = dice > 0 ? ctx.dice.rollWithReroll(dice, u.side, `Mischia ${u.name}`, rr.rr, opp.id) : [];
    let hits = rolled.filter((d) => d >= hitOn).length;
    const lb = leaderBonus(s, u);
    hits += lb;
    (hitsOn[opp.id] ??= []).push({ hits, from: u });
    lines.push(`${u.name}: ${parts.map((p) => p.figs).join('+')} figure → ${dice} dadi${rr.label ? ' (' + rr.label + ')' : ''}${lb ? `, +${lb} colpi dal comandante` : ''} = ${hits} colpi`);
  }
  ctx.log(lines.join(' · '), 'combat');
  // Applica le perdite.
  const killsBySide: Record<'attackers' | 'defenders', number> = { attackers: 0, defenders: 0 };
  const killsByUnit: Record<string, number> = {};
  for (const [tid, arr] of Object.entries(hitsOn)) {
    const t = s.units[tid];
    if (!t) continue;
    const before = t.companies.length;
    let k = 0;
    for (const h of arr) k += applyMeleeHits(ctx, m, t, h.hits, h.from);
    killsByUnit[tid] = k;
    killsBySide[sideOf(m, tid)] += k;
    if (k > 0) {
      t.lossesThisTurn = true;
      if (t.wonMeleeThisTurn) t.lossesAfterWin = true;
    }
    ctx.log(`${t.name} subisce ${k} perdite.`, 'combat', t.side);
    const leader = leaderOf(s, t);
    const wiped = t.companies.every((c) => c.figures <= 0);
    if (wiped && leader) {
      killLeader(ctx, leader, `cade con ${t.name}`);
      if (s.phase === 'gameOver') return;
    } else if (leader && k > 3) {
      leaderRiskFromKills(ctx, t, k, 3);
      if (s.phase === 'gameOver') return;
    }
    const partial = before === 2 && t.companies.filter((c) => c.figures > 0).length === 1;
    cleanupDeadCompanies(ctx, t, 'mischia');
    if (partial && !t.removed) m.wipedFormation.push(t.id);
    if (s.phase === 'gameOver') return;
  }
  m.round = roundIdx;
  const aSide = atts[0].side;
  const dSide = defs[0].side;
  let loser: 'attackers' | 'defenders' | null = null;
  if (killsBySide.attackers > killsBySide.defenders) loser = 'attackers';
  else if (killsBySide.defenders > killsBySide.attackers) loser = 'defenders';
  if (roundIdx === 1) m.firstRoundWinner = loser === null ? 'tie' : loser === 'attackers' ? dSide : aSide;
  ctx.log(
    loser === null
      ? `Round ${roundIdx}: pareggio (${killsBySide.attackers} a ${killsBySide.defenders} perdite).`
      : `Round ${roundIdx}: ${loser === 'attackers' ? 'gli attaccanti' : 'i difensori'} perdono (${killsBySide[loser]} perdite contro ${killsBySide[loser === 'attackers' ? 'defenders' : 'attackers']}).`,
    'combat',
  );
  m.followUp = [];
  const winners = loser ? units(loser === 'attackers' ? m.defenders : m.attackers) : [];
  for (const w of winners) w.wonMeleeThisTurn = true;
  // Perdenti: Test di Crisi del Morale immediato.
  const results: Record<string, MoraleResult> = {};
  if (loser) {
    for (const l of units(m[loser])) {
      const winnerFacing = winners[0]?.facing;
      const res = moraleTest(ctx, l, {
        reason: 'ha perso un round di mischia',
        lostMelee: true,
        afterMelee: true,
        flankAttack: !!m.flanked[l.id],
        scope: 'unit',
        companyIdx: 0,
        enemyFacing: winnerFacing,
        forceFail: m.wipedFormation.includes(l.id),
      });
      results[l.id] = res;
      if (s.phase === 'gameOver') return;
    }
  }
  // Formazioni che hanno perso una compagnia ma non hanno perso il round: test comunque.
  for (const id of m.wipedFormation) {
    const u = s.units[id];
    if (!u || u.removed || results[id]) continue;
    results[id] = moraleTest(ctx, u, { reason: 'una compagnia della formazione è stata annientata', lostMelee: true, afterMelee: true, forceFail: true });
    if (s.phase === 'gameOver') return;
  }
  m.wipedFormation = [];
  // Dopo il secondo round: Disordine a entrambi.
  if (roundIdx === 2) for (const u of units([...m.attackers, ...m.defenders])) u.disarray = Math.min(2, u.disarray + 1);

  // Inseguimenti e follow-up.
  const failed = loser ? units(m[loser]).length === 0 || Object.values(results).some((r) => r !== 'pass') : false;
  if (loser && failed) {
    for (const w of winners) {
      if (w.removed) continue;
      const anyBroken = Object.values(results).includes('broken');
      const mustPursue = isCavalry(w) || isKern(w);
      if (mustPursue) {
        if (anyBroken) pursue(ctx, w);
        else followUp(ctx, w, m);
      } else if (leaderOf(s, w) && units(m[loser]).length === 0 && !anyBroken) {
        // Il nemico ha ripiegato: si può decidere di inseguire.
        ctx.ask({
          side: w.side,
          kind: 'followup',
          prompt: `${w.name} ha vinto la mischia e il nemico ripiega. Inseguire (movimento gratuito a contatto, la mischia continua il prossimo turno)?`,
          options: [{ value: 'yes', label: 'Insegui' }, { value: 'no', label: 'Mantieni la posizione' }],
          ctx: { unitId: w.id, meleeId: m.id, enemies: Object.keys(results).filter((id) => results[id] === 'daunted') },
        });
      } else if (leaderOf(s, w) && anyBroken) {
        ctx.ask({
          side: w.side,
          kind: 'pursue',
          prompt: `Il nemico di ${w.name} è in rotta. Inseguire (movimento gratuito)?`,
          options: [{ value: 'yes', label: 'Insegui' }, { value: 'no', label: 'Mantieni la posizione' }],
          ctx: { unitId: w.id },
        });
      }
    }
  }
  // La cavalleria (e i Kern) che non Scuotono o rompono la fanteria al primo round si sganciano.
  if (roundIdx === 1) {
    for (const u of units([...m.attackers, ...m.defenders])) {
      if (!(isCavalry(u) || isKern(u)) || !u.meleeId) continue;
      const opps = units(sideOf(m, u.id) === 'attackers' ? m.defenders : m.attackers);
      const vsInf = opps.some((o) => isInfantryCompany(o) || (isKern(u) && true));
      if (!vsInf || opps.length === 0) continue;
      if (isCavalry(u) && !opps.some((o) => isInfantryCompany(o))) continue;
      bounceOff(ctx, u, opps[0]);
      for (const o of opps) o.wonMeleeThisTurn = true;
    }
  }
  // Dopo tre round senza esito: esausti, gli attaccanti ripiegano.
  const mm = s.melees[m.id];
  if (mm && roundIdx >= 3) {
    const all = units([...mm.attackers, ...mm.defenders]);
    if (all.length) {
      for (const u of all) u.disarray = Math.min(2, u.disarray + 1);
      ctx.log('Dopo tre round entrambi i contendenti sono esausti: i difensori tengono la posizione, gli attaccanti ripiegano.', 'combat');
      const attsNow = units(mm.attackers);
      const defFacing = units(mm.defenders)[0]?.facing;
      for (const u of all) u.meleeId = undefined;
      delete s.melees[mm.id];
      for (const a of attsNow) fallBackFacing(ctx, a, defFacing);
    }
  }
  cleanupMelee(ctx, m.id);
}

function cleanupMelee(ctx: Ctx, id: string) {
  const s = ctx.s;
  const m = s.melees[id];
  if (!m) return;
  m.attackers = m.attackers.filter((x) => s.units[x] && !s.units[x].removed && s.units[x].meleeId === id);
  m.defenders = m.defenders.filter((x) => s.units[x] && !s.units[x].removed && s.units[x].meleeId === id);
  if (!m.attackers.length || !m.defenders.length) {
    for (const x of [...m.attackers, ...m.defenders]) if (s.units[x]) s.units[x].meleeId = undefined;
    delete s.melees[id];
    s.meleeQueue = s.meleeQueue.filter((q) => q !== id);
  }
}

function fallBackFacing(ctx: Ctx, u: Unit, enemyFacing?: number) {
  const s = ctx.s;
  const d = unitMove(u, false) ?? 4;
  const dir = u.side === 'A' ? { x: 0, y: 1 } : { x: 0, y: -1 };
  if (enemyFacing !== undefined) u.facing = normAngle(enemyFacing + 180);
  const dest = add({ x: u.x, y: u.y }, mul(dir, d));
  u.x = dest.x;
  u.y = Math.max(0.5, Math.min(s.table.height - 0.5, dest.y));
  syncAttachedLeaders(s, u);
  ctx.log(`${u.name} ripiega di ${d}" restando rivolta al nemico.`, 'combat', u.side);
}

/** "Batti o rimbalza": la cavalleria si sgancia. */
function bounceOff(ctx: Ctx, u: Unit, opp: Unit) {
  const s = ctx.s;
  detachFromMelee(ctx, u);
  u.facing = normAngle(u.facing + 180);
  u.disarray = Math.min(2, u.disarray + 1);
  const d = unitMove(u, false) ?? 8;
  const dir = { x: Math.sin((u.facing * Math.PI) / 180), y: -Math.cos((u.facing * Math.PI) / 180) };
  const dest = add({ x: u.x, y: u.y }, mul(dir, d));
  u.x = Math.max(1, Math.min(s.table.width - 1, dest.x));
  u.y = Math.max(1, Math.min(s.table.height - 1, dest.y));
  syncAttachedLeaders(s, u);
  ctx.log(`${u.name} non ha spezzato ${opp.name}: si sgancia (dietro-front, un Disordine, ripiega di ${d}").`, 'combat', u.side);
}

/** Vincitori che inseguono un nemico in rotta: 12" e due Disordini (cavalleria e Kern). */
function pursue(ctx: Ctx, w: Unit) {
  const s = ctx.s;
  detachFromMelee(ctx, w);
  const dir = { x: Math.sin((w.facing * Math.PI) / 180), y: -Math.cos((w.facing * Math.PI) / 180) };
  const dest = add({ x: w.x, y: w.y }, mul(dir, 12));
  w.disarray = 2;
  if (dest.x < 0 || dest.y < 0 || dest.x > s.table.width || dest.y > s.table.height) {
    w.offTable = true;
    removeUnit(ctx, w, 'inseguimento fuori dal tavolo');
    ctx.log(`${w.name} insegue il nemico in rotta fuori dal tavolo e non torna.`, 'combat', w.side);
    return;
  }
  w.x = dest.x;
  w.y = dest.y;
  syncAttachedLeaders(s, w);
  ctx.log(`${w.name} insegue il nemico in rotta per 12" e prende due Disordini.`, 'combat', w.side);
}

/** Follow-up: il vincitore resta a contatto con il nemico che ripiega. */
export function followUp(ctx: Ctx, w: Unit, m: Melee, enemyIds?: string[]) {
  const s = ctx.s;
  const enemies = (enemyIds ?? []).map((id) => s.units[id]).filter((u) => u && !u.removed);
  const target = enemies[0] ?? liveUnits(s, otherSide(w.side)).filter((u) => !u.unplaced).sort((a, b) => dist(a, w) - dist(b, w))[0];
  if (!target) return;
  const reach = unitMove(w, false) ?? 6;
  const side = attackSide(w, target);
  const dest = contactPosition(w, target, side);
  if (dist(dest, w) > reach + 0.1) {
    ctx.log(`${w.name} non riesce a raggiungere ${target.name} nell'inseguimento.`, 'combat', w.side);
    detachFromMelee(ctx, w);
    return;
  }
  detachFromMelee(ctx, w);
  w.x = dest.x;
  w.y = dest.y;
  w.facing = dest.facing;
  syncAttachedLeaders(s, w);
  const nm = newMelee(ctx, w, target);
  nm.followUp = [w.id];
  nm.round = 1; // si prosegue con le regole dei round successivi
  nm.firstRoundWinner = w.side;
  if (side !== 'front') nm.flanked[target.id] = side === 'rear' ? 'rear' : 'flank';
  ctx.log(`${w.name} insegue e resta a contatto con ${target.name}: la mischia continua il prossimo turno.`, 'combat', w.side);
}

export function answerFollowUp(ctx: Ctx, c: { unitId: string; meleeId: string; enemies: string[] }, choice: string) {
  const s = ctx.s;
  const w = s.units[c.unitId];
  if (!w || w.removed) return;
  if (choice !== 'yes') {
    detachFromMelee(ctx, w);
    ctx.log(`${w.name} mantiene la posizione.`, 'combat', w.side);
    return;
  }
  followUp(ctx, w, s.melees[c.meleeId], c.enemies);
}

export function answerPursue(ctx: Ctx, c: { unitId: string }, choice: string) {
  const w = ctx.s.units[c.unitId];
  if (!w || w.removed) return;
  if (choice === 'yes') {
    detachFromMelee(ctx, w);
    const d = unitMove(w, false) ?? 6;
    const dir = { x: Math.sin((w.facing * Math.PI) / 180), y: -Math.cos((w.facing * Math.PI) / 180) };
    const dest = add({ x: w.x, y: w.y }, mul(dir, d));
    w.x = Math.max(1, Math.min(ctx.s.table.width - 1, dest.x));
    w.y = Math.max(1, Math.min(ctx.s.table.height - 1, dest.y));
    syncAttachedLeaders(ctx.s, w);
    ctx.log(`${w.name} insegue di ${d}".`, 'combat', w.side);
  } else {
    detachFromMelee(ctx, w);
  }
}

export function answerReaction(ctx: Ctx, r: ReactionCtx, choice: string) {
  reaction(ctx, { ...r, choice });
}

/** Attacco contro un comandante isolato. */
export function attackLeader(ctx: Ctx, u: Unit, l: Leader) {
  const s = ctx.s;
  const reach = (unitMove(u, false) ?? 6) + (isCavalry(u) ? CHARGE_BONUS : 0);
  const d = dist(u, l);
  if (d > reach + unitRect(u).d / 2 + 0.5) fail(`Il comandante è troppo lontano (${d.toFixed(1)}")`);
  const oneAction = u.actionsUsed === 0;
  ctx.log(`${u.name} attacca il comandante isolato ${l.name}!`, 'combat', u.side);
  if (!(isCavalry(u) && oneAction)) {
    const away = bearing({ x: u.x, y: u.y }, { x: l.x, y: l.y });
    const mv = l.mounted ? 12 : 8;
    const dir = { x: Math.sin((away * Math.PI) / 180), y: -Math.cos((away * Math.PI) / 180) };
    l.x = Math.max(0.5, Math.min(s.table.width - 0.5, l.x + dir.x * mv));
    l.y = Math.max(0.5, Math.min(s.table.height - 0.5, l.y + dir.y * mv));
    ctx.log(`${l.name} si sottrae all'attacco con un movimento di ${mv}".`, 'combat', l.side);
    return;
  }
  // Raggiunto: combatte.
  const back = sub({ x: l.x, y: l.y }, mul({ x: Math.sin((u.facing * Math.PI) / 180), y: -Math.cos((u.facing * Math.PI) / 180) }, unitRect(u).d / 2 + 0.5));
  u.x = back.x;
  u.y = back.y;
  syncAttachedLeaders(s, u);
  const parts = u.companies[0];
  const nd = Math.ceil(parts.figures * meleeDicePerFigure(parts));
  const hits = ctx.dice.roll(nd, u.side, `Mischia ${u.name} contro ${l.name}`).filter((x) => x >= 4).length;
  const saves = hits ? ctx.dice.roll(hits, l.side, `Salvezza ${l.name} (3+)`) : [];
  const wounds = saves.filter((x) => x < 3).length;
  const ld = ctx.dice.roll(l.cls >= 3 ? 3 : 2, l.side, `${l.name} combatte`);
  const lh = ld.filter((x) => x >= 4).length;
  if (lh) {
    const sv = meleeSaveTarget(parts, { cover: false });
    const k = applyKills(parts, ctx.dice.roll(lh, u.side, `Salvezza ${u.name} (${sv}+)`).filter((x) => x < sv).length);
    ctx.log(`${l.name} si difende: ${k} perdite a ${u.name}.`, 'combat', l.side);
  }
  ctx.log(`${u.name} infligge ${wounds} ferite a ${l.name}.`, 'combat', u.side);
  woundLeader(ctx, l, wounds, 'catturato isolato');
}

import { CLASS_NAME, TROOPS, armOf, moraleDice } from './data';
import { Ctx } from './ctx';
import { add, closestPointOnPolygon, dist, mul, polygonsOverlap } from './geometry';
import type { Company, Leader, Side, Unit } from './types';
import { otherSide } from './types';
import {
  cinc,
  countsForArmyMorale,
  leaderOf,
  liveUnits,
  syncAttachedLeaders,
  unitFullStrength,
  unitMove,
  unitPointsOriginal,
  unitPoly,
} from './units';
import { lineOfSight } from './vision';

export type MoraleResult = 'pass' | 'daunted' | 'broken';

export interface MoraleOpts {
  reason: string;
  lostMelee?: boolean;
  flankAttack?: boolean;
  /** Indice della compagnia che testa (default: quella con più perdite subite). */
  companyIdx?: number;
  /** 'unit' = il risultato vale per tutta la formazione; 'company' = solo per la compagnia che testa. */
  scope?: 'unit' | 'company';
  /** Il test è dovuto a una mischia persa: dopo il ripiegamento i tiratori perdono le armi da tiro. */
  afterMelee?: boolean;
  /** Direzione del nemico (per restare rivolti verso di lui ripiegando). */
  enemyFacing?: number;
  /** Per i test di formazione dopo la distruzione di una compagnia: forza almeno Scossa. */
  forceFail?: boolean;
}

/** Rimuove gettoni del Morale d'Armata al nemico; se non ne ha più, la battaglia è vinta. */
export function claimArmyMorale(ctx: Ctx, victim: Side, n: number, why: string) {
  const s = ctx.s;
  for (let i = 0; i < n; i++) {
    if (s.phase === 'gameOver') return;
    if (s.armyMorale[victim] <= 0) {
      endGame(ctx, otherSide(victim), `${s.players[victim].name} non ha più gettoni Morale d'Armata`);
      return;
    }
    s.armyMorale[victim]--;
  }
  ctx.log(`${s.players[otherSide(victim)].name} reclama ${n} gettone/i Morale d'Armata (${why}). Restano a ${s.players[victim].name}: ${s.armyMorale[victim]}.`, 'important', otherSide(victim));
}

export function regainArmyMorale(ctx: Ctx, side: Side, why: string) {
  const s = ctx.s;
  if (s.armyMorale[side] < s.armyMoraleStart[side]) {
    s.armyMorale[side]++;
    ctx.log(`${s.players[side].name} recupera un gettone Morale d'Armata (${why}).`, 'morale', side);
  }
}

export function endGame(ctx: Ctx, winner: Side, reason: string) {
  const s = ctx.s;
  if (s.phase === 'gameOver') return;
  s.phase = 'gameOver';
  s.winner = winner;
  s.winReason = reason;
  s.pending = [];
  s.activation = undefined;
  ctx.log(`VITTORIA di ${s.players[winner].name}! ${reason}.`, 'important', winner);
}

/** Infligge ferite a un comandante. Ritorna true se viene ucciso. */
export function woundLeader(ctx: Ctx, l: Leader, wounds: number, why: string): boolean {
  const s = ctx.s;
  if (wounds <= 0 || l.killed) return false;
  // "Un Falso Sfacciato": il C-in-C ferito o ucciso era un sosia.
  if (l.isCinC) {
    const hand = s.hands[l.side];
    const idx = hand.findIndex((c) => c.specialKey === 'counterfeit');
    if (idx >= 0) {
      hand.splice(idx, 1);
      ctx.log(`"Un Falso Sfacciato": colpito un sosia con le insegne di ${l.name}! Il vero comandante è illeso.`, 'card', l.side);
      return false;
    }
  }
  l.cls = Math.max(0, l.cls - wounds);
  if (l.cls <= 0) {
    killLeader(ctx, l, why);
    return true;
  }
  ctx.log(`${l.name} è ferito (${why}) e scende a ${CLASS_NAME[l.cls]}.`, 'important', l.side);
  return false;
}

export function killLeader(ctx: Ctx, l: Leader, why: string) {
  const s = ctx.s;
  if (l.killed) return;
  if (l.isCinC) {
    const hand = s.hands[l.side];
    const idx = hand.findIndex((c) => c.specialKey === 'counterfeit');
    if (idx >= 0) {
      hand.splice(idx, 1);
      ctx.log(`"Un Falso Sfacciato": colpito un sosia con le insegne di ${l.name}! Il vero comandante è illeso.`, 'card', l.side);
      return;
    }
  }
  const unitId = l.attachedTo;
  l.killed = true;
  l.cls = 0;
  l.attachedTo = undefined;
  s.playDeck = s.playDeck.filter((c) => c.leaderId !== l.id);
  ctx.log(`${l.name} è UCCISO (${why}).`, 'important', l.side);
  if (l.isCinC) {
    endGame(ctx, otherSide(l.side), `Il Comandante in Capo ${l.name} è caduto`);
    return;
  }
  const u = unitId ? s.units[unitId] : undefined;
  if (u && !u.removed) moraleTest(ctx, u, { reason: `il suo comandante ${l.name} è caduto` });
}

function testedCompany(u: Unit, opts: MoraleOpts): number {
  if (opts.companyIdx !== undefined) return opts.companyIdx;
  if (u.companies.length === 1) return 0;
  return u.companies[0].kills >= u.companies[1].kills ? 0 : 1;
}

/** Test di Crisi del Morale. */
export function moraleTest(ctx: Ctx, u: Unit, opts: MoraleOpts): MoraleResult {
  const s = ctx.s;
  if (u.removed || s.phase === 'gameOver') return 'pass';
  const ci = testedCompany(u, opts);
  const c = u.companies[ci];
  const kind = moraleDice(c);
  const leader = leaderOf(s, u);
  let pos = 0;
  let neg = 0;
  const why: string[] = [];
  if (c.quality === 'veteran') {
    pos++;
    why.push('veterani +');
  }
  if (leader && (leader.cls >= 3 || leader.isCinC)) {
    pos++;
    why.push(leader.isCinC ? 'C-in-C presente +' : 'Eroe presente +');
  }
  if (u.wonMeleeThisTurn) {
    pos++;
    why.push('ha vinto una mischia +');
  }
  if (s.options.fullStrengthReroll && unitFullStrength(u)) {
    pos++;
    why.push('a piena forza +');
  }
  if (u.disarray > 0 || u.daunted || u.rumourDisarray) {
    neg++;
    why.push('in disordine/scossa −');
  }
  if (c.quality === 'levy') {
    neg++;
    why.push('leva −');
  }
  if (opts.flankAttack) {
    neg++;
    why.push('attaccata sul fianco/retro −');
  }
  const rerollOnes = pos > neg;
  const rerollSixes = neg > pos;
  const nd = kind === '2d6' ? 2 : 1;
  const first = ctx.dice.roll(nd, u.side, `Test Morale ${u.name}`);
  let dice = [...first];
  let auto: MoraleResult | null = null;
  if (kind === '2d6' && armOf(c) === 'infantry') {
    if (dice[0] === 6 && dice[1] === 6) auto = 'pass';
    if (dice[0] === 1 && dice[1] === 1) auto = 'daunted';
  }
  if (!auto) {
    const target = rerollOnes ? 1 : rerollSixes ? 6 : 0;
    if (target) {
      const i = dice.indexOf(target);
      if (i >= 0) {
        const nv = ctx.dice.roll(1, u.side, `Ritiro morale (${target})`)[0];
        dice[i] = nv;
      }
    }
  }
  const total = dice.reduce((a, b) => a + b, 0) + (kind === '1d6+1' ? 1 : 0);
  let res: MoraleResult;
  if (auto === 'pass') res = 'pass';
  else if (auto === 'daunted') res = total <= 4 ? 'broken' : 'daunted';
  else if (total >= 5 && total > c.kills) res = 'pass';
  else if (total >= 5) res = 'daunted';
  else res = 'broken';
  if (opts.forceFail && res === 'pass' && !auto) res = 'daunted';
  if (opts.forceFail && res === 'pass' && auto === 'pass') res = 'pass';
  const label = res === 'pass' ? 'SUPERATO' : res === 'daunted' ? 'SCOSSA' : 'IN ROTTA';
  ctx.log(
    `Test di Crisi del Morale – ${u.name} (${opts.reason}): ${total}${kind === '1d6+1' ? ' (1D6+1)' : ''} contro ${c.kills} perdite${
      auto ? (auto === 'pass' ? ' [doppio 6]' : ' [doppio 1]') : ''
    }${why.length ? ' [' + why.join(', ') + ']' : ''} → ${label}`,
    'morale',
    u.side,
  );
  applyMoraleResult(ctx, u, res, ci, opts);
  return res;
}

export function applyMoraleResult(ctx: Ctx, u: Unit, res: MoraleResult, ci: number, opts: MoraleOpts) {
  const s = ctx.s;
  if (res === 'pass') return;
  let target = u;
  const scope = opts.scope ?? (opts.lostMelee ? 'unit' : 'unit');
  if (scope === 'company' && u.companies.length === 2) {
    // Il fallimento vale solo per la compagnia che testa; la formazione si separa.
    const parts = splitFormation(ctx, u);
    target = parts[ci] ?? parts[0];
  }
  if (res === 'daunted') {
    const wasDaunted = target.daunted;
    if (!wasDaunted) {
      target.daunted = true;
      target.dauntedThisTurn = true;
      const n = target.companies.filter(countsForArmyMorale).length;
      if (n > 0) claimArmyMorale(ctx, target.side, n, `${target.name} è Scossa`);
    }
    if (opts.afterMelee) {
      for (const c of target.companies) {
        if (TROOPS[c.type].shoot && !TROOPS[c.type].shoot!.artillery) {
          c.noShooting = true;
          c.arrows = 0;
        }
      }
    }
    // Se entrambe le compagnie di una formazione sono Scosse, si separano di 2".
    let movers = [target];
    if (target.companies.length === 2 && target.formation !== 'single') movers = splitFormation(ctx, target, 2);
    for (const m of movers) fallBack(ctx, m, opts.enemyFacing);
    return;
  }
  // In rotta
  routUnit(ctx, target, 'in rotta');
}

/** Divide una formazione appaiata in due unità distinte. Ritorna [prima, seconda]. */
export function splitFormation(ctx: Ctx, u: Unit, gap = 0): Unit[] {
  const s = ctx.s;
  if (u.companies.length < 2) return [u];
  const [c0, c1] = u.companies;
  const id2 = ctx.newId(u.id + '-');
  const r = { x: u.x, y: u.y };
  const f = { x: Math.sin((u.facing * Math.PI) / 180), y: -Math.cos((u.facing * Math.PI) / 180) };
  const rt = { x: Math.cos((u.facing * Math.PI) / 180), y: Math.sin((u.facing * Math.PI) / 180) };
  const formation = u.formation;
  u.companies = [c0];
  u.formation = 'single';
  const u2: Unit = JSON.parse(JSON.stringify(u));
  u2.id = id2;
  u2.companies = [c1];
  u2.name = u.name + ' (2)';
  if (formation === 'line') {
    const w0 = 4.8;
    const off = w0 / 2 + gap / 2;
    const p0 = add(r, mul(rt, -off));
    const p1 = add(r, mul(rt, off));
    u.x = p0.x;
    u.y = p0.y;
    u2.x = p1.x;
    u2.y = p1.y;
  } else {
    const d0 = 1.6;
    const off = d0 / 2 + gap / 2;
    const p0 = add(r, mul(f, off));
    const p1 = add(r, mul(f, -off));
    u.x = p0.x;
    u.y = p0.y;
    u2.x = p1.x;
    u2.y = p1.y;
  }
  if (formation === 'hedgehog') u2.facing = (u.facing + 180) % 360;
  s.units[id2] = u2;
  // Una mischia in corso coinvolge entrambe.
  if (u.meleeId && s.melees[u.meleeId]) {
    const m = s.melees[u.meleeId];
    if (m.attackers.includes(u.id)) m.attackers.push(id2);
    else m.defenders.push(id2);
  }
  syncAttachedLeaders(s, u);
  ctx.log(`La formazione ${u.name} si divide in due unità.`, 'info', u.side);
  return [u, u2];
}

function baselineDir(side: Side) {
  return side === 'A' ? { x: 0, y: 1 } : { x: 0, y: -1 };
}

/** Ripiega di un movimento verso la propria linea di base, restando rivolta al nemico. */
export function fallBack(ctx: Ctx, u: Unit, enemyFacing?: number) {
  const s = ctx.s;
  if (u.removed) return;
  const dist0 = unitMove(u, false) ?? 4;
  const dir = baselineDir(u.side);
  const start = { x: u.x, y: u.y };
  let dest = add(start, mul(dir, dist0));
  if (enemyFacing !== undefined) u.facing = (enemyFacing + 180) % 360;
  // Esce dal tavolo?
  if (dest.y < 0 || dest.y > s.table.height) {
    u.x = dest.x;
    u.y = Math.max(-2, Math.min(s.table.height + 2, dest.y));
    removeUnit(ctx, u, 'ripiegata fuori dal tavolo');
    if (u.companies.some(countsForArmyMorale)) claimArmyMorale(ctx, u.side, 1, `${u.name} esce dal tavolo`);
    return;
  }
  // Attraversa amici di valore pari o inferiore: li disordina.
  const myPts = unitPointsOriginal(u);
  const path = (p: { x: number; y: number }) => unitPoly(u, { x: p.x, y: p.y, facing: u.facing });
  for (const o of liveUnits(s)) {
    if (o.id === u.id || o.unplaced) continue;
    const poly = unitPoly(o);
    let crossed = false;
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const p = add(start, mul(dir, dist0 * t));
      if (polygonsOverlap(path(p), poly)) {
        crossed = true;
        break;
      }
    }
    if (!crossed) continue;
    if (o.side === u.side) {
      if (unitPointsOriginal(o) <= myPts && o.disarray < 2 && !o.meleeId) {
        o.disarray++;
        ctx.log(`${o.name} viene attraversata da ${u.name} in ripiegamento e prende un Disordine.`, 'info', o.side);
      }
    } else if (!o.meleeId) {
      // Contatto con un nemico: nuova mischia al prossimo turno.
      let tt = 0;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const p = add(start, mul(dir, dist0 * t));
        if (polygonsOverlap(path(p), poly)) break;
        tt = t;
      }
      dest = add(start, mul(dir, dist0 * tt));
      u.x = dest.x;
      u.y = dest.y;
      syncAttachedLeaders(s, u);
      const id = ctx.newId('m');
      s.melees[id] = {
        id,
        attackers: [o.id],
        defenders: [u.id],
        round: 0,
        flanked: { [u.id]: 'rear' },
        charged: [],
        uphill: [],
        acrossObstacle: [],
        intoBuilding: [],
        followUp: [],
        startedTurn: s.turn,
        targets: { [o.id]: u.id, [u.id]: o.id },
        turned: [],
        wipedFormation: [],
      };
      u.meleeId = id;
      o.meleeId = id;
      ctx.log(`${u.name} ripiega a contatto con ${o.name}: la mischia si combatterà al prossimo turno.`, 'combat');
      return;
    }
  }
  // Evita di finire sovrapposta a un amico: continua a ripiegare.
  let extra = 0;
  while (extra < 8 && liveUnits(s).some((o) => o.id !== u.id && !o.unplaced && polygonsOverlap(path(dest), unitPoly(o)))) {
    dest = add(dest, mul(dir, 0.5));
    extra += 0.5;
  }
  u.x = dest.x;
  u.y = Math.max(0.5, Math.min(s.table.height - 0.5, dest.y));
  syncAttachedLeaders(s, u);
  ctx.log(`${u.name} ripiega di ${dist0}" verso la propria linea di base.`, 'morale', u.side);
}

/** Rimuove un'unità dal gioco. */
export function removeUnit(ctx: Ctx, u: Unit, reason: string) {
  const s = ctx.s;
  u.removed = true;
  u.removedReason = reason;
  if (u.meleeId) detachFromMelee(ctx, u);
}

export function detachFromMelee(ctx: Ctx, u: Unit) {
  const s = ctx.s;
  const m = u.meleeId ? s.melees[u.meleeId] : undefined;
  u.meleeId = undefined;
  if (!m) return;
  m.attackers = m.attackers.filter((id) => id !== u.id);
  m.defenders = m.defenders.filter((id) => id !== u.id);
  if (m.attackers.length === 0 || m.defenders.length === 0) {
    for (const id of [...m.attackers, ...m.defenders]) if (s.units[id]) s.units[id].meleeId = undefined;
    delete s.melees[m.id];
  }
}

/** Rotta: l'unità fugge di 12" e lascia il campo. */
export function routUnit(ctx: Ctx, u: Unit, why: string) {
  const s = ctx.s;
  if (u.removed) return;
  const wasDaunted = u.daunted;
  const leader = leaderOf(s, u);
  const dir = baselineDir(u.side);
  const routPos = add({ x: u.x, y: u.y }, mul(dir, 12));
  ctx.log(`${u.name} è ${why}: fugge di 12" e abbandona il campo.`, 'important', u.side);
  removeUnit(ctx, u, why);
  if (leader) {
    if (leader.maxClass >= 3 && leader.cls >= 3) {
      leader.attachedTo = undefined;
      leader.x = Math.max(1, Math.min(s.table.width - 1, routPos.x));
      leader.y = Math.max(1, Math.min(s.table.height - 1, routPos.y));
      ctx.log(`${leader.name} (Eroe) si salva con un movimento gratuito.`, 'info', u.side);
    } else {
      killLeader(ctx, leader, `travolto nella rotta di ${u.name}`);
      if (s.phase === 'gameOver') return;
    }
  }
  const n = u.companies.filter(countsForArmyMorale).length;
  if (n > 0) claimArmyMorale(ctx, u.side, wasDaunted ? n : 2 * n, `${u.name} ${wasDaunted ? 'già Scossa ' : ''}distrutta o in rotta`);
  if (s.phase === 'gameOver') return;
  friendsSeeDisaster(ctx, u);
}

/** Unità distrutta (tutte le figure perse). */
export function unitWipedOut(ctx: Ctx, u: Unit, how: string) {
  const s = ctx.s;
  if (u.removed) return;
  const wasDaunted = u.daunted;
  ctx.log(`${u.name} è stata annientata (${how}).`, 'important', u.side);
  removeUnit(ctx, u, 'annientata');
  const n = u.companies.filter(countsForArmyMorale).length;
  if (n > 0) claimArmyMorale(ctx, u.side, wasDaunted ? n : 2 * n, `${u.name} annientata`);
  if (s.phase === 'gameOver') return;
  friendsSeeDisaster(ctx, u);
}

/** Le unità amiche che vedono entro 12" un'unità di valore pari o superiore annientata o in rotta devono testare. */
export function friendsSeeDisaster(ctx: Ctx, gone: Unit) {
  const s = ctx.s;
  const pts = unitPointsOriginal(gone);
  const poly = unitPoly(gone);
  for (const f of liveUnits(s, gone.side)) {
    if (f.unplaced || f.removed || f.id === gone.id) continue;
    if (s.sawRoutTested.includes(f.id)) continue;
    if (unitPointsOriginal(f) > pts) continue;
    const from = { x: f.x, y: f.y };
    const d = dist(from, closestPointOnPolygon(from, poly));
    if (d > 12) continue;
    const los = lineOfSight(s, from, { ...gone, removed: false } as Unit, [f.id]);
    if (!los.ok) continue;
    s.sawRoutTested.push(f.id);
    moraleTest(ctx, f, { reason: `ha visto ${gone.name} annientata o in rotta` });
    if (s.phase === 'gameOver') return;
  }
}

/** Ferite ai comandanti aggregati a un'unità che subisce perdite. */
export function leaderRiskFromKills(ctx: Ctx, u: Unit, kills: number, threshold: number) {
  const l = leaderOf(ctx.s, u);
  if (!l || kills <= threshold) return;
  const n = kills - threshold;
  const dice = ctx.dice.roll(n, u.side, `Rischio per ${l.name}`);
  const w = dice.filter((d) => d === 1).length;
  if (w > 0) woundLeader(ctx, l, w, `colpito mentre era con ${u.name}`);
  else ctx.log(`${l.name} esce illeso dalle perdite di ${u.name}.`, 'info', u.side);
}

export function companyLabel(c: Company): string {
  return TROOPS[c.type].name;
}

export function isCinCAttached(ctx: Ctx, u: Unit) {
  const l = leaderOf(ctx.s, u);
  return !!l && l.id === cinc(ctx.s, u.side)?.id;
}

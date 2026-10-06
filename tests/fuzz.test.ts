import { describe, expect, it } from 'vitest';
import { checkAttack } from '../src/engine/melee';
import { planMove } from '../src/engine/movement';
import type { Intent } from '../src/engine/reducer';
import { Session } from '../src/engine/session';
import { validTargets } from '../src/engine/shooting';
import { closestPointOnPolygon, dist } from '../src/engine/geometry';
import type { GameState, Side, Unit } from '../src/engine/types';
import { otherSide } from '../src/engine/types';
import { liveUnits, unitPoly } from '../src/engine/units';
import { deployedGame } from './helpers';

/** Semplice giocatore automatico per esplorare il motore e trovare errori. */
function rngFrom(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

function nearestEnemy(s: GameState, u: Unit): Unit | undefined {
  return liveUnits(s, otherSide(u.side))
    .filter((e) => !e.unplaced)
    .sort((a, b) => dist(u, closestPointOnPolygon(u, unitPoly(a))) - dist(u, closestPointOnPolygon(u, unitPoly(b))))[0];
}

function tryUnitAction(sess: Session, u: Unit, rnd: () => number): boolean {
  const s = sess.state;
  const side = u.side;
  const e = nearestEnemy(s, u);
  if (!e) return false;
  const attempt = (it: Intent) => !sess.dispatch(it);
  if (rnd() < 0.7) {
    const charge = rnd() < 0.5;
    if (checkAttack(s, u, e, { charge, manoeuvre: s.phase === 'manoeuvre' }).ok && attempt({ t: 'attack', side, unitId: u.id, targetId: e.id, charge })) return true;
  }
  const vt = validTargets(s, u).find((v) => v.allowed);
  if (vt && rnd() < 0.8 && attempt({ t: 'shoot', side, unitId: u.id, targetId: vt.target.id })) return true;
  if (u.daunted && attempt({ t: 'rally', side, unitId: u.id, what: 'daunted' })) return true;
  if (u.disarray && rnd() < 0.5 && attempt({ t: 'rally', side, unitId: u.id, what: 'disarray' })) return true;
  // Muovi verso il nemico (o lontano se Scossa).
  const dx = e.x - u.x;
  const dy = e.y - u.y;
  const L = Math.hypot(dx, dy) || 1;
  for (const k of [6, 4, 2, 1]) {
    const sign = u.daunted ? -1 : 1;
    const to = { x: u.x + (sign * dx * k) / L, y: u.y + (sign * dy * k) / L };
    if (planMove(s, u, to).ok && attempt({ t: 'move', side, unitId: u.id, x: to.x, y: to.y })) return true;
  }
  if (rnd() < 0.3 && attempt({ t: 'wheel', side, unitId: u.id, angle: rnd() < 0.5 ? 30 : -30 })) return true;
  return false;
}

function step(sess: Session, rnd: () => number): boolean {
  const s = sess.state;
  if (s.phase === 'gameOver') return false;
  if (s.pending.length) {
    const p = s.pending[0];
    const o = p.options[Math.floor(rnd() * p.options.length)];
    const err = sess.dispatch({ t: 'answer', side: p.side, pendingId: p.id, choice: o.value });
    if (err) throw new Error('answer: ' + err);
    return true;
  }
  if (s.phase === 'manoeuvre') {
    const side = s.activeSide;
    const units = liveUnits(s, side).filter((u) => !u.unplaced);
    const u = units[Math.floor(rnd() * units.length)];
    if (u && rnd() < 0.85 && tryUnitAction(sess, u, rnd)) return true;
    sess.dispatch({ t: 'manoeuvrePass', side });
    return true;
  }
  if (s.phase === 'endTurn') {
    for (const side of ['A', 'B'] as Side[]) {
      if (!s.endTurn!.freeDone[side]) {
        if (rnd() < 0.5) sess.dispatch({ t: 'freeAutoRally', side });
        sess.dispatch({ t: 'endTurnDone', side });
        return true;
      }
    }
    throw new Error('endTurn bloccato');
  }
  if (s.phase === 'battle') {
    // Gioca qualche carta in mano.
    for (const side of ['A', 'B'] as Side[]) {
      const h = s.hands[side][0];
      if (h && rnd() < 0.3 && h.kind === 'bonus' && h.bonusKind === 'perk' && (!s.activation || s.activation.side === side)) {
        const u = liveUnits(s, side).find((x) => !x.meleeId && !x.unplaced);
        if (u && !sess.dispatch({ t: 'playCard', side, handId: h.id, unitId: u.id })) return true;
      }
      if (h && rnd() < 0.3 && h.kind === 'bonus' && h.bonusKind === 'reroll') {
        const roll = s.log.filter((l) => l.intentId === s.lastIntentId).flatMap((l) => l.rolls ?? []).find((r) => r.side === side);
        if (roll && !sess.reroll(side, roll.group)) return true;
      }
    }
    const a = s.activation;
    if (!a) {
      const err = sess.dispatch({ t: 'drawCard', side: 'A' });
      if (err) throw new Error('drawCard: ' + err);
      return true;
    }
    const side = a.side;
    if (a.kind === 'leader') {
      const l = s.leaders[a.leaderId!];
      if (a.tokensLeft > 0) {
        const cands = liveUnits(s, side).filter((u) => !u.ordered && !u.initiative && !u.meleeId && !u.unplaced && (u.wardId === l.wardId || l.isCinC));
        for (const u of cands) if (!sess.dispatch({ t: 'order', side, leaderId: l.id, unitId: u.id })) return true;
        // Muovi il comandante verso un'unità della propria Schiera.
        const mine = liveUnits(s, side).find((u) => u.wardId === l.wardId && !u.ordered && !u.meleeId && u.id !== l.attachedTo);
        if (mine && rnd() < 0.6 && !sess.dispatch({ t: 'leaderMove', side, leaderId: l.id, x: mine.x, y: mine.y, attachTo: mine.id })) return true;
      }
    }
    for (const id of a.units) {
      const u = s.units[id];
      if (u && !u.removed && u.actionsLeft > 0 && !u.meleeId && tryUnitAction(sess, u, rnd)) return true;
    }
    const err = sess.dispatch({ t: 'endActivation', side });
    if (err && s.activation) throw new Error('endActivation: ' + err);
    return true;
  }
  return false;
}

function checkInvariants(s: GameState) {
  for (const u of Object.values(s.units)) {
    expect(u.disarray).toBeGreaterThanOrEqual(0);
    expect(u.disarray).toBeLessThanOrEqual(2);
    for (const c of u.companies) {
      expect(c.figures).toBeGreaterThanOrEqual(0);
      expect(c.figures).toBeLessThanOrEqual(c.maxFigures);
    }
    if (!u.removed) expect(u.companies.length).toBeGreaterThan(0);
    if (u.meleeId && !u.removed) expect(s.melees[u.meleeId], `mischia mancante per ${u.id}`).toBeTruthy();
  }
  for (const m of Object.values(s.melees)) {
    expect(m.attackers.length + m.defenders.length).toBeGreaterThan(0);
  }
  expect(s.armyMorale.A).toBeGreaterThanOrEqual(0);
  expect(s.armyMorale.B).toBeGreaterThanOrEqual(0);
}

/** Intercetta gli errori interni (non le normali violazioni di regole). */
function guard(sess: Session) {
  const d = sess.dispatch.bind(sess);
  sess.dispatch = (it: Intent) => {
    const err = d(it);
    if (err?.startsWith('Errore interno')) throw new Error(`${it.t}: ${err}`);
    return err;
  };
  const r = sess.reroll.bind(sess);
  sess.reroll = (side: Side, g: number) => {
    const err = r(side, g);
    if (err?.startsWith('Errore interno')) throw new Error(`reroll: ${err}`);
    return err;
  };
}

describe('partite automatiche', () => {
  it('giocano fino alla fine senza errori interni', { timeout: 300_000 }, () => {
    let finished = 0;
    let turns = 0;
    for (let g = 0; g < 40; g++) {
      const rnd = rngFrom(1000 + g);
      const sess = deployedGame();
      guard(sess);
      // Avvicina gli eserciti per avere scontri.
      for (const u of Object.values(sess.state.units)) u.y += u.side === 'A' ? -12 : 12;
      for (const l of Object.values(sess.state.leaders)) l.y += l.side === 'A' ? -12 : 12;
      let n = 0;
      while (n++ < 1500 && step(sess, rnd)) {
        checkInvariants(sess.state);
      }
      turns += sess.state.turn;
      if (sess.state.phase === 'gameOver') finished++;
    }
    expect(finished).toBeGreaterThan(20);
    console.log(`partite concluse: ${finished}/40, turni totali ${turns}`);
  });
});

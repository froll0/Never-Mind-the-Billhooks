import { describe, expect, it } from 'vitest';
import { applyIntent } from '../src/engine/reducer';
import { Session } from '../src/engine/session';
import { newGame, sampleArmy, type ArmyDef } from '../src/engine/setup';
import { Ctx } from '../src/engine/ctx';
import { Dice } from '../src/engine/rng';
import { moraleTest } from '../src/engine/morale';
import { planMove, planWheel } from '../src/engine/movement';
import { basicShotCheck, validTargets } from '../src/engine/shooting';
import { checkAttack } from '../src/engine/melee';
import { deployedGame, must } from './helpers';

const small = (side: 'A' | 'B', units: ArmyDef['units']): ArmyDef => ({
  faction: side,
  leaders: [
    { id: 'L1', name: `C-in-C ${side}`, rank: 'Lord', cls: 2, mounted: false, isCinC: true },
    { id: 'L2', name: `Capitano ${side}`, rank: 'Capitano', cls: 2, mounted: false, isCinC: false },
  ],
  wards: [
    { id: 'W1', name: 'Principale', leaderId: 'L1' },
    { id: 'W2', name: 'Avanguardia', leaderId: 'L2' },
  ],
  units,
});

describe('preparazione', () => {
  it('arriva alla Fase di Manovra con i gettoni Morale corretti', () => {
    const s = deployedGame();
    expect(s.state.phase).toBe('manoeuvre');
    // Esercito di esempio: 9 compagnie/squadroni (la linea conta 2), esclusi gli schermagliatori.
    expect(s.state.armyMorale.A).toBe(8);
    expect(s.state.armyMorale.B).toBe(8);
  });

  it('rifiuta lo schieramento fuori zona', () => {
    const s = new Session(newGame('t', { A: 'a', B: 'b' }));
    must(s, { t: 'setArmy', side: 'A', army: sampleArmy('A') });
    must(s, { t: 'setArmy', side: 'B', army: sampleArmy('B') });
    must(s, { t: 'armyReady', side: 'A', ready: true });
    must(s, { t: 'armyReady', side: 'B', ready: true });
    must(s, { t: 'terrainDone', side: s.state.terrainSide });
    const p = s.state.pending[0];
    must(s, { t: 'answer', side: p.side, pendingId: p.id, choice: 'keep' });
    expect(s.dispatch({ t: 'place', side: 'A', unitId: 'A-U1', x: 30, y: 20, facing: 0 })).toMatch(/zona/);
    expect(s.dispatch({ t: 'place', side: 'A', unitId: 'A-U1', x: 3, y: 45, facing: 0 })).toMatch(/lati/);
    expect(s.dispatch({ t: 'place', side: 'A', unitId: 'A-U1', x: 30, y: 45, facing: 0 })).toBeUndefined();
  });
});

describe('movimento', () => {
  it('limita la distanza e applica il Disordine fuori arco', () => {
    const s = deployedGame();
    const u = s.state.units['A-U2'];
    const far = planMove(s.state, u, { x: u.x, y: u.y - 7 });
    expect(far.ok).toBe(false);
    const ok = planMove(s.state, u, { x: u.x, y: u.y - 6 });
    expect(ok.ok).toBe(true);
    expect(ok.disarray).toBe(0);
    const side = planMove(s.state, u, { x: u.x + 1, y: u.y - 0.2 });
    expect(side.ok).toBe(true);
    expect(side.disarray).toBe(1);
  });

  it('la conversione oltre 45° causa Disordine', () => {
    const s = deployedGame();
    const u = s.state.units['A-U2'];
    expect(planWheel(s.state, u, 30).disarray).toBe(0);
    expect(planWheel(s.state, u, 60).disarray).toBe(1);
  });

  it('il terreno difficile riduce il movimento a 4"', () => {
    const s = deployedGame();
    s.state.terrain.areas.push({ id: 'w', kind: 'wood', points: [{ x: 0, y: 30 }, { x: 72, y: 30 }, { x: 72, y: 41 }, { x: 0, y: 41 }] });
    const u = s.state.units['A-U2'];
    const p = planMove(s.state, u, { x: u.x, y: u.y - 5 });
    expect(p.ok).toBe(false);
    const q = planMove(s.state, u, { x: u.x, y: u.y - 4 });
    expect(q.ok).toBe(true);
    expect(q.disarray).toBe(1);
  });

  it('nella Fase di Manovra si alternano i giocatori', () => {
    const s = deployedGame();
    const first = s.state.activeSide;
    const uid = first === 'A' ? 'A-U2' : 'B-U2';
    const u = s.state.units[uid];
    must(s, { t: 'move', side: first, unitId: uid, x: u.x, y: u.y + (first === 'A' ? -6 : 6) });
    expect(s.state.activeSide).not.toBe(first);
    expect(s.dispatch({ t: 'move', side: first, unitId: uid, x: u.x, y: u.y })).toMatch(/avversario/);
  });
});

describe('tiro', () => {
  it('calcola dadi, gittata e obbliga al bersaglio più vicino', () => {
    const A = small('A', [{ id: 'ARC', name: 'Arcieri', wardId: 'W2', formation: 'single', companies: [{ type: 'archers', quality: 'retinue' }] }]);
    const B = small('B', [
      { id: 'B1', name: 'Bill vicini', wardId: 'W1', formation: 'single', companies: [{ type: 'billmen', quality: 'retinue' }] },
      { id: 'B2', name: 'Bill lontani', wardId: 'W2', formation: 'single', companies: [{ type: 'billmen', quality: 'retinue' }] },
    ]);
    const s = deployedGame({ A, B }, (st, side) =>
      side === 'A' ? { 'A-ARC': { x: 36, y: 45 } } : { 'B-B1': { x: 30, y: 6 }, 'B-B2': { x: 50, y: 6 } },
    );
    // Avvicina i bersagli con modifiche manuali.
    must(s, { t: 'manualUnit', side: 'B', unitId: 'B-B1', patch: { x: 33, y: 32 } });
    must(s, { t: 'manualUnit', side: 'B', unitId: 'B-B2', patch: { x: 44, y: 30 } });
    const lid = Object.values(s.state.leaders).find((l) => l.attachedTo === 'A-ARC')!.id;
    must(s, { t: 'manualLeader', side: 'A', leaderId: lid, patch: { attachedTo: null, x: 20, y: 46 } });
    const arc = s.state.units['A-ARC'];
    const c1 = basicShotCheck(s.state, arc, s.state.units['B-B1']);
    expect(c1.ok).toBe(true);
    expect(c1.dice).toBe(12);
    expect(c1.long).toBe(true);
    const vt = validTargets(s.state, arc);
    const far = vt.find((v) => v.target.id === 'B-B2')!;
    expect(far.allowed).toBe(false);
    // Il primo tiro in Manovra avvia la battaglia e consuma una freccia.
    if (s.state.activeSide !== 'A') must(s, { t: 'manoeuvrePass', side: 'B' });
    must(s, { t: 'shoot', side: 'A', unitId: 'A-ARC', targetId: 'B-B1' });
    expect(s.state.phase).toBe('battle');
    expect(s.state.units['A-ARC'].companies[0].arrows).toBe(5);
    const b1 = s.state.units['B-B1'];
    expect(b1.companies[0].figures + b1.companies[0].kills).toBe(12);
  });
});

describe('morale', () => {
  it('passa, si scuote o va in rotta secondo il punteggio e le perdite', () => {
    const s = deployedGame();
    let pass = 0;
    let daunted = 0;
    let broken = 0;
    for (let seed = 1; seed < 300; seed++) {
      const st = structuredClone(s.state);
      const u = st.units['B-U2'];
      u.companies[0].kills = 6;
      u.companies[0].figures = 6;
      const ctx = new Ctx(st, new Dice(seed), 'B', 1);
      const r = moraleTest(ctx, u, { reason: 'test' });
      if (r === 'pass') pass++;
      else if (r === 'daunted') daunted++;
      else broken++;
    }
    // 2D6 >= 7 passa (~58%), 5-6 scossa (~19%), <=4 rotta (~17%) circa.
    expect(pass).toBeGreaterThan(130);
    expect(daunted).toBeGreaterThan(30);
    expect(broken).toBeGreaterThan(20);
  });

  it('una rotta toglie due gettoni del Morale d\'Armata', () => {
    const s = deployedGame();
    const before = s.state.armyMorale.B;
    for (let seed = 1; seed < 200; seed++) {
      const st = structuredClone(s.state);
      const ctx = new Ctx(st, new Dice(seed), 'B', 1);
      const u = st.units['B-U4'];
      u.companies[0].kills = 11;
      const r = moraleTest(ctx, u, { reason: 'test' });
      if (r === 'broken') {
        expect(st.armyMorale.B).toBeLessThanOrEqual(before - 2);
        expect(u.removed).toBe(true);
        return;
      }
    }
    throw new Error('nessuna rotta ottenuta');
  });
});

describe('mischia e carte', () => {
  it('un attacco di fronte risolve il primo round con perdite e test', () => {
    const A = small('A', [{ id: 'MAA', name: "Uomini d'Arme", wardId: 'W2', formation: 'single', companies: [{ type: 'menAtArms', quality: 'retinue' }] }]);
    const B = small('B', [{ id: 'BIL', name: 'Bill', wardId: 'W1', formation: 'single', companies: [{ type: 'billmen', quality: 'retinue' }] }]);
    const s = deployedGame({ A, B }, (st, side) => (side === 'A' ? { 'A-MAA': { x: 36, y: 45 } } : { 'B-BIL': { x: 36, y: 5 } }));
    must(s, { t: 'manualUnit', side: 'A', unitId: 'A-MAA', patch: { x: 36, y: 30 } });
    must(s, { t: 'manualUnit', side: 'B', unitId: 'B-BIL', patch: { x: 36, y: 26 } });
    const chk = checkAttack(s.state, s.state.units['A-MAA'], s.state.units['B-BIL'], { manoeuvre: true });
    expect(chk.ok).toBe(true);
    if (s.state.activeSide !== 'A') must(s, { t: 'manoeuvrePass', side: 'B' });
    must(s, { t: 'attack', side: 'A', unitId: 'A-MAA', targetId: 'B-BIL' });
    expect(['battle', 'gameOver']).toContain(s.state.phase);
    const log = s.state.log.map((l) => l.text).join('\n');
    expect(log).toMatch(/round 1/);
    const maa = s.state.units['A-MAA'];
    const bil = s.state.units['B-BIL'];
    expect(maa.companies[0].kills + bil.companies[0].kills).toBeGreaterThan(0);
  });

  it('gira le carte fino a fine turno e passa al turno successivo', () => {
    const s = deployedGame();
    if (s.state.activeSide === 'B') must(s, { t: 'manoeuvrePass', side: 'B' });
    must(s, { t: 'manoeuvrePass', side: 'A' });
    if (s.state.phase !== 'battle') must(s, { t: 'manoeuvrePass', side: 'B' });
    expect(s.state.phase).toBe('battle');
    const deck = s.state.playDeck.length;
    expect(deck).toBe(6 + 4);
    let guard = 0;
    while (s.state.turn === 1 && guard++ < 50) {
      if (s.state.pending.length) {
        const p = s.state.pending[0];
        must(s, { t: 'answer', side: p.side, pendingId: p.id, choice: p.options[0].value });
        continue;
      }
      if (s.state.activation) {
        must(s, { t: 'endActivation', side: s.state.activation.side });
        continue;
      }
      if (s.state.phase === 'endTurn') {
        must(s, { t: 'endTurnDone', side: 'A' });
        must(s, { t: 'endTurnDone', side: 'B' });
        continue;
      }
      must(s, { t: 'drawCard', side: 'A' });
    }
    expect(s.state.turn).toBe(2);
    expect(s.state.playDeck.length).toBe(10);
  });

  it('un comandante ordina solo entro 6"', () => {
    const s = deployedGame();
    const st = structuredClone(s.state);
    st.phase = 'battle';
    st.turn = 1;
    const l = Object.values(st.leaders).find((x) => x.side === 'A' && x.isCinC)!;
    st.activation = { kind: 'leader', side: 'A', leaderId: l.id, tokensLeft: 2, units: [] };
    l.attachedTo = undefined;
    l.x = 2;
    l.y = 2;
    const r = applyIntent(st, { t: 'order', side: 'A', leaderId: l.id, unitId: 'A-U1' });
    expect(r.error).toMatch(/raggio di comando/);
  });

  it('la carta Ritira ripete un lancio dell\'ultima azione', () => {
    const A = small('A', [{ id: 'ARC', name: 'Arcieri', wardId: 'W2', formation: 'single', companies: [{ type: 'archers', quality: 'retinue' }] }]);
    const B = small('B', [{ id: 'B1', name: 'Bill', wardId: 'W1', formation: 'single', companies: [{ type: 'billmen', quality: 'retinue' }] }]);
    const s = deployedGame({ A, B }, (st, side) => (side === 'A' ? { 'A-ARC': { x: 36, y: 45 } } : { 'B-B1': { x: 36, y: 5 } }));
    must(s, { t: 'manualUnit', side: 'B', unitId: 'B-B1', patch: { x: 36, y: 36 } });
    if (s.state.activeSide !== 'A') must(s, { t: 'manoeuvrePass', side: 'B' });
    s.state.hands.A.push({ id: 'hx', kind: 'bonus', bonusKind: 'reroll', expiresEndOfTurn: true });
    must(s, { t: 'shoot', side: 'A', unitId: 'A-ARC', targetId: 'B-B1' });
    const roll = s.state.log.flatMap((l) => l.rolls ?? []).find((r) => r.label.startsWith('Tiro di'))!;
    const err = s.reroll('A', roll.group);
    expect(err).toBeUndefined();
    expect(s.state.hands.A.length).toBe(0);
    expect(s.state.log.some((l) => l.text.includes('Ritira'))).toBe(true);
  });
});

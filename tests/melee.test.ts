import { describe, expect, it } from 'vitest';
import type { ArmyDef } from '../src/engine/setup';
import type { GameState } from '../src/engine/types';
import { deployedGame, must } from './helpers';

const army = (side: 'A' | 'B', units: ArmyDef['units']): ArmyDef => ({
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

/** Porta la partita in battaglia con un'attivazione del comandante L2 di A e posiziona le unità. */
function setup(aUnits: ArmyDef['units'], bUnits: ArmyDef['units'], pos: Record<string, { x: number; y: number; facing: number }>) {
  const s = deployedGame({ A: army('A', aUnits), B: army('B', bUnits) });
  const st: GameState = s.state;
  st.phase = 'battle';
  st.turn = 1;
  for (const [id, p] of Object.entries(pos)) Object.assign(st.units[id], p);
  for (const l of Object.values(st.leaders)) {
    l.attachedTo = undefined;
    l.x = l.side === 'A' ? 2 : 70;
    l.y = l.side === 'A' ? 46 : 2;
  }
  return s;
}

function activate(s: ReturnType<typeof setup>, unitId: string) {
  const u = s.state.units[unitId];
  u.ordered = true;
  u.actionsLeft = 2;
  u.actionsUsed = 0;
  s.state.activation = { kind: 'leader', side: u.side, leaderId: `${u.side}-L2`, tokensLeft: 0, units: [unitId] };
}

describe('reazioni in mischia', () => {
  const bill = (id: string, wardId = 'W2'): ArmyDef['units'][0] => ({ id, name: id, wardId, formation: 'single', companies: [{ type: 'billmen', quality: 'retinue' }] });

  it("attacco sul fianco con una sola azione: il difensore non si gira", () => {
    // B guarda verso sud (180); A arriva dal suo fianco (est).
    const s = setup([bill('X')], [bill('Y')], { 'A-X': { x: 44, y: 24, facing: 270 }, 'B-Y': { x: 36, y: 24, facing: 180 } });
    activate(s, 'A-X');
    must(s, { t: 'attack', side: 'A', unitId: 'A-X', targetId: 'B-Y' });
    const log = s.state.log.map((l) => l.text).join('\n');
    expect(log).toMatch(/non fa in tempo a girarsi/);
    expect(log).toMatch(/round 1/);
  });

  it("attacco sul fianco dopo un movimento: il difensore si gira", () => {
    const s = setup([bill('X')], [bill('Y')], { 'A-X': { x: 48, y: 24, facing: 270 }, 'B-Y': { x: 36, y: 24, facing: 180 } });
    activate(s, 'A-X');
    must(s, { t: 'move', side: 'A', unitId: 'A-X', x: 44, y: 24 });
    must(s, { t: 'attack', side: 'A', unitId: 'A-X', targetId: 'B-Y' });
    const log = s.state.log.map((l) => l.text).join('\n');
    expect(log).toMatch(/si gira per fronteggiare/);
  });

  it('gli schermagliatori si sganciano dalla fanteria', () => {
    const sk: ArmyDef['units'][0] = { id: 'S', name: 'Schermagliatori', wardId: 'W2', formation: 'single', companies: [{ type: 'skirmArchers', quality: 'retinue' }] };
    const s = setup([bill('X')], [sk], { 'A-X': { x: 36, y: 30, facing: 0 }, 'B-S': { x: 36, y: 25, facing: 180 } });
    activate(s, 'A-X');
    must(s, { t: 'attack', side: 'A', unitId: 'A-X', targetId: 'B-S' });
    const sk2 = s.state.units['B-S'];
    expect(sk2.meleeId).toBeUndefined();
    expect(sk2.disarray).toBe(1);
    expect(s.state.log.some((l) => l.text.includes('si sgancia'))).toBe(true);
  });

  it('la cavalleria che non spezza la fanteria al primo round rimbalza', () => {
    const kn: ArmyDef['units'][0] = { id: 'K', name: 'Cavalieri', wardId: 'W2', formation: 'single', companies: [{ type: 'knights', quality: 'retinue' }] };
    const maa: ArmyDef['units'][0] = { id: 'M', name: "Uomini d'Arme", wardId: 'W2', formation: 'single', companies: [{ type: 'menAtArms', quality: 'veteran' }] };
    let bounced = 0;
    for (let i = 0; i < 12; i++) {
      const s = setup([kn], [maa], { 'A-K': { x: 36, y: 36, facing: 0 }, 'B-M': { x: 36, y: 25, facing: 180 } });
      activate(s, 'A-K');
      must(s, { t: 'attack', side: 'A', unitId: 'A-K', targetId: 'B-M', charge: true });
      if (s.state.log.some((l) => l.text.includes('si sgancia (dietro-front'))) bounced++;
      expect(s.state.units['A-K'].chargesUsed).toBe(1);
    }
    expect(bounced).toBeGreaterThan(0);
  });

  it('una carica deve partire da almeno metà del movimento di carica', () => {
    const kn: ArmyDef['units'][0] = { id: 'K', name: 'Cavalieri', wardId: 'W2', formation: 'single', companies: [{ type: 'knights', quality: 'retinue' }] };
    const s = setup([kn], [bill('Y')], { 'A-K': { x: 36, y: 29, facing: 0 }, 'B-Y': { x: 36, y: 25, facing: 180 } });
    activate(s, 'A-K');
    expect(s.dispatch({ t: 'attack', side: 'A', unitId: 'A-K', targetId: 'B-Y', charge: true })).toMatch(/almeno 6/);
  });

  it('la Leva non attacca senza comandante', () => {
    const levy: ArmyDef['units'][0] = { id: 'L', name: 'Leva', wardId: 'W2', formation: 'single', companies: [{ type: 'billmen', quality: 'levy' }] };
    const s = setup([levy], [bill('Y')], { 'A-L': { x: 36, y: 30, facing: 0 }, 'B-Y': { x: 36, y: 25, facing: 180 } });
    activate(s, 'A-L');
    expect(s.dispatch({ t: 'attack', side: 'A', unitId: 'A-L', targetId: 'B-Y' })).toMatch(/Leva/);
  });
});

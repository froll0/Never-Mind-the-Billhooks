import { Session } from '../src/engine/session';
import { newGame, sampleArmy, type ArmyDef } from '../src/engine/setup';
import type { Intent } from '../src/engine/reducer';
import type { GameState, Side } from '../src/engine/types';
import { unitDims } from '../src/engine/units';

export function must(s: Session, it: Intent) {
  const err = s.dispatch(it);
  if (err) throw new Error(`${it.t}: ${err}`);
}

/** Crea una partita con gli eserciti di esempio già schierati, nella Fase di Manovra. */
export function deployedGame(armies?: { A?: ArmyDef; B?: ArmyDef }, place?: (s: GameState, side: Side) => Record<string, { x: number; y: number; facing?: number }>): Session {
  const s = new Session(newGame('t', { A: 'York', B: 'Lancaster' }));
  must(s, { t: 'setArmy', side: 'A', army: armies?.A ?? sampleArmy('A') });
  must(s, { t: 'setArmy', side: 'B', army: armies?.B ?? sampleArmy('B') });
  must(s, { t: 'armyReady', side: 'A', ready: true });
  must(s, { t: 'armyReady', side: 'B', ready: true });
  const ts = s.state.terrainSide;
  must(s, { t: 'terrainDone', side: ts });
  const p = s.state.pending[0];
  must(s, { t: 'answer', side: p.side, pendingId: p.id, choice: 'keep' });
  for (const side of ['A', 'B'] as Side[]) {
    const custom = place?.(s.state, side) ?? {};
    let x = 12;
    for (const u of Object.values(s.state.units).filter((u) => u.side === side)) {
      const d = unitDims(u);
      const pos = custom[u.id];
      const y = side === 'A' ? 48 - 5 : 5;
      const isSk = u.companies[0].type === 'skirmArchers' || u.companies[0].type === 'handgunners' || u.companies[0].type === 'lightHorse';
      const px = pos?.x ?? (x + d.w / 2);
      must(s, { t: 'place', side, unitId: u.id, x: px, y: pos?.y ?? y, facing: pos?.facing ?? (side === 'A' ? 0 : 180) });
      if (!pos) x += d.w + 1.5;
      void isSk;
    }
    for (const l of Object.values(s.state.leaders).filter((l) => l.side === side)) {
      const unit = Object.values(s.state.units).find((u) => u.side === side && u.wardId === l.wardId);
      if (unit) must(s, { t: 'placeLeader', side, leaderId: l.id, x: 0, y: 0, attachTo: unit.id });
      else must(s, { t: 'placeLeader', side, leaderId: l.id, x: 5, y: side === 'A' ? 47 : 1 });
    }
    must(s, { t: 'deployReady', side, ready: true });
  }
  return s;
}

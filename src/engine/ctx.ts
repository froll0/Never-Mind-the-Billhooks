import { Dice } from './rng';
import type { GameState, LogEntry, PendingDecision, Side } from './types';

export class RuleError extends Error {}

export function fail(msg: string): never {
  throw new RuleError(msg);
}

/** Contesto di esecuzione di un'azione: stato mutabile (copia), dadi e registro. */
export class Ctx {
  private rollCursor = 0;
  constructor(
    public s: GameState,
    public dice: Dice,
    public actor: Side,
    public intentId: number,
  ) {}

  log(text: string, kind: LogEntry['kind'] = 'info', side?: Side) {
    const rolls = this.dice.rolls.slice(this.rollCursor);
    this.rollCursor = this.dice.rolls.length;
    this.s.log.push({
      id: this.s.nextLogId++,
      turn: this.s.turn,
      text,
      kind,
      side,
      rolls: rolls.length ? rolls : undefined,
      intentId: this.intentId,
    });
    if (this.s.log.length > 600) this.s.log.splice(0, this.s.log.length - 600);
  }

  newId(prefix: string): string {
    this.s.idCounter++;
    return `${prefix}${this.s.idCounter}`;
  }

  ask(d: Omit<PendingDecision, 'id'>) {
    this.s.pending.push({ ...d, id: this.newId('p') });
  }
}

export function fmtDice(d: number[]): string {
  return d.join(' ');
}

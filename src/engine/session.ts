import { Ctx } from './ctx';
import { applyIntent, type Intent } from './reducer';
import { Dice, randomSeed } from './rng';
import type { GameState, Side } from './types';

interface HistoryItem {
  before: GameState;
  intent: Intent;
  overrides: Record<number, number>;
}

/**
 * Sessione di gioco autorevole: applica le azioni, conserva la storia recente
 * e gestisce la carta "Ritira" (rilancio di un gruppo di dadi dell'ultima azione).
 */
export class Session {
  history: HistoryItem[] = [];
  constructor(public state: GameState) {}

  dispatch(intent: Intent): string | undefined {
    const it = { ...intent, seed: intent.seed ?? randomSeed() };
    const before = this.state;
    const res = applyIntent(before, it);
    if (res.error) return res.error;
    this.history.push({ before, intent: it, overrides: {} });
    if (this.history.length > 40) this.history.shift();
    this.state = res.state;
    return undefined;
  }

  /** Rilancia il gruppo di dadi `group` dell'ultima azione usando la carta Ritira di `side`. */
  reroll(side: Side, group: number): string | undefined {
    const last = this.history[this.history.length - 1];
    if (!last) return 'Nessun lancio da ritirare';
    const entry = this.state.log.filter((l) => l.intentId === this.state.lastIntentId).flatMap((l) => l.rolls ?? []).find((r) => r.group === group);
    if (!entry) return 'Puoi ritirare solo i dadi dell\'ultima azione';
    if (entry.side !== side) return 'Puoi ritirare solo i tuoi dadi';
    const card = this.state.hands[side].find((h) => h.kind === 'bonus' && h.bonusKind === 'reroll');
    if (!card) return 'Non hai la carta Ritira';
    const overrides = { ...last.overrides, [group]: randomSeed() };
    const res = applyIntent(last.before, last.intent, overrides);
    if (res.error) return res.error;
    const s = res.state;
    s.hands[side] = s.hands[side].filter((h) => !(h.kind === 'bonus' && h.bonusKind === 'reroll'));
    // Il registro della nuova esecuzione sostituisce quello vecchio; aggiungiamo una nota.
    const ctx = new Ctx(s, new Dice(1), side, s.lastIntentId);
    ctx.log(`${s.players[side].name} gioca la carta "Ritira": il lancio "${entry.label}" viene ripetuto e l'azione è stata ricalcolata.`, 'card', side);
    last.overrides = overrides;
    this.state = s;
    return undefined;
  }

  undo(): boolean {
    const last = this.history.pop();
    if (!last) return false;
    this.state = last.before;
    return true;
  }

  load(state: GameState) {
    this.state = state;
    this.history = [];
  }
}

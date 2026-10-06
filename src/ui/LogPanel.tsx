import { useEffect, useRef } from 'react';
import type { DiceRoll, GameState, Side } from '../engine/types';

export function LogPanel({ state, me, onReroll }: { state: GameState; me: Side; onReroll: (group: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const hasReroll = state.hands[me].some((h) => h.kind === 'bonus' && h.bonusKind === 'reroll');
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.log.length]);
  return (
    <div className="log" ref={ref}>
      {state.log.map((e) => {
        const latest = e.intentId === state.lastIntentId;
        return (
          <div key={e.id} className={`log-entry ${e.kind ?? 'info'} ${e.side ? 'side-' + e.side : ''}`}>
            <span className="log-turn">T{e.turn}</span> {e.text}
            {e.rolls?.map((r, i) => (
              <Roll key={i} r={r} canReroll={hasReroll && latest && r.side === me} onReroll={() => onReroll(r.group)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Roll({ r, canReroll, onReroll }: { r: DiceRoll; canReroll: boolean; onReroll: () => void }) {
  return (
    <div className="roll">
      <span className="muted small">{r.label}:</span>
      <span className="dice">
        {r.dice.map((d, i) => (
          <Die key={i} v={d} side={r.side} />
        ))}
        {r.rerolled && (
          <>
            <span className="muted small"> ritirati →</span>
            {r.rerolled.map((d, i) => (
              <Die key={'r' + i} v={d} side={r.side} />
            ))}
          </>
        )}
      </span>
      {canReroll && (
        <button className="small reroll" onClick={onReroll} title="Usa la carta Ritira su questo lancio">
          ↻ Ritira
        </button>
      )}
    </div>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
};

export function Die({ v, side }: { v: number; side: Side }) {
  return (
    <svg className={`die die-${side}`} viewBox="0 0 100 100" aria-label={`${v}`}>
      <rect x="4" y="4" width="92" height="92" rx="18" />
      {PIPS[v]?.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" />
      ))}
    </svg>
  );
}

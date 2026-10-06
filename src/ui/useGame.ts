import { useCallback, useEffect, useRef, useState } from 'react';
import type { Intent } from '../engine/reducer';
import { Session } from '../engine/session';
import { newGame } from '../engine/setup';
import type { GameState, Side } from '../engine/types';
import { GuestNet, HostNet, makeCode } from '../net/peer';

export type Mode = 'local' | 'host' | 'guest';

export interface GameConfig {
  mode: Mode;
  code: string;
  name: string;
  /** Stato salvato da riprendere. */
  resume?: GameState;
}

/** Intent senza lato: il lato lo aggiunge il controller. */
export type IntentIn = Intent extends infer T ? (T extends { side: Side } ? Omit<T, 'side' | 'seed'> : never) : never;

export interface GameApi {
  state: GameState | null;
  me: Side;
  mode: Mode;
  code: string;
  status: string;
  connected: boolean;
  error: string | null;
  clearError: () => void;
  dispatch: (it: IntentIn) => boolean;
  reroll: (group: number) => void;
  setMe: (s: Side) => void;
  undo: () => void;
  canUndo: boolean;
  loadState: (s: GameState) => void;
}

export const SAVE_PREFIX = 'nmtb-save-';

export function saveGame(code: string, state: GameState, mode: Mode) {
  try {
    localStorage.setItem(SAVE_PREFIX + code, JSON.stringify({ state, mode, savedAt: Date.now() }));
  } catch {
    /* archiviazione non disponibile */
  }
}

export function listSaves(): { code: string; mode: Mode; savedAt: number; state: GameState }[] {
  const res: { code: string; mode: Mode; savedAt: number; state: GameState }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith(SAVE_PREFIX)) continue;
      const v = JSON.parse(localStorage.getItem(k)!);
      res.push({ code: k.slice(SAVE_PREFIX.length), ...v });
    }
  } catch {
    /* ignora */
  }
  return res.sort((a, b) => b.savedAt - a.savedAt);
}

export function deleteSave(code: string) {
  try {
    localStorage.removeItem(SAVE_PREFIX + code);
  } catch {
    /* ignora */
  }
}

export function newCode() {
  return makeCode();
}

export function useGame(cfg: GameConfig): GameApi {
  const [state, setState] = useState<GameState | null>(null);
  const [me, setMe] = useState<Side>(cfg.mode === 'guest' ? 'B' : 'A');
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(cfg.mode === 'local');
  const [error, setError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const session = useRef<Session | null>(null);
  const host = useRef<HostNet | null>(null);
  const guest = useRef<GuestNet | null>(null);

  const publish = useCallback(() => {
    const s = session.current!.state;
    setState(s);
    setCanUndo(session.current!.history.length > 0);
    host.current?.broadcast(s);
    saveGame(cfg.code, s, cfg.mode);
  }, [cfg.code, cfg.mode]);

  useEffect(() => {
    if (cfg.mode === 'guest') {
      const g = new GuestNet(cfg.code, cfg.name, {
        onState: (s) => setState(s),
        onError: (m) => setError(m),
        onStatus: (m, c) => {
          setStatus(m);
          setConnected(c);
        },
      });
      guest.current = g;
      return () => g.close();
    }
    const initial = cfg.resume ?? newGame(cfg.code, { A: cfg.name || 'Giocatore 1', B: cfg.mode === 'local' ? 'Giocatore 2' : 'In attesa…' });
    session.current = new Session(initial);
    setState(initial);
    saveGame(cfg.code, initial, cfg.mode);
    if (cfg.mode === 'host') {
      const h = new HostNet(cfg.code, {
        getState: () => session.current!.state,
        onIntent: (it) => {
          const err = session.current!.dispatch(it);
          if (!err) publish();
          return err;
        },
        onReroll: (side, group) => {
          const err = session.current!.reroll(side, group);
          if (!err) publish();
          return err;
        },
        onStatus: (m, c) => {
          setStatus(m);
          setConnected(c);
        },
        onGuestName: (name) => {
          const s = session.current!;
          if (name && s.state.players.B.name !== name) {
            s.dispatch({ t: 'setPlayer', side: 'B', name } as Intent);
            publish();
          }
        },
      });
      host.current = h;
      return () => h.close();
    }
    setStatus('Partita locale (stesso dispositivo)');
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dispatch = useCallback(
    (it: IntentIn): boolean => {
      const full = { ...it, side: me } as Intent;
      if (cfg.mode === 'guest') {
        guest.current?.sendIntent(full);
        return true;
      }
      const err = session.current!.dispatch(full);
      if (err) {
        setError(err);
        return false;
      }
      publish();
      return true;
    },
    [me, cfg.mode, publish],
  );

  const reroll = useCallback(
    (group: number) => {
      if (cfg.mode === 'guest') {
        guest.current?.sendReroll(group);
        return;
      }
      const err = session.current!.reroll(me, group);
      if (err) setError(err);
      else publish();
    },
    [cfg.mode, me, publish],
  );

  const undo = useCallback(() => {
    if (cfg.mode !== 'local') return;
    if (session.current?.undo()) publish();
  }, [cfg.mode, publish]);

  const loadState = useCallback(
    (s: GameState) => {
      if (cfg.mode === 'guest') return;
      session.current!.load(s);
      publish();
    },
    [cfg.mode, publish],
  );

  return {
    state,
    me,
    mode: cfg.mode,
    code: cfg.code,
    status,
    connected,
    error,
    clearError: () => setError(null),
    dispatch,
    reroll,
    setMe: (s) => cfg.mode === 'local' && setMe(s),
    undo,
    canUndo,
    loadState,
  };
}

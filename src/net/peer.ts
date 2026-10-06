import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Intent } from '../engine/reducer';
import type { GameState, Side } from '../engine/types';

export type NetMsg =
  | { type: 'hello'; name: string; side: Side }
  | { type: 'state'; state: GameState }
  | { type: 'intent'; intent: Intent }
  | { type: 'reroll'; group: number }
  | { type: 'error'; message: string }
  | { type: 'ping' };

const PREFIX = 'nmtb-it-';

/**
 * Server di segnalazione: per impostazione predefinita quello pubblico di PeerJS.
 * Si può usarne uno proprio con ?peer=host:porta (utile per i test o se quello pubblico non risponde).
 */
function peerOptions(): PeerOptions {
  const custom = new URLSearchParams(location.search).get('peer');
  if (!custom) return { debug: 1 };
  const [host, port] = custom.split(':');
  const secure = location.protocol === 'https:' && host !== 'localhost';
  return { host, port: port ? +port : secure ? 443 : 80, path: '/', secure, debug: 1 };
}

export function makeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export interface HostHandlers {
  onIntent: (intent: Intent) => string | undefined;
  onReroll: (side: Side, group: number) => string | undefined;
  getState: () => GameState;
  onStatus: (s: string, connected: boolean) => void;
  onGuestName: (name: string) => void;
}

/** L'host tiene lo stato autorevole e lo invia all'ospite a ogni cambiamento. */
export class HostNet {
  peer: Peer;
  conn?: DataConnection;
  constructor(
    public code: string,
    private h: HostHandlers,
  ) {
    this.peer = new Peer(PREFIX + code, peerOptions());
    this.peer.on('open', () => h.onStatus(`Partita aperta. Codice: ${code}`, false));
    this.peer.on('error', (e) => h.onStatus(`Errore di rete: ${e.type}${e.type === 'unavailable-id' ? ' (codice già in uso: ricarica la pagina o crea una nuova partita)' : ''}`, false));
    this.peer.on('disconnected', () => {
      h.onStatus('Disconnesso dal server, riconnessione…', !!this.conn?.open);
      setTimeout(() => this.peer.reconnect(), 1500);
    });
    this.peer.on('connection', (c) => {
      if (this.conn?.open) this.conn.close();
      this.conn = c;
      c.on('open', () => {
        h.onStatus('Avversario connesso', true);
        this.send({ type: 'state', state: h.getState() });
      });
      c.on('data', (d) => this.onData(d as NetMsg));
      c.on('close', () => h.onStatus('Avversario disconnesso: può rientrare con lo stesso link', false));
      c.on('error', () => h.onStatus('Errore di connessione con l\'avversario', false));
    });
  }

  private onData(m: NetMsg) {
    if (m.type === 'hello') {
      this.h.onGuestName(m.name);
      this.send({ type: 'state', state: this.h.getState() });
      return;
    }
    if (m.type === 'intent') {
      // L'ospite gioca sempre il lato B.
      const err = this.h.onIntent({ ...m.intent, side: 'B' } as Intent);
      if (err) this.send({ type: 'error', message: err });
      return;
    }
    if (m.type === 'reroll') {
      const err = this.h.onReroll('B', m.group);
      if (err) this.send({ type: 'error', message: err });
    }
  }

  send(m: NetMsg) {
    if (this.conn?.open) this.conn.send(m);
  }

  broadcast(state: GameState) {
    this.send({ type: 'state', state });
  }

  close() {
    this.conn?.close();
    this.peer.destroy();
  }
}

export interface GuestHandlers {
  onState: (s: GameState) => void;
  onError: (m: string) => void;
  onStatus: (s: string, connected: boolean) => void;
}

export class GuestNet {
  peer: Peer;
  conn?: DataConnection;
  private closed = false;
  constructor(
    public code: string,
    private name: string,
    private h: GuestHandlers,
  ) {
    this.peer = new Peer(peerOptions());
    this.peer.on('open', () => this.connect());
    this.peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') {
        h.onStatus("Partita non trovata: l'host deve tenere aperta la pagina. Nuovo tentativo…", false);
        setTimeout(() => this.connect(), 3000);
      } else h.onStatus(`Errore di rete: ${e.type}`, false);
    });
    this.peer.on('disconnected', () => {
      if (!this.closed) setTimeout(() => this.peer.reconnect(), 1500);
    });
  }

  private connect() {
    if (this.closed) return;
    this.h.onStatus('Connessione alla partita…', false);
    const c = this.peer.connect(PREFIX + this.code, { reliable: true });
    this.conn = c;
    c.on('open', () => {
      this.h.onStatus('Connesso', true);
      c.send({ type: 'hello', name: this.name, side: 'B' } satisfies NetMsg);
    });
    c.on('data', (d) => {
      const m = d as NetMsg;
      if (m.type === 'state') this.h.onState(m.state);
      if (m.type === 'error') this.h.onError(m.message);
    });
    c.on('close', () => {
      if (this.closed) return;
      this.h.onStatus('Connessione persa, riconnessione…', false);
      setTimeout(() => this.connect(), 2000);
    });
  }

  sendIntent(intent: Intent) {
    if (!this.conn?.open) {
      this.h.onError('Non connesso');
      return;
    }
    this.conn.send({ type: 'intent', intent } satisfies NetMsg);
  }

  sendReroll(group: number) {
    this.conn?.send({ type: 'reroll', group } satisfies NetMsg);
  }

  close() {
    this.closed = true;
    this.conn?.close();
    this.peer.destroy();
  }
}

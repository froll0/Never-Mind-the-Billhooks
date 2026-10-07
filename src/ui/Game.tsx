import { useEffect, useState } from 'react';
import { ArmyBuilder } from './ArmyBuilder';
import { LogPanel } from './LogPanel';
import { RulesPanel } from './RulesPanel';
import { ManualPanel } from './SetupPanels';
import { Banner, DeployTray, EventFeed, HandHud, MoraleHud, TerrainTools, ToolHint, autoDeployIntents } from './play/Hud';
import { Table } from './play/Table';
import type { Selection, Tool } from './tools';
import type { GameApi } from './useGame';
import type { GameState, Leader, Side, Unit } from '../engine/types';
import { otherSide } from '../engine/types';

type Tab = 'log' | 'rules' | 'tools';

const PHASE_NAME: Record<GameState['phase'], string> = {
  setup: 'Preparazione eserciti',
  terrain: 'Terreno',
  deploy: 'Schieramento',
  manoeuvre: 'Manovra',
  battle: 'Battaglia',
  endTurn: 'Fine turno',
  gameOver: 'Battaglia conclusa',
};

/** Il lato che deve agire ora (per il gioco sullo stesso dispositivo). */
function actorOf(s: GameState): Side | null {
  if (s.pending.length) return s.pending[0].side;
  if (s.phase === 'manoeuvre') return s.activeSide;
  if (s.phase === 'battle' && s.activation) return s.activation.side;
  if (s.phase === 'terrain') return s.terrainSide;
  if (s.phase === 'endTurn' && s.endTurn) return !s.endTurn.freeDone.A ? 'A' : !s.endTurn.freeDone.B ? 'B' : null;
  if (s.phase === 'deploy') return !s.deployReady.A ? 'A' : !s.deployReady.B ? 'B' : null;
  if (s.phase === 'setup') return !s.armyReady.A ? 'A' : !s.armyReady.B ? 'B' : null;
  return null;
}

export function Game({ api, onExit }: { api: GameApi; onExit: () => void }) {
  const s = api.state;
  const [tool, setTool] = useState<Tool>({ k: 'none' });
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('log');
  const [drawer, setDrawer] = useState(false);
  const [copied, setCopied] = useState(false);

  // In locale si passa automaticamente al giocatore che deve agire.
  const actor = s ? actorOf(s) : null;
  useEffect(() => {
    if (api.mode === 'local' && actor && actor !== api.me) {
      api.setMe(actor);
      setSelection(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, api.mode]);

  useEffect(() => {
    if (!api.error) return;
    const t = setTimeout(api.clearError, 5000);
    return () => clearTimeout(t);
  }, [api.error]);

  // Strumenti legati alla fase: si annullano quando la fase cambia.
  useEffect(() => setTool({ k: 'none' }), [s?.phase]);

  if (!s) {
    return (
      <div className="center-screen">
        <div className="box">
          <h2>Connessione…</h2>
          <p>{api.status || 'In attesa della partita'}</p>
          <button onClick={onExit}>Torna al menu</button>
        </div>
      </div>
    );
  }

  const me = api.me;
  const pendingMine = s.pending.find((p) => p.side === me);
  const pendingOther = s.pending.find((p) => p.side !== me);

  function onPickUnit(u: Unit) {
    if (tool.k !== 'pickUnit') return;
    if (tool.purpose === 'perk' || tool.purpose === 'ambush' || tool.purpose === 'forfeit') {
      if (api.dispatch({ t: 'playCard', handId: tool.handId!, unitId: u.id })) {
        setTool({ k: 'none' });
        if (tool.purpose === 'perk') setSelection({ kind: 'unit', id: u.id });
      }
    } else if (tool.purpose === 'join' || tool.purpose === 'formBlock') {
      if (api.dispatch({ t: 'special', unitId: tool.unitId!, kind: tool.purpose, otherId: u.id })) setTool({ k: 'none' });
    }
  }
  function onPickLeader(l: Leader) {
    if (tool.k === 'pickLeader' && tool.purpose === 'rumour') {
      if (api.dispatch({ t: 'playCard', handId: tool.handId!, leaderId: l.id })) setTool({ k: 'none' });
    }
  }
  function onPickFeature(id: string) {
    if (tool.k !== 'pickFeature') return;
    if (tool.purpose === 'delete') api.dispatch({ t: 'removeFeature', id });
    if (tool.purpose === 'chopHedge' && api.dispatch({ t: 'special', unitId: tool.unitId!, kind: 'chopHedge', featureId: id })) setTool({ k: 'none' });
  }
  function autoDeploy() {
    for (const it of autoDeployIntents(s!, me)) api.dispatch(it);
  }
  function openTab(t: Tab) {
    setTab(t);
    setDrawer(true);
  }

  const peer = new URLSearchParams(location.search).get('peer');
  const inviteLink = `${location.origin}${location.pathname}?join=${api.code}${peer ? `&peer=${peer}` : ''}`;
  const guestMissing = api.mode === 'host' && !api.connected;

  return (
    <div className="game">
      <header className="topbar">
        <button className="ghost-btn" onClick={onExit} title="Menu principale">
          ☰
        </button>
        <div className="title">Never Mind the Billhooks</div>
        <div className="phase-chip">
          {PHASE_NAME[s.phase]}
          {s.turn > 0 && s.phase !== 'gameOver' ? ` · turno ${s.turn}` : ''}
        </div>
        <div className={`player side-${me} me`}>
          <span className="swatch" />
          {s.players[me].name}
          <span className="vs">contro</span>
          <span className={`swatch side-${otherSide(me)}`} />
          {s.players[otherSide(me)].name}
        </div>
        <div className="spacer" />
        {api.mode === 'local' && (
          <div className="seg" title="Chi sta giocando ora (stesso dispositivo)">
            {(['A', 'B'] as Side[]).map((sd) => (
              <button key={sd} className={me === sd ? 'active' : ''} onClick={() => api.setMe(sd)}>
                {s.players[sd].name}
              </button>
            ))}
          </div>
        )}
        {api.mode === 'host' && (
          <button
            className={guestMissing ? 'primary small' : 'small'}
            onClick={() => {
              navigator.clipboard?.writeText(inviteLink);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            title={inviteLink}
          >
            {copied ? 'Link copiato!' : guestMissing ? `Invita l'avversario (${api.code})` : `Codice ${api.code}`}
          </button>
        )}
        <span className={`net ${api.connected ? 'ok' : 'off'}`} title={api.status}>
          {api.mode === 'local' ? '' : api.connected ? '● connesso' : '○ ' + (api.status || 'non connesso')}
        </span>
        {api.mode === 'local' && (
          <button className="small" disabled={!api.canUndo} onClick={api.undo} title="Annulla l'ultima azione">
            ↶ Annulla
          </button>
        )}
        <button className={`small ${drawer ? 'active' : ''}`} onClick={() => setDrawer(!drawer)} title="Registro, regole e strumenti">
          📜 Registro e regole
        </button>
      </header>

      <main className="main">
        <section className="board-col">
          {s.phase === 'setup' ? (
            <div className="setup-wrap">
              <SetupHeader s={s} me={me} api={api} />
              <ArmyBuilder key={me} state={s} side={me} dispatch={api.dispatch} />
            </div>
          ) : (
            <>
              <Table
                state={s}
                me={me}
                dispatch={api.dispatch}
                selection={selection}
                setSelection={setSelection}
                tool={tool}
                setTool={setTool}
                onPickUnit={onPickUnit}
                onPickLeader={onPickLeader}
                onPickFeature={onPickFeature}
              />
              <Banner state={s} me={me} dispatch={api.dispatch} tool={tool} setTool={setTool} onAutoDeploy={autoDeploy} />
              <MoraleHud state={s} me={me} />
              <EventFeed state={s} onOpenLog={() => openTab('log')} />
              <HandHud state={s} me={me} dispatch={api.dispatch} tool={tool} setTool={setTool} />
              <DeployTray state={s} me={me} dispatch={api.dispatch} tool={tool} setTool={setTool} />
              <TerrainTools state={s} me={me} dispatch={api.dispatch} tool={tool} setTool={setTool} />
              <ToolHint tool={tool} setTool={setTool} />
              {!pendingMine && pendingOther && <div className="wait-pill">In attesa della decisione di {s.players[pendingOther.side].name}…</div>}
            </>
          )}
        </section>
        {drawer && (
          <aside className="side-col">
            <nav className="tabs">
              {(
                [
                  ['log', 'Registro'],
                  ['rules', 'Regole'],
                  ['tools', 'Strumenti'],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
              <button className="icon-btn" onClick={() => setDrawer(false)} aria-label="Chiudi il pannello">
                ✕
              </button>
            </nav>
            <div className="tab-body">
              {tab === 'log' && <LogPanel state={s} me={me} onReroll={api.reroll} />}
              {tab === 'rules' && <RulesPanel />}
              {tab === 'tools' && <ManualPanel state={s} me={me} tool={tool} setTool={setTool} dispatch={api.dispatch} selection={selection} />}
            </div>
          </aside>
        )}
      </main>

      {pendingMine && (
        <div className="modal-back">
          <div className="modal">
            <div className="modal-kicker">Decisione</div>
            <p className="modal-text">{pendingMine.prompt}</p>
            <div className="modal-buttons">
              {pendingMine.options.map((o, i) => (
                <button key={o.value} className={i === 0 ? 'primary' : ''} onClick={() => api.dispatch({ t: 'answer', pendingId: pendingMine.id, choice: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {api.error && (
        <div className="toast" onClick={api.clearError}>
          {api.error}
        </div>
      )}
    </div>
  );
}

function SetupHeader({ s, me, api }: { s: GameState; me: Side; api: GameApi }) {
  const [name, setName] = useState(s.players[me].name);
  useEffect(() => setName(s.players[me].name), [me, s.players[me].name]);
  const o = otherSide(me);
  return (
    <div className="setup-head">
      <div className="setup-status">
        <h2>Prepara il tuo esercito</h2>
        <p className="muted">
          Parti da un esercito di esempio e modificalo come vuoi, poi premi <b>Esercito pronto</b>. {s.players[o].name}: {s.armyReady[o] ? <b>pronto ✓</b> : 'in preparazione…'}
        </p>
      </div>
      <label>
        Il tuo nome <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.players[me].name && api.dispatch({ t: 'setPlayer', name })} />
      </label>
      {me === 'A' && (
        <details className="options">
          <summary>Opzioni di gioco</summary>
          <label className="chk">
            <input type="checkbox" checked={s.options.randomCommandClass} onChange={(e) => api.dispatch({ t: 'setOptions', options: { randomCommandClass: e.target.checked } })} /> Classe di comando casuale (1D6)
          </label>
          <label className="chk">
            <input type="checkbox" checked={s.options.fullStrengthReroll} onChange={(e) => api.dispatch({ t: 'setOptions', options: { fullStrengthReroll: e.target.checked } })} /> Unità a piena forza ritirano un 1 al Test del Morale
          </label>
          <label>
            Punti consigliati <input type="number" className="tiny" value={s.options.pointsLimit} onChange={(e) => api.dispatch({ t: 'setOptions', options: { pointsLimit: +e.target.value } })} />
          </label>
        </details>
      )}
    </div>
  );
}

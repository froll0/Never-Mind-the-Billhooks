import { useEffect, useState } from 'react';
import { ActionPanel } from './ActionPanel';
import { ArmyBuilder } from './ArmyBuilder';
import { Board } from './Board';
import { LogPanel } from './LogPanel';
import { RulesPanel } from './RulesPanel';
import { DeployPanel, ManualPanel, TerrainPanel } from './SetupPanels';
import type { Selection, Tool } from './tools';
import type { GameApi } from './useGame';
import type { GameState, Leader, Side, Unit } from '../engine/types';
import { otherSide } from '../engine/types';

type Tab = 'game' | 'log' | 'rules' | 'tools';

const PHASE_NAME: Record<GameState['phase'], string> = {
  setup: 'Preparazione eserciti',
  terrain: 'Terreno',
  deploy: 'Schieramento',
  manoeuvre: 'Fase di Manovra',
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
  const [tab, setTab] = useState<Tab>('game');
  const [copied, setCopied] = useState(false);

  // In locale si passa automaticamente al giocatore che deve agire.
  const actor = s ? actorOf(s) : null;
  useEffect(() => {
    if (api.mode === 'local' && actor && actor !== api.me) api.setMe(actor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, api.mode]);

  useEffect(() => {
    if (!api.error) return;
    const t = setTimeout(api.clearError, 5000);
    return () => clearTimeout(t);
  }, [api.error]);

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
    if (tool.purpose === 'perk' || tool.purpose === 'ambush') {
      if (api.dispatch({ t: 'playCard', handId: tool.handId!, unitId: u.id })) setTool({ k: 'none' });
    } else if (tool.purpose === 'forfeit') {
      if (api.dispatch({ t: 'playCard', handId: tool.handId!, unitId: u.id })) setTool({ k: 'none' });
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

  const peer = new URLSearchParams(location.search).get('peer');
  const inviteLink = `${location.origin}${location.pathname}?join=${api.code}${peer ? `&peer=${peer}` : ''}`;

  return (
    <div className="game">
      <header className="topbar">
        <button className="ghost-btn" onClick={onExit} title="Menu">
          ☰
        </button>
        <div className="title">Never Mind the Billhooks</div>
        <div className="phase-chip">
          {PHASE_NAME[s.phase]}
          {s.turn > 0 && s.phase !== 'gameOver' ? ` · turno ${s.turn}` : ''}
        </div>
        {(['A', 'B'] as Side[]).map((sd) => (
          <div key={sd} className={`player side-${sd} ${me === sd ? 'me' : ''}`}>
            <span className="swatch" />
            <span className="pname">{s.players[sd].name}</span>
            {s.phase !== 'setup' && s.phase !== 'terrain' && s.phase !== 'deploy' && (
              <span className="morale" title="Gettoni Morale d'Armata rimasti">
                ⚑ {s.armyMorale[sd]}/{s.armyMoraleStart[sd]}
              </span>
            )}
          </div>
        ))}
        <div className="spacer" />
        {api.mode === 'local' && (
          <div className="seg" title="Lato controllato (gioco sullo stesso dispositivo)">
            {(['A', 'B'] as Side[]).map((sd) => (
              <button key={sd} className={me === sd ? 'active' : ''} onClick={() => api.setMe(sd)}>
                {s.players[sd].name}
              </button>
            ))}
          </div>
        )}
        {api.mode === 'host' && (
          <button
            className="small"
            onClick={() => {
              navigator.clipboard?.writeText(inviteLink);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            title={inviteLink}
          >
            {copied ? 'Link copiato!' : `Invita (codice ${api.code})`}
          </button>
        )}
        <span className={`net ${api.connected ? 'ok' : 'off'}`} title={api.status}>
          {api.mode === 'local' ? 'locale' : api.connected ? '● connesso' : '○ ' + (api.status || 'non connesso')}
        </span>
        {api.mode === 'local' && (
          <button className="small" disabled={!api.canUndo} onClick={api.undo} title="Annulla l'ultima azione">
            ↶ Annulla
          </button>
        )}
      </header>

      <main className="main">
        <section className="board-col">
          {s.phase === 'setup' ? (
            <div className="setup-wrap">
              <SetupHeader s={s} me={me} api={api} />
              <ArmyBuilder key={me} state={s} side={me} dispatch={api.dispatch} />
            </div>
          ) : (
            <Board
              state={s}
              me={me}
              tool={tool}
              setTool={setTool}
              selection={selection}
              setSelection={setSelection}
              dispatch={api.dispatch}
              onPickUnit={onPickUnit}
              onPickLeader={onPickLeader}
              onPickFeature={onPickFeature}
            />
          )}
        </section>
        <aside className="side-col">
          <nav className="tabs">
            {(
              [
                ['game', 'Gioco'],
                ['log', 'Registro'],
                ['rules', 'Regole'],
                ['tools', 'Strumenti'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === 'game' && (
              <>
                {s.phase === 'gameOver' && (
                  <div className="panel">
                    <div className={`box victory side-${s.winner}`}>
                      <h2>Vittoria di {s.players[s.winner!].name}!</h2>
                      <p>{s.winReason}.</p>
                    </div>
                  </div>
                )}
                {s.phase === 'setup' && <SetupSide s={s} me={me} />}
                {s.phase === 'terrain' && <TerrainPanel state={s} me={me} tool={tool} setTool={setTool} dispatch={api.dispatch} />}
                {s.phase === 'deploy' && <DeployPanel state={s} me={me} tool={tool} setTool={setTool} dispatch={api.dispatch} />}
                {(s.phase === 'manoeuvre' || s.phase === 'battle' || s.phase === 'endTurn' || s.phase === 'gameOver') && (
                  <ActionPanel state={s} me={me} selection={selection} setSelection={setSelection} tool={tool} setTool={setTool} dispatch={api.dispatch} />
                )}
                <div className="panel">
                  <div className="box">
                    <h4>Ultimi eventi</h4>
                    <div className="mini-log">
                      <LogPanel state={{ ...s, log: s.log.slice(-8) }} me={me} onReroll={api.reroll} />
                    </div>
                  </div>
                </div>
              </>
            )}
            {tab === 'log' && <LogPanel state={s} me={me} onReroll={api.reroll} />}
            {tab === 'rules' && <RulesPanel />}
            {tab === 'tools' && <ManualPanel state={s} me={me} tool={tool} setTool={setTool} dispatch={api.dispatch} selection={selection} />}
          </div>
        </aside>
      </main>

      {pendingMine && (
        <div className="modal-back">
          <div className="modal">
            <h3>Decisione</h3>
            <p>{pendingMine.prompt}</p>
            <div className="row wrap">
              {pendingMine.options.map((o) => (
                <button key={o.value} className="primary" onClick={() => api.dispatch({ t: 'answer', pendingId: pendingMine.id, choice: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {!pendingMine && pendingOther && <div className="banner">In attesa della decisione di {s.players[pendingOther.side].name}…</div>}
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
  return (
    <div className="setup-head">
      <label>
        Il tuo nome{' '}
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.players[me].name && api.dispatch({ t: 'setPlayer', name })} />
      </label>
      {me === 'A' && (
        <div className="options">
          <label className="chk">
            <input type="checkbox" checked={s.options.randomCommandClass} onChange={(e) => api.dispatch({ t: 'setOptions', options: { randomCommandClass: e.target.checked } })} /> Classe di comando casuale (1D6)
          </label>
          <label className="chk">
            <input type="checkbox" checked={s.options.fullStrengthReroll} onChange={(e) => api.dispatch({ t: 'setOptions', options: { fullStrengthReroll: e.target.checked } })} /> Regola opzionale: unità a piena forza ritirano un 1 al Test del Morale
          </label>
          <label>
            Punti consigliati{' '}
            <input type="number" className="tiny" value={s.options.pointsLimit} onChange={(e) => api.dispatch({ t: 'setOptions', options: { pointsLimit: +e.target.value } })} />
          </label>
        </div>
      )}
    </div>
  );
}

function SetupSide({ s, me }: { s: GameState; me: Side }) {
  const o = otherSide(me);
  return (
    <div className="panel">
      <div className="box">
        <h3>Preparazione</h3>
        <p className="small">Componi il tuo esercito a sinistra, poi premi «Esercito pronto». Quando entrambi sono pronti si passa al terreno.</p>
        <p>
          Tu: {s.armyReady[me] ? <b>pronto ✓</b> : 'in preparazione'}
          <br />
          {s.players[o].name}: {s.armyReady[o] ? <b>pronto ✓</b> : 'in preparazione'}
        </p>
      </div>
    </div>
  );
}

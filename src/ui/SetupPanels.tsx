import { useState } from 'react';
import { TROOPS } from '../engine/data';
import type { AreaKind, GameState, LineKind, Side } from '../engine/types';
import { otherSide } from '../engine/types';
import { liveLeaders, liveUnits } from '../engine/units';
import { AREA_NAMES, LINE_NAMES, type Selection, type Tool } from './tools';
import type { IntentIn } from './useGame';

interface P {
  state: GameState;
  me: Side;
  tool: Tool;
  setTool: (t: Tool) => void;
  dispatch: (it: IntentIn) => boolean;
  selection?: Selection;
}

export function TerrainPanel(p: P) {
  const s = p.state;
  const mine = s.terrainSide === p.me;
  if (!mine)
    return (
      <div className="panel">
        <div className="box">
          <h3>Terreno</h3>
          <p>
            {s.players[s.terrainSide].name} sta preparando il terreno. Poi sceglierai da quale lato schierarti.
          </p>
        </div>
      </div>
    );
  const areaKinds: AreaKind[] = ['wood', 'hill', 'steepHill', 'marsh', 'builtUp', 'building'];
  const lineKinds: LineKind[] = ['hedge', 'wall', 'stream', 'fence'];
  return (
    <div className="panel">
      <div className="box">
        <h3>Prepara il terreno</h3>
        <p className="small">Hai vinto il lancio della moneta. Disegna il campo di battaglia: l'avversario sceglierà poi il lato.</p>
        <h4>Aree (trascina per disegnare)</h4>
        <div className="row wrap">
          {areaKinds.map((k) => (
            <button key={k} className={p.tool.k === 'area' && p.tool.kind === k ? 'active' : ''} onClick={() => p.setTool({ k: 'area', kind: k })}>
              {AREA_NAMES[k]}
            </button>
          ))}
        </div>
        <h4>Linee (clic sui punti, doppio clic per finire)</h4>
        <div className="row wrap">
          {lineKinds.map((k) => (
            <button key={k} className={p.tool.k === 'line' && p.tool.kind === k ? 'active' : ''} onClick={() => p.setTool({ k: 'line', kind: k, points: [] })}>
              {LINE_NAMES[k]}
            </button>
          ))}
        </div>
        <div className="row wrap">
          <button className={p.tool.k === 'pickFeature' ? 'active' : ''} onClick={() => p.setTool({ k: 'pickFeature', purpose: 'delete' })}>
            Cancella elemento
          </button>
          <button onClick={() => p.dispatch({ t: 'randomTerrain' })}>Terreno casuale</button>
          <button onClick={() => confirm('Cancellare tutto il terreno?') && p.dispatch({ t: 'clearTerrain' })}>Svuota</button>
        </div>
        <p className="muted small">
          Boschi, paludi, colline ripide e abitati sono terreno difficile. Le colline normali influenzano attacchi in salita e tiro sopra le teste. Siepi e muri sono ostacoli e copertura leggera.
        </p>
        <button className="primary" onClick={() => p.dispatch({ t: 'terrainDone' })}>
          Terreno pronto
        </button>
      </div>
    </div>
  );
}

export function DeployPanel(p: P) {
  const s = p.state;
  const units = liveUnits(s, p.me);
  const leaders = liveLeaders(s, p.me);
  const unplaced = units.filter((u) => u.unplaced);
  const placed = units.filter((u) => !u.unplaced);
  const lUnplaced = leaders.filter((l) => l.unplaced);
  const ready = s.deployReady[p.me];
  const facing = p.me === 'A' ? 0 : 180;
  const stakes = units.flatMap((u) => u.companies).filter((c) => c.stakes && !c.stakesPlanted).length;
  return (
    <div className="panel">
      <div className="box">
        <h3>Schieramento</h3>
        <p className="small">
          Comincia <b>{s.players[s.firstSide].name}</b>. Di norma si schierano prima Schermagliatori e Artiglieria, poi una Schiera alla volta. La tua zona è la fascia colorata sul tuo lato
          {p.me === 'A' ? ' (in basso)' : ' (in alto)'}. Q/E ruotano l'unità prima di piazzarla.
        </p>
        <p className="small">
          Avversario: {s.deployReady[otherSide(p.me)] ? 'pronto ✓' : 'sta schierando…'}
        </p>
        {unplaced.length > 0 && (
          <>
            <h4>Da schierare</h4>
            <ul className="plain">
              {unplaced.map((u) => (
                <li key={u.id}>
                  <button className={p.tool.k === 'place' && p.tool.unitId === u.id ? 'active' : ''} onClick={() => p.setTool({ k: 'place', unitId: u.id, facing })}>
                    {u.name}
                  </button>{' '}
                  <span className="muted small">
                    {u.companies.map((c) => TROOPS[c.type].name).join(' + ')} · {s.wards[u.wardId]?.name}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {lUnplaced.length > 0 && (
          <>
            <h4>Comandanti</h4>
            <ul className="plain">
              {lUnplaced.map((l) => (
                <li key={l.id}>
                  <button className={p.tool.k === 'placeLeader' && p.tool.leaderId === l.id ? 'active' : ''} onClick={() => p.setTool({ k: 'placeLeader', leaderId: l.id })}>
                    {l.isCinC ? '♛ ' : ''}
                    {l.name}
                  </button>{' '}
                  <span className="muted small">clic su un'unità per aggregarlo, o sul tavolo</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {(s.defencesToPlace[p.me] > 0 || stakes > 0) && (
          <>
            <h4>Difese</h4>
            <div className="row wrap">
              {s.defencesToPlace[p.me] > 0 && (
                <button onClick={() => p.setTool({ k: 'defence', kind: 'fieldDefence', points: [] })}>Difese campali ({s.defencesToPlace[p.me]})</button>
              )}
              {stakes > 0 && <button onClick={() => p.setTool({ k: 'defence', kind: 'stakes', points: [] })}>Pali degli arcieri ({stakes})</button>}
            </div>
            <p className="muted small">Clic per i punti (circa 5" di lunghezza), doppio clic per finire.</p>
          </>
        )}
        {placed.length > 0 && (
          <details>
            <summary>Unità schierate ({placed.length})</summary>
            <ul className="plain">
              {placed.map((u) => (
                <li key={u.id}>
                  {u.name}{' '}
                  <button className="small" onClick={() => p.setTool({ k: 'place', unitId: u.id, facing: u.facing })}>
                    Sposta
                  </button>
                  <button className="small" onClick={() => p.dispatch({ t: 'unplace', unitId: u.id })}>
                    Togli
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <button className={ready ? '' : 'primary'} onClick={() => p.dispatch({ t: 'deployReady', ready: !ready })}>
          {ready ? 'Modifica schieramento' : 'Schieramento completato ✓'}
        </button>
      </div>
    </div>
  );
}

export function ManualPanel(p: P & { selection: Selection }) {
  const s = p.state;
  const u = p.selection?.kind === 'unit' ? s.units[p.selection.id] : undefined;
  const l = p.selection?.kind === 'leader' ? s.leaders[p.selection.id] : undefined;
  const [note, setNote] = useState('');
  return (
    <div className="panel">
      <div className="box">
        <h3>Strumenti manuali</h3>
        <p className="small muted">
          Per correggere situazioni particolari, applicare carte o regole non automatizzate (scenari, teatri). Ogni modifica viene annotata nel registro, visibile a entrambi.
        </p>
        <div className="row wrap">
          <button className={p.tool.k === 'measure' ? 'active' : ''} onClick={() => p.setTool(p.tool.k === 'measure' ? { k: 'none' } : { k: 'measure' })}>
            📏 Righello
          </button>
          <button className={p.tool.k === 'manualMove' ? 'active' : ''} onClick={() => p.setTool(p.tool.k === 'manualMove' ? { k: 'none' } : { k: 'manualMove' })}>
            Spostamento libero
          </button>
        </div>
        {p.tool.k === 'manualMove' && <p className="hint">Clicca un'unità o un comandante, poi il punto di arrivo (Q/E per ruotare).</p>}
      </div>
      {u && (
        <div className="box">
          <h4>{u.name}</h4>
          {u.companies.map((c, i) => (
            <div className="row" key={i}>
              <span className="small">{TROOPS[c.type].short}</span>
              <label className="small">
                figure <input type="number" className="tiny" value={c.figures} min={0} max={c.maxFigures} onChange={(e) => p.dispatch({ t: 'manualUnit', unitId: u.id, patch: {}, companies: u.companies.map((_, j) => (j === i ? { figures: +e.target.value } : {})) })} />
              </label>
              <label className="small">
                perdite <input type="number" className="tiny" value={c.kills} min={0} onChange={(e) => p.dispatch({ t: 'manualUnit', unitId: u.id, patch: {}, companies: u.companies.map((_, j) => (j === i ? { kills: +e.target.value } : {})) })} />
              </label>
              {c.arrows !== undefined && (
                <label className="small">
                  frecce <input type="number" className="tiny" value={c.arrows} min={0} max={6} onChange={(e) => p.dispatch({ t: 'manualUnit', unitId: u.id, patch: {}, companies: u.companies.map((_, j) => (j === i ? { arrows: +e.target.value } : {})) })} />
                </label>
              )}
            </div>
          ))}
          <div className="row">
            <label className="small">
              Disordine <input type="number" className="tiny" min={0} max={2} value={u.disarray} onChange={(e) => p.dispatch({ t: 'manualUnit', unitId: u.id, patch: { disarray: +e.target.value } })} />
            </label>
            <label className="small chk">
              <input type="checkbox" checked={u.daunted} onChange={(e) => p.dispatch({ t: 'manualUnit', unitId: u.id, patch: { daunted: e.target.checked } })} /> Scossa
            </label>
          </div>
          <button className="danger small" onClick={() => confirm(`Rimuovere ${u.name} dal tavolo?`) && p.dispatch({ t: 'manualRemove', unitId: u.id })}>
            Rimuovi dal tavolo
          </button>
        </div>
      )}
      {l && (
        <div className="box">
          <h4>{l.name}</h4>
          <div className="row">
            <label className="small">
              Classe <input type="number" className="tiny" min={0} max={3} value={l.cls} onChange={(e) => p.dispatch({ t: 'manualLeader', leaderId: l.id, patch: { cls: +e.target.value } })} />
            </label>
            <label className="small chk">
              <input type="checkbox" checked={l.mounted} onChange={(e) => p.dispatch({ t: 'manualLeader', leaderId: l.id, patch: { mounted: e.target.checked } })} /> a cavallo
            </label>
            {l.attachedTo && (
              <button className="small" onClick={() => p.dispatch({ t: 'manualLeader', leaderId: l.id, patch: { attachedTo: null, x: l.x, y: l.y + (l.side === 'A' ? 1.5 : -1.5) } })}>
                Sgancia dall'unità
              </button>
            )}
          </div>
        </div>
      )}
      <div className="box">
        <h4>Morale d'Armata</h4>
        {(['A', 'B'] as Side[]).map((sd) => (
          <div className="row" key={sd}>
            <span className={`chip side-${sd}`}>{s.players[sd].name}</span>
            <input type="number" className="tiny" min={0} value={s.armyMorale[sd]} onChange={(e) => p.dispatch({ t: 'manualMorale', target: sd, value: +e.target.value })} />
            <span className="muted small">/ {s.armyMoraleStart[sd]}</span>
          </div>
        ))}
      </div>
      <div className="box">
        <h4>Nota nel registro</h4>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Es. applicato l'evento Tradimento all'unità…" />
        <div className="row">
          <button
            disabled={!note.trim()}
            onClick={() => {
              if (p.dispatch({ t: 'note', text: note })) setNote('');
            }}
          >
            Aggiungi nota
          </button>
          <button className="danger" onClick={() => confirm('Vuoi davvero arrenderti?') && p.dispatch({ t: 'concede' })}>
            Arrenditi
          </button>
        </div>
      </div>
    </div>
  );
}

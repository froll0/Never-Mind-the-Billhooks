import { useState } from 'react';
import { TROOPS } from '../engine/data';
import type { GameState, Side } from '../engine/types';
import type { Selection, Tool } from './tools';
import type { IntentIn } from './useGame';

interface P {
  state: GameState;
  me: Side;
  tool: Tool;
  setTool: (t: Tool) => void;
  dispatch: (it: IntentIn) => boolean;
  selection?: Selection;
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
            ✋ Spostamento libero
          </button>
        </div>
        <p className="muted small">Seleziona un'unità o un comandante sul tavolo per modificarne figure, perdite e segnalini qui sotto.</p>
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

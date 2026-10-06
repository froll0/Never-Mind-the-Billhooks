import { useEffect, useState } from 'react';
import { CLASS_NAME, QUALITY_NAME, TROOPS, TROOP_ORDER, allowedQualities } from '../engine/data';
import { armyPoints, armyWarnings, companyDefPoints, sampleArmy, type ArmyDef, type CompanyDef, type UnitDef } from '../engine/setup';
import type { GameState, Side } from '../engine/types';
import type { IntentIn } from './useGame';

const PRESET_KEY = 'nmtb-armies';

function loadPresets(): Record<string, ArmyDef> {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePresets(p: Record<string, ArmyDef>) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(p));
  } catch {
    /* ignora */
  }
}

let uid = 100;
const nid = (p: string) => `${p}${++uid}${Math.floor(Math.random() * 1000)}`;

/** Ricostruisce la definizione d'esercito dallo stato (per modificarla dopo il caricamento). */
function armyFromState(s: GameState, side: Side): ArmyDef | null {
  const units = Object.values(s.units).filter((u) => u.side === side && !u.removed);
  const leaders = Object.values(s.leaders).filter((l) => l.side === side);
  if (!units.length && !leaders.length) return null;
  const strip = (id: string) => id.slice(2);
  return {
    faction: s.players[side].faction,
    leaders: leaders.map((l) => ({ id: strip(l.id), name: l.name, rank: l.rank, cls: l.maxClass, mounted: l.mounted, isCinC: l.isCinC })),
    wards: Object.values(s.wards)
      .filter((w) => w.side === side)
      .map((w) => ({ id: strip(w.id), name: w.name, leaderId: strip(w.leaderId) })),
    units: units.map((u) => ({
      id: strip(u.id),
      name: u.name,
      wardId: strip(u.wardId),
      formation: u.formation,
      companies: u.companies.map((c) => ({ type: c.type, quality: c.quality, stakes: c.stakes, pavises: c.pavises, mountedShooters: c.mountedShooters })),
    })),
  };
}

export function ArmyBuilder({ state, side, dispatch }: { state: GameState; side: Side; dispatch: (it: IntentIn) => boolean }) {
  const [army, setArmy] = useState<ArmyDef>(() => armyFromState(state, side) ?? sampleArmy(side));
  const [dirty, setDirty] = useState(!armyFromState(state, side));
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState('');
  const ready = state.armyReady[side];

  useEffect(() => {
    if (!armyFromState(state, side)) {
      dispatch({ t: 'setArmy', army });
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pts = armyPoints(army);
  const warnings = armyWarnings(army);

  function update(a: ArmyDef) {
    setArmy(a);
    setDirty(true);
  }

  function apply() {
    if (dispatch({ t: 'setArmy', army })) setDirty(false);
  }

  function setUnit(i: number, patch: Partial<UnitDef>) {
    const units = army.units.map((u, j) => (j === i ? { ...u, ...patch } : u));
    update({ ...army, units });
  }

  function setCompany(i: number, ci: number, patch: Partial<CompanyDef>) {
    const u = army.units[i];
    const companies = u.companies.map((c, j) => {
      if (j !== ci) return c;
      const n = { ...c, ...patch };
      if (!allowedQualities(n.type).includes(n.quality)) n.quality = 'retinue';
      if (n.type !== 'archers') delete n.stakes;
      if (!['crossbowmen', 'handgunners'].includes(n.type)) delete n.pavises;
      if (n.type !== 'lightHorse') delete n.mountedShooters;
      return n;
    });
    // In una formazione appaiata la qualità è la stessa.
    if (patch.quality && companies.length === 2) companies.forEach((c) => (c.quality = allowedQualities(c.type).includes(patch.quality!) ? patch.quality! : c.quality));
    setUnit(i, { companies });
  }

  function setFormation(i: number, f: UnitDef['formation']) {
    const u = army.units[i];
    if (f === 'single') setUnit(i, { formation: f, companies: [u.companies[0]] });
    else {
      const first = u.companies[0];
      const second: CompanyDef = u.companies[1] ?? (f === 'mixed' ? { type: first.type === 'archers' ? 'billmen' : 'archers', quality: first.quality } : { ...first });
      setUnit(i, { formation: f, companies: [first, second] });
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(army, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `esercito-${(army.faction || 'billhooks').replace(/\s+/g, '_')}.json`;
    a.click();
  }

  function importJson(f: File) {
    f.text().then((t) => {
      try {
        update(JSON.parse(t));
      } catch {
        alert('File non valido');
      }
    });
  }

  const infantryTypes = TROOP_ORDER.filter((t) => TROOPS[t].arm === 'infantry');

  return (
    <div className="builder">
      <div className="builder-head">
        <label>
          Fazione{' '}
          <input value={army.faction} onChange={(e) => update({ ...army, faction: e.target.value })} disabled={ready} />
        </label>
        <div className="points">
          <b>{pts.total}</b> punti <span className="muted">(truppe {pts.troops} + comandanti {pts.leaders}{pts.extras ? ` + difese ${pts.extras}` : ''})</span>
          <span className="muted"> · consigliati {state.options.pointsLimit}</span>
        </div>
      </div>

      <h3>Comandanti</h3>
      <table className="tbl">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Rango</th>
            <th>Classe</th>
            <th>A cavallo</th>
            <th>C-in-C</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {army.leaders.map((l, i) => (
            <tr key={l.id}>
              <td>
                <input value={l.name} disabled={ready} onChange={(e) => update({ ...army, leaders: army.leaders.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              </td>
              <td>
                <input className="short" value={l.rank} disabled={ready} onChange={(e) => update({ ...army, leaders: army.leaders.map((x, j) => (j === i ? { ...x, rank: e.target.value } : x)) })} />
              </td>
              <td>
                <select value={l.cls} disabled={ready || state.options.randomCommandClass} onChange={(e) => update({ ...army, leaders: army.leaders.map((x, j) => (j === i ? { ...x, cls: +e.target.value } : x)) })}>
                  {[1, 2, 3].map((c) => (
                    <option key={c} value={c}>
                      {CLASS_NAME[c]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="checkbox" checked={l.mounted} disabled={ready} onChange={(e) => update({ ...army, leaders: army.leaders.map((x, j) => (j === i ? { ...x, mounted: e.target.checked } : x)) })} />
              </td>
              <td>
                <input type="radio" name={`cinc-${side}`} checked={l.isCinC} disabled={ready} onChange={() => update({ ...army, leaders: army.leaders.map((x, j) => ({ ...x, isCinC: j === i })) })} />
              </td>
              <td>
                <button
                  className="icon"
                  title="Rimuovi"
                  disabled={ready || army.leaders.length <= 1}
                  onClick={() => update({ ...army, leaders: army.leaders.filter((_, j) => j !== i), wards: army.wards.filter((w) => w.leaderId !== l.id) })}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        disabled={ready || army.leaders.length >= 6}
        onClick={() => {
          const id = nid('L');
          const wid = nid('W');
          update({ ...army, leaders: [...army.leaders, { id, name: 'Nuovo comandante', rank: 'Cavaliere', cls: 2, mounted: false, isCinC: false }], wards: [...army.wards, { id: wid, name: `Schiera ${army.wards.length + 1}`, leaderId: id }] });
        }}
      >
        + Comandante (e Schiera)
      </button>

      <h3>Schiere</h3>
      <div className="wards">
        {army.wards.map((w, i) => (
          <div key={w.id} className="ward-row">
            <input value={w.name} disabled={ready} onChange={(e) => update({ ...army, wards: army.wards.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <span className="muted">guidata da</span>
            <select value={w.leaderId} disabled={ready} onChange={(e) => update({ ...army, wards: army.wards.map((x, j) => (j === i ? { ...x, leaderId: e.target.value } : x)) })}>
              {army.leaders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <h3>Unità</h3>
      <div className="units-list">
        {army.units.map((u, i) => (
          <div key={u.id} className="unit-card">
            <div className="unit-card-head">
              <input value={u.name} disabled={ready} onChange={(e) => setUnit(i, { name: e.target.value })} />
              <select value={u.wardId} disabled={ready} onChange={(e) => setUnit(i, { wardId: e.target.value })}>
                {army.wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <span className="pts">{u.companies.reduce((a, c) => a + companyDefPoints(c), 0)} pt</span>
              <button className="icon" title="Rimuovi unità" disabled={ready} onClick={() => update({ ...army, units: army.units.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
            {u.companies.map((c, ci) => (
              <div key={ci} className="company-row">
                <select value={c.type} disabled={ready} onChange={(e) => setCompany(i, ci, { type: e.target.value as CompanyDef['type'] })}>
                  {(u.companies.length === 2 ? infantryTypes : TROOP_ORDER).map((t) => (
                    <option key={t} value={t}>
                      {TROOPS[t].name}
                    </option>
                  ))}
                </select>
                <select value={c.quality} disabled={ready} onChange={(e) => setCompany(i, ci, { quality: e.target.value as CompanyDef['quality'] })}>
                  {allowedQualities(c.type).map((q) => (
                    <option key={q} value={q}>
                      {QUALITY_NAME[q]}
                    </option>
                  ))}
                </select>
                {c.type === 'archers' && (
                  <label className="chk">
                    <input type="checkbox" checked={!!c.stakes} disabled={ready} onChange={(e) => setCompany(i, ci, { stakes: e.target.checked })} /> pali (+3)
                  </label>
                )}
                {(c.type === 'crossbowmen' || c.type === 'handgunners') && (
                  <label className="chk">
                    <input type="checkbox" checked={!!c.pavises} disabled={ready} onChange={(e) => setCompany(i, ci, { pavises: e.target.checked })} /> pavesi (+3)
                  </label>
                )}
                {c.type === 'lightHorse' && (
                  <label className="chk">
                    <input type="checkbox" checked={!!c.mountedShooters} disabled={ready} onChange={(e) => setCompany(i, ci, { mountedShooters: e.target.checked })} /> arcieri/balestrieri a cavallo
                  </label>
                )}
                <span className="muted">
                  {TROOPS[c.type].figures} fig. · {companyDefPoints(c)} pt
                </span>
              </div>
            ))}
            {TROOPS[u.companies[0].type].arm === 'infantry' && (
              <div className="company-row">
                <span className="muted">Formazione:</span>
                <select value={u.formation} disabled={ready} onChange={(e) => setFormation(i, e.target.value as UnitDef['formation'])}>
                  <option value="single">Compagnia singola</option>
                  <option value="line">Linea (2 compagnie affiancate)</option>
                  <option value="block">Blocco (2 compagnie in colonna)</option>
                  <option value="mixed">Blocco misto (Arcieri + Bill/UdA)</option>
                </select>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <select
          disabled={ready}
          value=""
          onChange={(e) => {
            const t = e.target.value as CompanyDef['type'];
            if (!t) return;
            update({ ...army, units: [...army.units, { id: nid('U'), name: TROOPS[t].name, wardId: army.wards[0]?.id ?? '', formation: 'single', companies: [{ type: t, quality: 'retinue' }] }] });
          }}
        >
          <option value="">+ Aggiungi unità…</option>
          {TROOP_ORDER.map((t) => (
            <option key={t} value={t}>
              {TROOPS[t].name} ({TROOPS[t].unitPoints} pt)
            </option>
          ))}
        </select>
        <label className="chk">
          Difese campali{' '}
          <input type="number" min={0} max={6} className="short" value={army.fieldDefences ?? 0} disabled={ready} onChange={(e) => update({ ...army, fieldDefences: +e.target.value })} /> (×3 pt, da piazzare allo schieramento)
        </label>
      </div>

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="row wrap">
        <button disabled={ready} onClick={() => update(sampleArmy(side))}>
          Esercito di esempio
        </button>
        <button onClick={exportJson}>Esporta JSON</button>
        <label className="button">
          Importa JSON
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
        <input placeholder="Nome per salvare" value={presetName} onChange={(e) => setPresetName(e.target.value)} className="short" />
        <button
          disabled={!presetName}
          onClick={() => {
            const p = { ...presets, [presetName]: army };
            savePresets(p);
            setPresets(p);
          }}
        >
          Salva
        </button>
        {Object.keys(presets).length > 0 && (
          <select
            value=""
            disabled={ready}
            onChange={(e) => {
              const p = presets[e.target.value];
              if (p) update(structuredClone(p));
            }}
          >
            <option value="">Carica esercito salvato…</option>
            {Object.keys(presets).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="row sticky-actions">
        {dirty ? (
          <button className="primary" onClick={apply}>
            Conferma esercito
          </button>
        ) : (
          <button className={ready ? '' : 'primary'} onClick={() => dispatch({ t: 'armyReady', ready: !ready })}>
            {ready ? 'Modifica esercito' : 'Esercito pronto ✓'}
          </button>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import type { GameState } from '../engine/types';
import { Game } from './Game';
import { deleteSave, listSaves, newCode, useGame, type GameConfig } from './useGame';

const NAME_KEY = 'nmtb-name';

function getName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function App() {
  const params = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  const hostCode = params.get('host');
  const [cfg, setCfg] = useState<GameConfig | null>(() => {
    // Ricaricando la pagina dell'host si riprende la stessa partita con lo stesso codice.
    const sv = hostCode ? listSaves().find((x) => x.code === hostCode) : undefined;
    return sv ? { mode: 'host', code: sv.code, name: getName() || sv.state.players.A.name, resume: sv.state } : null;
  });
  if (cfg) return <GameScreen cfg={cfg} onExit={() => setCfg(null)} />;
  return <Home initialJoin={joinCode} onStart={setCfg} />;
}

function GameScreen({ cfg, onExit }: { cfg: GameConfig; onExit: () => void }) {
  const api = useGame(cfg);
  return (
    <Game
      api={api}
      onExit={() => {
        if (confirm('Tornare al menu? La partita resta salvata in questo browser.')) {
          const peer = new URLSearchParams(location.search).get('peer');
          history.replaceState(null, '', location.pathname + (peer ? `?peer=${peer}` : ''));
          onExit();
        }
      }}
    />
  );
}

function Home({ initialJoin, onStart }: { initialJoin: string | null; onStart: (c: GameConfig) => void }) {
  const [name, setName] = useState(getName());
  const [code, setCode] = useState(initialJoin ?? '');
  const saves = useMemo(() => listSaves(), []);
  const [, force] = useState(0);

  function remember() {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignora */
    }
  }

  function start(mode: GameConfig['mode'], c?: string, resume?: GameState) {
    remember();
    const theCode = c ?? newCode();
    const peer = new URLSearchParams(location.search).get('peer');
    if (mode === 'host') history.replaceState(null, '', `${location.pathname}?host=${theCode}${peer ? `&peer=${peer}` : ''}`);
    onStart({ mode, code: theCode, name: name || (mode === 'guest' ? 'Ospite' : 'Giocatore 1'), resume });
  }

  function importFile(f: File) {
    f.text().then((t) => {
      try {
        const data = JSON.parse(t);
        const state: GameState = data.state ?? data;
        start('local', newCode(), state);
      } catch {
        alert('File di salvataggio non valido');
      }
    });
  }

  return (
    <div className="home">
      <div className="hero">
        <h1>Never Mind the Billhooks</h1>
        <p className="subtitle">Il wargame delle Guerre delle Due Rose, da giocare online con un amico.</p>
      </div>
      <div className="home-grid">
        <div className="box">
          <h2>Il tuo nome</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Riccardo di Gloucester" />
        </div>
        {initialJoin ? (
          <div className="box highlight">
            <h2>Sei stato invitato</h2>
            <p>Partita {initialJoin}. Inserisci il tuo nome e unisciti.</p>
            <button className="primary big" onClick={() => start('guest', initialJoin)}>
              Unisciti alla partita
            </button>
          </div>
        ) : (
          <>
            <div className="box">
              <h2>Nuova partita online</h2>
              <p className="small">Crei la partita e mandi il link all'avversario. Tu giochi il primo esercito (bordo sud). Tieni aperta questa pagina finché giocate: la partita vive nel tuo browser.</p>
              <button className="primary big" onClick={() => start('host')}>
                Crea partita online
              </button>
            </div>
            <div className="box">
              <h2>Unisciti con un codice</h2>
              <div className="row">
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().trim())} placeholder="Codice (es. K7P2QM)" className="code-input" />
                <button className="primary" disabled={code.length < 4} onClick={() => start('guest', code)}>
                  Entra
                </button>
              </div>
            </div>
            <div className="box">
              <h2>Partita sullo stesso dispositivo</h2>
              <p className="small">Per provare le regole o giocare allo stesso tavolo.</p>
              <button onClick={() => start('local')}>Gioca in locale</button>
            </div>
          </>
        )}
        {saves.length > 0 && !initialJoin && (
          <div className="box wide">
            <h2>Partite salvate in questo browser</h2>
            <table className="tbl">
              <tbody>
                {saves.map((sv) => (
                  <tr key={sv.code}>
                    <td>
                      <b>{sv.state.players.A.name}</b> contro <b>{sv.state.players.B.name}</b>
                      <div className="muted small">
                        {sv.mode === 'host' ? 'online (host)' : 'locale'} · turno {sv.state.turn} · {new Date(sv.savedAt).toLocaleString('it-IT')}
                        {sv.state.phase === 'gameOver' ? ' · conclusa' : ''}
                      </div>
                    </td>
                    <td className="right">
                      <button onClick={() => start(sv.mode === 'host' ? 'host' : 'local', sv.code, sv.state)}>Riprendi</button>
                      <button
                        onClick={() => {
                          const blob = new Blob([JSON.stringify(sv, null, 1)], { type: 'application/json' });
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(blob);
                          a.download = `billhooks-${sv.code}.json`;
                          a.click();
                        }}
                      >
                        Esporta
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          if (confirm('Eliminare il salvataggio?')) {
                            deleteSave(sv.code);
                            force((x) => x + 1);
                            location.reload();
                          }
                        }}
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label className="button">
              Importa un salvataggio
              <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            </label>
          </div>
        )}
      </div>
      <footer className="muted small">
        Piattaforma amatoriale non ufficiale per giocare a distanza. Serve il manuale <i>Never Mind the Billhooks</i> (A. Callan, Wargames Illustrated). Connessione diretta tra i due browser (WebRTC).
      </footer>
    </div>
  );
}

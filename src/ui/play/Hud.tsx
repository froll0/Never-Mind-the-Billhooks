import { useState } from 'react';
import { BONUS_CARDS, specialDef } from '../../engine/cards';
import { TROOPS } from '../../engine/data';
import type { AreaKind, GameState, HeldCard, LineKind, Side } from '../../engine/types';
import { otherSide } from '../../engine/types';
import { isCavalry, isSkirmisher, liveLeaders, liveUnits, unitDims } from '../../engine/units';
import { Die } from '../LogPanel';
import { AREA_NAMES, LINE_NAMES, type Tool } from '../tools';
import type { IntentIn } from '../useGame';
import { troopLabel } from './caps';

interface P {
  state: GameState;
  me: Side;
  dispatch: (it: IntentIn) => boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
}

// ---------------------------------------------------------------------------
// Banner con l'istruzione corrente e il pulsante principale
// ---------------------------------------------------------------------------

export function Banner(p: P & { onAutoDeploy: () => void }) {
  const s = p.state;
  const me = p.me;
  const other = s.players[otherSide(me)].name;
  const a = s.activation;
  let title = '';
  let text = '';
  const buttons: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }[] = [];
  let waiting = false;

  switch (s.phase) {
    case 'terrain':
      if (s.terrainSide === me) {
        title = 'Prepara il campo di battaglia';
        text = 'Scegli un elemento a sinistra e trascinalo sul tavolo, oppure genera un terreno casuale.';
        buttons.push({ label: 'Terreno casuale', onClick: () => p.dispatch({ t: 'randomTerrain' }) });
        buttons.push({ label: 'Terreno pronto ✓', primary: true, onClick: () => p.dispatch({ t: 'terrainDone' }) });
      } else {
        title = 'Terreno';
        text = `${other} sta preparando il terreno; poi sceglierai il lato.`;
        waiting = true;
      }
      break;
    case 'deploy': {
      const missing = liveUnits(s, me).filter((u) => u.unplaced).length + liveLeaders(s, me).filter((l) => l.unplaced).length;
      if (s.deployReady[me]) {
        title = 'Schieramento completato';
        text = s.deployReady[otherSide(me)] ? '' : `In attesa di ${other}…`;
        waiting = true;
        buttons.push({ label: 'Modifica', onClick: () => p.dispatch({ t: 'deployReady', ready: false }) });
      } else {
        title = 'Schiera il tuo esercito';
        text = missing ? `Scegli un'unità dal vassoio in basso e cliccala nella tua zona colorata. Trascina le unità già schierate per spostarle. (${missing} da schierare)` : 'Tutto schierato: puoi ancora trascinare le unità per sistemarle.';
        buttons.push({ label: 'Schieramento automatico', onClick: p.onAutoDeploy });
        buttons.push({ label: 'Pronto ✓', primary: true, disabled: missing > 0, onClick: () => p.dispatch({ t: 'deployReady', ready: true }) });
      }
      break;
    }
    case 'manoeuvre':
      title = 'Fase di Manovra';
      if (s.activeSide === me) {
        text = "Tocca a te: trascina un'unità o un comandante (un movimento gratuito). Tirare o attaccare dà inizio alla battaglia.";
        buttons.push({ label: 'Passa', onClick: () => p.dispatch({ t: 'manoeuvrePass' }) });
      } else {
        text = `Tocca a ${other}.`;
        waiting = true;
      }
      break;
    case 'battle':
      if (!a) {
        title = `Turno ${s.turn}`;
        const blocked = s.pending.length > 0 || s.meleeQueue.length > 0;
        text = s.playDeck.length <= 1 ? "Resta solo l'ultima carta, che non si gioca: il turno finisce." : 'Gira la prossima carta del Mazzo di Gioco.';
        buttons.push({ label: s.playDeck.length <= 1 ? 'Fine del turno' : '🂠 Gira la carta', primary: true, disabled: blocked, onClick: () => p.dispatch({ t: 'drawCard' }) });
      } else if (a.side === me) {
        if (a.kind === 'leader') {
          const l = s.leaders[a.leaderId!];
          title = `${l.name}: ${a.tokensLeft} ${a.tokensLeft === 1 ? 'ordine' : 'ordini'}`;
          text = "Le unità evidenziate nel cerchio possono agire: trascinale per muoverle o cliccale. L'ordine viene dato da solo.";
        } else if (a.kind === 'skirmish') {
          title = 'Schermagliatori e Artiglieria';
          text = "Le tue unità evidenziate agiscono d'iniziativa con due azioni ciascuna.";
        } else {
          title = 'Azione gratuita';
          text = "L'unità evidenziata può compiere un'azione.";
        }
        buttons.push({ label: 'Termina attivazione', primary: true, disabled: s.pending.length > 0, onClick: () => p.dispatch({ t: 'endActivation' }) });
      } else {
        title = `Gioca ${other}`;
        text = a.kind === 'leader' ? `Carta di ${s.leaders[a.leaderId!]?.name}.` : a.kind === 'skirmish' ? 'Schermagliatori e Artiglieria.' : 'Azione gratuita.';
        waiting = true;
      }
      break;
    case 'endTurn':
      title = `Fine del turno ${s.turn}`;
      if (!s.endTurn?.freeDone[me]) {
        text = 'Le unità evidenziate (non attivate) possono togliere un Disordine o, se Arcieri, tirare una volta gratis.';
        buttons.push({ label: 'Togli tutti i Disordini', onClick: () => p.dispatch({ t: 'freeAutoRally' }) });
        buttons.push({ label: 'Ho finito ✓', primary: true, onClick: () => p.dispatch({ t: 'endTurnDone' }) });
      } else {
        text = `In attesa di ${other}; poi i Test del Morale di fine turno.`;
        waiting = true;
      }
      break;
    case 'gameOver':
      title = `Vittoria di ${s.players[s.winner!].name}!`;
      text = s.winReason ?? '';
      break;
  }
  const card = s.phase === 'battle' ? s.currentCard : undefined;
  return (
    <div className={`banner-hud ${waiting ? 'waiting' : ''} ${s.phase === 'gameOver' ? 'over' : ''}`}>
      {s.phase === 'battle' && <MiniCard s={s} />}
      <div className="bh-text">
        <div className="bh-title">{title}</div>
        {text && <div className="bh-sub">{text}</div>}
      </div>
      {buttons.length > 0 && (
        <div className="bh-buttons">
          {buttons.map((b) => (
            <button key={b.label} className={b.primary ? 'primary' : ''} disabled={b.disabled} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {card === undefined && null}
    </div>
  );
}

function MiniCard({ s }: { s: GameState }) {
  const c = s.currentCard;
  let kind = 'Mazzo';
  let name = `${s.playDeck.length} carte`;
  if (c?.kind === 'leader') {
    kind = 'Comandante';
    name = s.leaders[c.leaderId!]?.name ?? '';
  } else if (c?.kind === 'skirmish') {
    kind = 'Schermaglia';
    name = s.players[c.side!].name;
  } else if (c?.kind === 'bonus') {
    kind = 'Bonus';
    name = 'Mischie e spareggio';
  }
  const side = c?.side ?? (c?.leaderId ? s.leaders[c.leaderId]?.side : undefined);
  return (
    <div className={`mini-card ${c ? 'face kind-' + c.kind : 'back'} ${side ? 'side-' + side : ''}`} title={`Carte rimaste nel mazzo: ${s.playDeck.length}`}>
      <div className="mc-kind">{kind}</div>
      <div className="mc-name">{name}</div>
      <div className="mc-count">{s.playDeck.length} nel mazzo</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Morale d'Armata
// ---------------------------------------------------------------------------

export function MoraleHud({ state: s, me }: { state: GameState; me: Side }) {
  if (s.phase === 'setup' || s.phase === 'terrain' || s.phase === 'deploy') return null;
  const order: Side[] = [me, otherSide(me)];
  return (
    <div className="morale-hud" title="Gettoni Morale d'Armata: quando un esercito deve cederne uno e non ne ha più, perde">
      {order.map((sd) => (
        <div key={sd} className={`mh-row side-${sd}`}>
          <span className="mh-name">{sd === me ? 'Tu' : s.players[sd].name}</span>
          <span className="mh-pips">
            {Array.from({ length: s.armyMoraleStart[sd] }, (_, i) => (
              <span key={i} className={`pip ${i < s.armyMorale[sd] ? 'on' : ''}`} />
            ))}
          </span>
          <span className="mh-num">{s.armyMorale[sd]}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ultimi eventi
// ---------------------------------------------------------------------------

export function EventFeed({ state: s, onOpenLog }: { state: GameState; onOpenLog: () => void }) {
  const recent = s.log.slice(-3);
  if (!recent.length) return null;
  return (
    <div className="event-feed" onClick={onOpenLog} title="Apri il registro completo">
      {recent.map((e, i) => (
        <div key={e.id} className={`ef-item ${e.kind ?? ''} ${e.side ? 'side-' + e.side : ''}`} style={{ opacity: 0.45 + (i / recent.length) * 0.55 }}>
          <span className="ef-text">{e.text}</span>
          {e.rolls && e.rolls.length > 0 && i >= recent.length - 2 && (
            <span className="ef-dice">
              {e.rolls.slice(0, 2).flatMap((r, ri) =>
                r.dice.slice(0, 14).map((d, di) => <Die key={`${ri}-${di}`} v={d} side={r.side} />),
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carte in mano
// ---------------------------------------------------------------------------

export function HandHud(p: P) {
  const s = p.state;
  const [open, setOpen] = useState<string | null>(null);
  if (s.phase !== 'battle' && s.phase !== 'endTurn') return null;
  const hand = s.hands[p.me];
  const opp = s.hands[otherSide(p.me)].length;
  if (!hand.length && !opp) return null;
  return (
    <div className="hand-hud" onPointerDown={(e) => e.stopPropagation()}>
      {opp > 0 && (
        <div className="opp-cards" title="Carte in mano all'avversario">
          {Array.from({ length: opp }, (_, i) => (
            <span key={i} className="card-back-sm" />
          ))}
        </div>
      )}
      {hand.map((h) => (
        <HandCardView key={h.id} {...p} h={h} open={open === h.id} toggle={() => setOpen(open === h.id ? null : h.id)} />
      ))}
    </div>
  );
}

function HandCardView(p: P & { h: HeldCard; open: boolean; toggle: () => void }) {
  const { h } = p;
  const isBonus = h.kind === 'bonus';
  const def = isBonus ? BONUS_CARDS[h.bonusKind!] : specialDef(h.specialKey!);
  const name = def.name;
  const text = def.text;
  const play = () => {
    p.toggle();
    if (isBonus) {
      if (h.bonusKind === 'perk') p.setTool({ k: 'pickUnit', purpose: 'perk', handId: h.id });
      if (h.bonusKind === 'forfeit') p.setTool({ k: 'pickUnit', purpose: 'forfeit', handId: h.id, enemy: true });
      if (h.bonusKind === 'dummy') p.dispatch({ t: 'playCard', handId: h.id });
      return;
    }
    const key = h.specialKey!;
    if (key === 'rumour') p.setTool({ k: 'pickLeader', purpose: 'rumour', handId: h.id });
    else if (key === 'ambush') p.setTool({ k: 'pickUnit', purpose: 'ambush', handId: h.id });
    else p.dispatch({ t: 'playCard', handId: h.id });
  };
  let action: string | null = 'Gioca';
  if (isBonus && h.bonusKind === 'reroll') action = null;
  if (isBonus && h.bonusKind === 'dummy') action = 'Scarta';
  if (!isBonus && h.specialKey === 'counterfeit') action = null;
  if (isBonus && h.bonusKind === 'perk') action = "Gioca: scegli un'unità tua";
  if (isBonus && h.bonusKind === 'forfeit') action = "Gioca: scegli un'unità nemica con un Ordine";
  return (
    <div className={`hand-card2 ${isBonus ? 'bonus' : 'special'} ${p.open ? 'open' : ''}`}>
      <button className="hc2-face" onClick={p.toggle}>
        <span className="hc2-kind">{isBonus ? 'Bonus' : 'Evento'}</span>
        <span className="hc2-name">{name}</span>
      </button>
      {p.open && (
        <div className="hc2-body">
          <p>{text}</p>
          {action ? (
            <button className="primary" onClick={play}>
              {action}
            </button>
          ) : (
            <p className="muted small">{isBonus ? 'Si usa dal registro: pulsante "Ritira" accanto al tuo ultimo lancio.' : 'Si attiva da sola quando serve.'}</p>
          )}
          {isBonus && <p className="muted small">Scade a fine turno.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vassoio di schieramento
// ---------------------------------------------------------------------------

export function DeployTray(p: P) {
  const s = p.state;
  if (s.phase !== 'deploy' || s.deployReady[p.me]) return null;
  const units = liveUnits(s, p.me).filter((u) => u.unplaced);
  const leaders = liveLeaders(s, p.me).filter((l) => l.unplaced);
  const stakes = liveUnits(s, p.me)
    .flatMap((u) => u.companies)
    .filter((c) => c.stakes && !c.stakesPlanted).length;
  const facing = p.me === 'A' ? 0 : 180;
  if (!units.length && !leaders.length && !stakes && !s.defencesToPlace[p.me]) return null;
  return (
    <div className="tray" onPointerDown={(e) => e.stopPropagation()}>
      {units.map((u) => (
        <button key={u.id} className={`tray-item ${p.tool.k === 'place' && p.tool.unitId === u.id ? 'on' : ''}`} onClick={() => p.setTool({ k: 'place', unitId: u.id, facing })}>
          <b>{u.name}</b>
          <small>
            {troopLabel(u)} · {s.wards[u.wardId]?.name}
          </small>
        </button>
      ))}
      {leaders.map((l) => (
        <button key={l.id} className={`tray-item leader ${p.tool.k === 'placeLeader' && p.tool.leaderId === l.id ? 'on' : ''}`} onClick={() => p.setTool({ k: 'placeLeader', leaderId: l.id })}>
          <b>
            {l.isCinC ? '♛ ' : '★ '}
            {l.name}
          </b>
          <small>clicca un'unità per aggregarlo</small>
        </button>
      ))}
      {s.defencesToPlace[p.me] > 0 && (
        <button className="tray-item" onClick={() => p.setTool({ k: 'defence', kind: 'fieldDefence', points: [] })}>
          <b>Difese campali ×{s.defencesToPlace[p.me]}</b>
          <small>clic sui punti, doppio clic per finire</small>
        </button>
      )}
      {stakes > 0 && (
        <button className="tray-item" onClick={() => p.setTool({ k: 'defence', kind: 'stakes', points: [] })}>
          <b>Pali degli arcieri ×{stakes}</b>
          <small>clic sui punti, doppio clic per finire</small>
        </button>
      )}
    </div>
  );
}

/** Calcola uno schieramento ordinato: fanteria al centro per Schiere, cavalleria e schermagliatori ai lati. */
export function autoDeployIntents(s: GameState, side: Side): IntentIn[] {
  const W = s.table.width;
  const H = s.table.height;
  const facing = side === 'A' ? 0 : 180;
  const rowY = (row: number) => (side === 'A' ? H - 3 - row * 3.6 : 3 + row * 3.6);
  const units = liveUnits(s, side).filter((u) => u.unplaced);
  const wardOrder = Object.keys(s.wards).filter((w) => s.wards[w].side === side);
  const inf = units.filter((u) => !isCavalry(u) && !isSkirmisher(u)).sort((a, b) => wardOrder.indexOf(a.wardId) - wardOrder.indexOf(b.wardId));
  const flank = units.filter((u) => isCavalry(u) || isSkirmisher(u));
  const out: IntentIn[] = [];
  // Fanteria: righe centrate tra x=10 e W-10.
  const placed = liveUnits(s, side).filter((u) => !u.unplaced);
  let row = 0;
  let lineUnits: typeof inf = [];
  const flush = () => {
    const widths = lineUnits.map((u) => unitDims(u).w);
    const total = widths.reduce((a, b) => a + b, 0) + (lineUnits.length - 1) * 1.5;
    let x = W / 2 - total / 2;
    lineUnits.forEach((u, i) => {
      out.push({ t: 'place', unitId: u.id, x: x + widths[i] / 2, y: rowY(row), facing });
      x += widths[i] + 1.5;
    });
    row++;
    lineUnits = [];
  };
  let acc = 0;
  for (const u of inf) {
    const w = unitDims(u).w + 1.5;
    if (acc + w > W - 22 && lineUnits.length) {
      flush();
      acc = 0;
    }
    lineUnits.push(u);
    acc += w;
  }
  if (lineUnits.length) flush();
  // Ali: alternando sinistra e destra, una riga per unità.
  const rows = { left: 0, right: 0 };
  flank.forEach((u, i) => {
    const d = unitDims(u);
    const left = i % 2 === 0;
    const r = left ? rows.left++ : rows.right++;
    out.push({ t: 'place', unitId: u.id, x: left ? 1.2 + d.w / 2 : W - 1.2 - d.w / 2, y: rowY(r), facing });
  });
  // Comandanti: con la prima unità della propria Schiera.
  for (const l of liveLeaders(s, side).filter((x) => x.unplaced)) {
    const u = [...placed, ...units].find((x) => x.wardId === l.wardId) ?? [...placed, ...units][0];
    if (u) out.push({ t: 'placeLeader', leaderId: l.id, x: u.x, y: u.y, attachTo: u.id });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Strumenti del terreno
// ---------------------------------------------------------------------------

export function TerrainTools(p: P) {
  const s = p.state;
  if (s.phase !== 'terrain' || s.terrainSide !== p.me) return null;
  const areas: AreaKind[] = ['wood', 'hill', 'steepHill', 'marsh', 'builtUp', 'building'];
  const lines: LineKind[] = ['hedge', 'wall', 'stream', 'fence'];
  const icon: Record<string, string> = { wood: '🌲', hill: '⛰', steepHill: '🏔', marsh: '〰', builtUp: '🏘', building: '🏠', hedge: '🌿', wall: '🧱', stream: '💧', fence: '┼' };
  return (
    <div className="terrain-tools" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tt-group">Aree · trascina</div>
      {areas.map((k) => (
        <button key={k} className={p.tool.k === 'area' && p.tool.kind === k ? 'on' : ''} onClick={() => p.setTool(p.tool.k === 'area' && p.tool.kind === k ? { k: 'none' } : { k: 'area', kind: k })}>
          <span>{icon[k]}</span> {AREA_NAMES[k]}
        </button>
      ))}
      <div className="tt-group">Linee · clic sui punti</div>
      {lines.map((k) => (
        <button key={k} className={p.tool.k === 'line' && p.tool.kind === k ? 'on' : ''} onClick={() => p.setTool(p.tool.k === 'line' && p.tool.kind === k ? { k: 'none' } : { k: 'line', kind: k, points: [] })}>
          <span>{icon[k]}</span> {LINE_NAMES[k]}
        </button>
      ))}
      {p.tool.k === 'line' && p.tool.points.length >= 2 && (
        <button
          className="primary"
          onClick={() => {
            if (p.tool.k !== 'line') return;
            p.dispatch({ t: 'addLine', feature: { kind: p.tool.kind, points: p.tool.points } });
            p.setTool({ ...p.tool, points: [] });
          }}
        >
          Fine linea
        </button>
      )}
      <div className="tt-group">Modifica</div>
      <button className={p.tool.k === 'pickFeature' ? 'on' : ''} onClick={() => p.setTool(p.tool.k === 'pickFeature' ? { k: 'none' } : { k: 'pickFeature', purpose: 'delete' })}>
        <span>🗑</span> Cancella
      </button>
      <button onClick={() => confirm('Cancellare tutto il terreno?') && p.dispatch({ t: 'clearTerrain' })}>
        <span>✕</span> Svuota
      </button>
    </div>
  );
}

/** Suggerimento per lo strumento attivo (selezioni di carte, ecc.). */
export function ToolHint({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  let text = '';
  if (tool.k === 'pickUnit') {
    text =
      tool.purpose === 'perk'
        ? "Vantaggio: clicca un'unità tua non impegnata"
        : tool.purpose === 'forfeit'
          ? "Penalità: clicca un'unità nemica che ha ricevuto un Ordine"
          : tool.purpose === 'ambush'
            ? "Imboscata: clicca l'unità che attaccherà di sorpresa"
            : "Clicca l'altra compagnia con cui formare la formazione";
  }
  if (tool.k === 'pickLeader') text = 'Clicca il comandante nemico in mischia';
  if (tool.k === 'pickFeature') text = tool.purpose === 'delete' ? "Clicca l'elemento di terreno da cancellare" : 'Clicca la siepe da aprire';
  if (tool.k === 'measure') text = 'Righello: trascina sul tavolo per misurare';
  if (tool.k === 'manualMove') text = 'Spostamento libero: trascina unità o comandanti (Q/E ruota)';
  if (tool.k === 'line') text = `${LINE_NAMES[tool.kind]}: clicca i punti, doppio clic o Invio per finire`;
  if (tool.k === 'area') text = `${AREA_NAMES[tool.kind]}: trascina sul tavolo per disegnarlo`;
  if (tool.k === 'defence') text = 'Clicca i punti (circa 5"), doppio clic per finire';
  if (tool.k === 'place') text = 'Clicca nella tua zona per schierare · Q/E ruota';
  if (tool.k === 'placeLeader') text = "Clicca un'unità per aggregare il comandante, o un punto della tua zona";
  if (!text) return null;
  return (
    <div className="tool-hint" onPointerDown={(e) => e.stopPropagation()}>
      {text}
      <button className="small" onClick={() => setTool({ k: 'none' })}>
        Annulla (Esc)
      </button>
    </div>
  );
}

export function troopName(t: keyof typeof TROOPS) {
  return TROOPS[t].name;
}

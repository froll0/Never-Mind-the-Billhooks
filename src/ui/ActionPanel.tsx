import { useState } from 'react';
import { BONUS_CARDS, specialDef } from '../engine/cards';
import { CLASS_NAME, COMMAND_RANGE, TROOPS } from '../engine/data';
import { closestPointOnPolygon, dist } from '../engine/geometry';
import { canCompanyShoot } from '../engine/shooting';
import { eligibleForFreeAction } from '../engine/turn';
import type { GameState, HeldCard, Leader, Side, Unit } from '../engine/types';
import { otherSide } from '../engine/types';
import { isArtillery, isCavalry, isLoose, isSkirmisher, leaderOf, liveUnits, unitPoly } from '../engine/units';
import type { Selection, Tool } from './tools';
import type { IntentIn } from './useGame';

interface Props {
  state: GameState;
  me: Side;
  selection: Selection;
  setSelection: (s: Selection) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  dispatch: (it: IntentIn) => boolean;
}

export function ActionPanel(p: Props) {
  const s = p.state;
  const me = p.me;
  const a = s.activation;
  const myTurnManoeuvre = s.phase === 'manoeuvre' && s.activeSide === me;
  const selUnit = p.selection?.kind === 'unit' ? s.units[p.selection.id] : undefined;
  const selLeader = p.selection?.kind === 'leader' ? s.leaders[p.selection.id] : undefined;

  return (
    <div className="panel">
      <PhaseHeader {...p} />
      {s.phase === 'manoeuvre' && (
        <div className="box">
          <p>
            {myTurnManoeuvre ? (
              <b>Tocca a te: muovi un'unità o un comandante (azione gratuita), oppure tira/attacca per iniziare la battaglia.</b>
            ) : (
              <>In attesa di {s.players[s.activeSide].name}…</>
            )}
          </p>
          {myTurnManoeuvre && (
            <button onClick={() => p.dispatch({ t: 'manoeuvrePass' })}>Passa (se passano entrambi inizia la battaglia)</button>
          )}
        </div>
      )}
      {s.phase === 'battle' && <BattleControls {...p} />}
      {s.phase === 'endTurn' && <EndTurnControls {...p} />}
      {selUnit && !selUnit.removed && <UnitControls {...p} u={selUnit} />}
      {selLeader && !selLeader.killed && <LeaderControls {...p} l={selLeader} />}
      {s.phase !== 'setup' && s.phase !== 'terrain' && s.phase !== 'deploy' && <Hand {...p} />}
      {a && a.side === me && a.kind === 'leader' && <ActivationUnits {...p} />}
    </div>
  );
}

function PhaseHeader({ state: s }: Props) {
  const card = s.currentCard;
  let cardText = '';
  if (card?.kind === 'leader') cardText = `Comandante: ${s.leaders[card.leaderId!]?.name}`;
  if (card?.kind === 'skirmish') cardText = `Schermagliatori e Artiglieria (${s.players[card.side!].name})`;
  if (card?.kind === 'bonus') cardText = 'Bonus';
  return (
    <div className="phase-header">
      {s.phase === 'battle' && (
        <div className="deck-row">
          <div className={`card-face ${card ? 'card-' + card.kind : 'card-back'} ${card?.side ? 'side-' + card.side : ''}`}>
            <div className="card-kind">{card ? (card.kind === 'leader' ? 'Comandante' : card.kind === 'skirmish' ? 'Schermaglia' : 'Bonus') : 'Mazzo'}</div>
            <div className="card-name">{card ? cardText : `${s.playDeck.length} carte`}</div>
          </div>
          <div className="muted small">
            Carte nel mazzo: {s.playDeck.length} (l'ultima non si gioca)
            <br />
            Carte Bonus uscite in questo turno: {s.bonusDrawnThisTurn}
          </div>
        </div>
      )}
    </div>
  );
}

function BattleControls(p: Props) {
  const s = p.state;
  const a = s.activation;
  const canDraw = !a && !s.pending.length && !s.meleeQueue.length;
  return (
    <div className="box">
      {a ? (
        a.side === p.me ? (
          <>
            <p>
              <b>
                {a.kind === 'leader'
                  ? `Attivazione di ${s.leaders[a.leaderId!]?.name}: ${a.tokensLeft} Segnalini Ordine rimasti.`
                  : a.kind === 'skirmish'
                    ? 'Schermagliatori e Artiglieria agiscono d\'iniziativa (2 azioni ciascuno).'
                    : 'Azione gratuita (carta Vantaggio).'}
              </b>
            </p>
            {a.kind === 'leader' && <p className="muted small">Seleziona un'unità entro 6" (o a cui è aggregato) per darle un Ordine; seleziona il comandante per muoverlo, montare/smontare o riordinare.</p>}
            <button className="primary" onClick={() => p.dispatch({ t: 'endActivation' })}>
              Termina attivazione
            </button>
          </>
        ) : (
          <p>
            In attesa di <b>{s.players[a.side].name}</b>
            {a.kind === 'leader' ? ` (attivazione di ${s.leaders[a.leaderId!]?.name})` : ''}…
          </p>
        )
      ) : (
        <button className="primary big" disabled={!canDraw} onClick={() => p.dispatch({ t: 'drawCard' })}>
          {s.playDeck.length <= 1 ? 'Fine del turno' : 'Gira la prossima carta'}
        </button>
      )}
    </div>
  );
}

function EndTurnControls(p: Props) {
  const s = p.state;
  const done = s.endTurn?.freeDone[p.me];
  const elig = liveUnits(s, p.me).filter((u) => eligibleForFreeAction(u));
  return (
    <div className="box">
      <h3>Fine del turno {s.turn}</h3>
      <p className="small">Le unità non attivate e non Scosse (esclusi Schermagliatori e Artiglieria) possono togliere un Disordine oppure, se Arcieri, tirare una volta.</p>
      {!done && (
        <>
          <ul className="plain">
            {elig.map((u) => (
              <li key={u.id}>
                {u.name}
                {u.disarray > 0 && (
                  <button className="small" onClick={() => p.dispatch({ t: 'freeAction', unitId: u.id, kind: 'rally' })}>
                    Togli Disordine
                  </button>
                )}
                {u.companies[0].type === 'archers' && canCompanyShoot(u.companies[0]) && (
                  <button className="small" onClick={() => p.setTool({ k: 'shoot', unitId: u.id, free: true })}>
                    Tira
                  </button>
                )}
              </li>
            ))}
            {!elig.length && <li className="muted">Nessuna unità idonea.</li>}
          </ul>
          <div className="row">
            <button onClick={() => p.dispatch({ t: 'freeAutoRally' })}>Tutte: togli un Disordine</button>
            <button className="primary" onClick={() => p.dispatch({ t: 'endTurnDone' })}>
              Ho finito
            </button>
          </div>
        </>
      )}
      {done && <p>In attesa dell'avversario… Poi si fanno i Test di Crisi del Morale di fine turno.</p>}
    </div>
  );
}

function ActivationUnits(p: Props) {
  const s = p.state;
  const a = s.activation!;
  if (!a.units.length) return null;
  return (
    <div className="box">
      <h4>Unità ordinate</h4>
      <ul className="plain">
        {a.units.map((id) => {
          const u = s.units[id];
          if (!u || u.removed) return null;
          return (
            <li key={id}>
              <a href="#" onClick={(e) => (e.preventDefault(), p.setSelection({ kind: 'unit', id }))}>
                {u.name}
              </a>{' '}
              <span className="muted">— azioni rimaste: {u.actionsLeft}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UnitControls(p: Props & { u: Unit }) {
  const { state: s, u, me } = p;
  const [angle, setAngle] = useState(45);
  const mine = u.side === me;
  const a = s.activation;
  const inManoeuvre = s.phase === 'manoeuvre' && s.activeSide === me && mine;
  const activated = s.phase === 'battle' && a?.side === me && a.units.includes(u.id);
  const canAct = (inManoeuvre || (activated && u.actionsLeft > 0)) && !u.meleeId;
  const leader = a?.kind === 'leader' && a.side === me ? s.leaders[a.leaderId!] : undefined;
  let orderReason = '';
  if (leader && mine && !u.ordered && !u.meleeId) {
    if (u.initiative) orderReason = "ha già agito d'iniziativa";
    else if (u.wardId !== leader.wardId && !leader.isCinC) orderReason = 'è di un\'altra Schiera';
    else {
      const d = leader.attachedTo === u.id ? 0 : dist(leader, closestPointOnPolygon(leader, unitPoly(u)));
      if (d > COMMAND_RANGE + 0.05) orderReason = `fuori raggio (${d.toFixed(1)}")`;
    }
  }
  const c0 = u.companies[0];
  const canShoot = (isArtillery(u) ? u.gunDeployed && !u.gunDestroyed : u.companies.some(canCompanyShoot)) && !u.daunted;
  const attacker = !isArtillery(u) && (!isSkirmisher(u) || c0.type === 'kern') && !u.daunted;
  const l = leaderOf(s, u);
  return (
    <div className="box">
      <h3>
        {u.name} <span className={`chip side-${u.side}`}>{s.players[u.side].name}</span>
      </h3>
      <div className="small">
        {u.companies.map((c, i) => (
          <div key={i}>
            {c.dismountedKnights ? "Cavalieri appiedati (Uomini d'Arme)" : c.dismountedLH ? 'Cavalleggeri appiedati' : TROOPS[c.type].name} ({c.quality === 'levy' ? 'Leva' : c.quality === 'veteran' ? 'Veterani' : 'Seguito'}) — {c.figures}/{c.maxFigures} figure, {c.kills} perdite
            {c.arrows !== undefined ? `, frecce ${c.arrows}/6` : ''}
          </div>
        ))}
        <div className="muted">
          {u.disarray ? `Disordine ×${u.disarray}. ` : ''}
          {u.daunted ? 'SCOSSA. ' : ''}
          {u.meleeId ? 'In mischia. ' : ''}
          {l ? `Con ${l.name}. ` : ''}
          {isCavalry(u) && c0.type === 'knights' ? `Cariche usate: ${u.chargesUsed}/2. ` : ''}
          {mine && s.phase === 'battle' ? `Azioni rimaste: ${u.actionsLeft}.` : ''}
        </div>
      </div>
      {mine && leader && !u.ordered && !u.meleeId && (
        <button className="primary" disabled={!!orderReason || a!.tokensLeft <= 0} title={orderReason} onClick={() => p.dispatch({ t: 'order', leaderId: leader.id, unitId: u.id })}>
          Dai un Ordine ({leader.name}){orderReason ? ` — ${orderReason}` : ''}
        </button>
      )}
      {canAct && (
        <div className="actions">
          <button onClick={() => p.setTool({ k: 'move', unitId: u.id })}>Muovi</button>
          {!isLoose(u) && !isArtillery(u) && !u.daunted && (
            <span className="wheel">
              <button onClick={() => p.dispatch({ t: 'wheel', unitId: u.id, angle: -angle })} title="Perno a sinistra">
                ↺ Converge
              </button>
              <input type="number" min={5} max={180} step={5} value={angle} onChange={(e) => setAngle(+e.target.value)} className="tiny" />°
              <button onClick={() => p.dispatch({ t: 'wheel', unitId: u.id, angle })} title="Perno a destra">
                Converge ↻
              </button>
            </span>
          )}
          {!isArtillery(u) && <button onClick={() => p.dispatch({ t: 'aboutFace', unitId: u.id })}>Dietro-front</button>}
          {isArtillery(u) && c0.type !== 'heavyGun' && (
            <>
              <button onClick={() => p.dispatch({ t: 'pivot', unitId: u.id, angle: -angle })}>↺ Ruota</button>
              <input type="number" min={5} max={45} step={5} value={Math.min(45, angle)} onChange={(e) => setAngle(+e.target.value)} className="tiny" />
              <button onClick={() => p.dispatch({ t: 'pivot', unitId: u.id, angle: Math.min(45, angle) })}>Ruota ↻</button>
              <button onClick={() => p.dispatch({ t: 'packUp', unitId: u.id })}>{u.gunDeployed ? 'Aggancia (2 azioni)' : 'Schiera il pezzo (2 azioni)'}</button>
            </>
          )}
          {canShoot && <button onClick={() => p.setTool({ k: 'shoot', unitId: u.id })}>Tira</button>}
          {attacker && (
            <>
              <button onClick={() => p.setTool({ k: 'attack', unitId: u.id, charge: false })}>Attacca</button>
              {isCavalry(u) && (c0.type !== 'knights' || u.chargesUsed < 2) && !c0.dismountedKnights && (
                <button onClick={() => p.setTool({ k: 'attack', unitId: u.id, charge: true })}>Carica! (+4")</button>
              )}
            </>
          )}
          {s.phase === 'battle' && l && (u.disarray > 0 || u.daunted) && (
            <>
              {u.disarray > 0 && <button onClick={() => p.dispatch({ t: 'rally', unitId: u.id, what: 'disarray' })}>Riordina (Disordine)</button>}
              {u.daunted && (
                <button onClick={() => p.dispatch({ t: 'rally', unitId: u.id, what: 'daunted' })}>
                  Riordina (Scossa {u.rallyCount ?? 0}/2)
                </button>
              )}
            </>
          )}
          {s.phase === 'battle' && !u.daunted && <SpecialMenu {...p} u={u} />}
        </div>
      )}
      {mine && s.terrain.areas.some((ar) => ar.kind === 'wood') && (
        <button className="small" onClick={() => p.dispatch({ t: 'toggleWoodEdge', unitId: u.id })}>
          {u.woodEdge ? 'Nel bosco (non al margine)' : 'Schierata al margine del bosco'}
        </button>
      )}
      {(p.tool.k === 'move' || p.tool.k === 'shoot' || p.tool.k === 'attack') && (
        <div className="hint">
          {p.tool.k === 'move' && 'Clicca sul tavolo per la destinazione. ' + (isLoose(u) ? 'Q/E per ruotare.' : 'Il movimento è rettilineo; uscire dall\'arco frontale di 45° causa Disordine.')}
          {p.tool.k === 'shoot' && 'Clicca su un bersaglio evidenziato (verde = consentito).'}
          {p.tool.k === 'attack' && "Clicca sull'unità nemica da attaccare (verde = raggiungibile)."}
          <button className="small" onClick={() => p.setTool({ k: 'none' })}>
            Annulla
          </button>
        </div>
      )}
    </div>
  );
}

function SpecialMenu(p: Props & { u: Unit }) {
  const { u } = p;
  const c = u.companies[0];
  const opts: { v: string; label: string }[] = [];
  if (u.formation === 'hedgehog') opts.push({ v: 'reformBlock', label: 'Riforma il blocco (1 azione)' });
  if (u.companies.length === 2 && u.formation !== 'hedgehog') opts.push({ v: 'split', label: 'Dividi la formazione' });
  if (u.companies.length === 1 && TROOPS[c.type].arm === 'infantry') {
    opts.push({ v: 'join', label: 'Forma una Linea con…' });
    opts.push({ v: 'formBlock', label: 'Forma un Blocco con…' });
  }
  if (u.companies.some((x) => x.stakes && !x.stakesPlanted)) opts.push({ v: 'stakes', label: 'Pianta i pali' });
  if (c.type === 'knights' && !c.dismountedKnights) opts.push({ v: 'dismountKnights', label: 'Smonta (combatte a piedi)' });
  if (c.type === 'lightHorse' && c.mountedShooters && !c.dismountedLH) opts.push({ v: 'dismountLH', label: 'Smonta e schermaglia' });
  if (c.dismountedLH) opts.push({ v: 'remountLH', label: 'Rimonta a cavallo' });
  if (u.companies.some((x) => x.type === 'billmen')) opts.push({ v: 'chopHedge', label: 'Apri un varco nella siepe' });
  if (!opts.length) return null;
  return (
    <select
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'join' || v === 'formBlock') p.setTool({ k: 'pickUnit', purpose: v, unitId: u.id });
        else if (v === 'chopHedge') p.setTool({ k: 'pickFeature', purpose: 'chopHedge', unitId: u.id });
        else if (v) p.dispatch({ t: 'special', unitId: u.id, kind: v as any });
      }}
    >
      <option value="">Azione speciale…</option>
      {opts.map((o) => (
        <option key={o.v} value={o.v}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function LeaderControls(p: Props & { l: Leader }) {
  const { state: s, l, me } = p;
  const mine = l.side === me;
  const a = s.activation;
  const active = s.phase === 'battle' && a?.kind === 'leader' && a.leaderId === l.id && a.side === me;
  const manoeuvre = s.phase === 'manoeuvre' && s.activeSide === me && mine;
  const att = l.attachedTo ? s.units[l.attachedTo] : undefined;
  return (
    <div className="box">
      <h3>
        {l.isCinC ? '♛ ' : ''}
        {l.name} <span className="muted">({l.rank})</span>
      </h3>
      <div className="small">
        {CLASS_NAME[l.cls]} · {l.mounted ? 'a cavallo (12")' : 'a piedi (8")'} · {s.wards[l.wardId]?.name ?? ''}
        {att ? ` · aggregato a ${att.name}` : ' · isolato'}
        {l.needsRemount ? ' · disarcionato: serve una cavalcatura' : ''}
        {l.stunned ? ' · stordito' : ''}
      </div>
      {(active || manoeuvre) && (
        <div className="actions">
          <button onClick={() => p.setTool({ k: 'leaderMove', leaderId: l.id })}>Muovi (clic su un'unità per aggregarsi)</button>
          {active && (!l.mountSwapUsed || l.needsRemount) && <button onClick={() => p.dispatch({ t: 'mount', leaderId: l.id })}>{l.mounted ? 'Smonta' : 'Monta a cavallo'}</button>}
          {active && att && (att.disarray > 0 || att.daunted) && (
            <button onClick={() => p.dispatch({ t: 'leaderRally', leaderId: l.id, what: att.daunted ? 'daunted' : 'disarray' })}>Riordina {att.name}</button>
          )}
        </div>
      )}
      {p.tool.k === 'leaderMove' && (
        <div className="hint">
          Clicca sul tavolo per muovere il comandante, o su un'unità amica per aggregarlo. <button className="small" onClick={() => p.setTool({ k: 'none' })}>Annulla</button>
        </div>
      )}
    </div>
  );
}

function Hand(p: Props) {
  const s = p.state;
  const hand = s.hands[p.me];
  const opp = s.hands[otherSide(p.me)].length;
  return (
    <div className="box">
      <h4>Le tue carte</h4>
      {!hand.length && <p className="muted small">Nessuna carta in mano.</p>}
      {hand.map((h) => (
        <HandCard key={h.id} {...p} h={h} />
      ))}
      <p className="muted small">L'avversario ha {opp} carta/e in mano.</p>
    </div>
  );
}

function HandCard(p: Props & { h: HeldCard }) {
  const { h } = p;
  if (h.kind === 'bonus') {
    const def = BONUS_CARDS[h.bonusKind!];
    return (
      <div className="hand-card bonus">
        <div className="hc-title">{def.name}</div>
        <div className="small">{def.text}</div>
        <div className="row">
          {h.bonusKind === 'perk' && <button onClick={() => p.setTool({ k: 'pickUnit', purpose: 'perk', handId: h.id })}>Gioca: scegli un'unità</button>}
          {h.bonusKind === 'forfeit' && <button onClick={() => p.setTool({ k: 'pickUnit', purpose: 'forfeit', handId: h.id, enemy: true })}>Gioca su un'unità nemica</button>}
          {h.bonusKind === 'reroll' && <span className="muted small">Usala dal registro, accanto al tuo ultimo lancio.</span>}
          {h.bonusKind === 'dummy' && <button onClick={() => p.dispatch({ t: 'playCard', handId: h.id })}>Scarta</button>}
        </div>
        <div className="muted tiny-text">Scade a fine turno</div>
      </div>
    );
  }
  const def = specialDef(h.specialKey!);
  return (
    <div className="hand-card special">
      <div className="hc-title">Evento: {def.name}</div>
      <div className="small">{def.text}</div>
      <div className="row">
        {def.key === 'rumour' && <button onClick={() => p.setTool({ k: 'pickLeader', purpose: 'rumour', handId: h.id })}>Gioca: scegli il comandante nemico</button>}
        {def.key === 'ambush' && <button onClick={() => p.setTool({ k: 'pickUnit', purpose: 'ambush', handId: h.id })}>Gioca: scegli l'unità in imboscata</button>}
        {def.manual && def.key !== 'ambush' && <button onClick={() => p.dispatch({ t: 'playCard', handId: h.id })}>Gioca (effetto manuale)</button>}
        {def.key === 'counterfeit' && <span className="muted small">Si attiva automaticamente.</span>}
      </div>
    </div>
  );
}

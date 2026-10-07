import { COMMAND_RANGE, TROOPS } from '../../engine/data';
import { closestPointOnPolygon, dist } from '../../engine/geometry';
import { checkAttack } from '../../engine/melee';
import { canCompanyShoot, validTargets } from '../../engine/shooting';
import { eligibleForFreeAction } from '../../engine/turn';
import type { GameState, Leader, Side, Unit } from '../../engine/types';
import { isArtillery, isCavalry, isLoose, isSkirmisher, leaderOf, unitPoly } from '../../engine/units';

/** Cosa può fare ora un'unità per il giocatore `me`. */
export interface UnitCaps {
  canAct: boolean;
  /** Serve dare un Ordine (lo fa l'interfaccia in automatico alla prima azione). */
  needsOrder?: string;
  /** Azione gratuita di fine turno. */
  free?: boolean;
  /** Perché non può agire. */
  reason?: string;
  actionsLeft: number;
  move: boolean;
  wheel: boolean;
  aboutFace: boolean;
  shoot: boolean;
  attack: boolean;
  charge: boolean;
  rally: boolean;
  pivot: boolean;
  packUp: boolean;
}

const NONE: UnitCaps = { canAct: false, actionsLeft: 0, move: false, wheel: false, aboutFace: false, shoot: false, attack: false, charge: false, rally: false, pivot: false, packUp: false };

export function orderBlock(s: GameState, l: Leader, u: Unit): string | null {
  if (u.ordered) return 'ha già ricevuto un Ordine in questo turno';
  if (u.initiative) return "ha già agito d'iniziativa";
  if (u.meleeId) return 'è impegnata in una mischia';
  if (l.attachedTo && s.units[l.attachedTo]?.meleeId) return `${l.name} sta combattendo in mischia e non può dare ordini`;
  if (u.wardId !== l.wardId && !l.isCinC) return `non appartiene alla Schiera di ${l.name}`;
  const d = l.attachedTo === u.id ? 0 : dist(l, closestPointOnPolygon(l, unitPoly(u)));
  if (d > COMMAND_RANGE + 0.05) return `è fuori dal raggio di comando di ${l.name} (${d.toFixed(1)}" > 6")`;
  return null;
}

export function unitCaps(s: GameState, me: Side, u: Unit): UnitCaps {
  if (u.side !== me || u.removed || u.unplaced) return { ...NONE, reason: u.side !== me ? 'Unità avversaria' : undefined };
  const c0 = u.companies[0];
  const base = (actionsLeft: number, free = false): UnitCaps => {
    const daunted = u.daunted;
    const art = isArtillery(u);
    const canShootNow = (art ? !!u.gunDeployed && !u.gunDestroyed : u.companies.some(canCompanyShoot)) && !daunted;
    const attacker = !art && (!isSkirmisher(u) || c0.type === 'kern') && !daunted && !c0.dismountedLH;
    return {
      canAct: true,
      actionsLeft,
      free,
      move: !free && !(art && u.gunDeployed) && u.formation !== 'hedgehog' && c0.type !== 'heavyGun',
      wheel: !free && !isLoose(u) && !art && !daunted && u.formation !== 'hedgehog',
      aboutFace: !free && !(art && u.gunDeployed),
      shoot: canShootNow && (!free || c0.type === 'archers'),
      attack: !free && attacker,
      charge: !free && attacker && isCavalry(u) && !c0.dismountedKnights && (c0.type !== 'knights' || u.chargesUsed < 2),
      rally: free ? u.disarray > 0 : !!leaderOf(s, u) && (u.disarray > 0 || u.daunted || !!u.rumourDisarray) && s.phase === 'battle',
      pivot: !free && art && c0.type !== 'heavyGun',
      packUp: !free && art && c0.type !== 'heavyGun',
    };
  };
  if (u.meleeId) return { ...NONE, reason: 'È impegnata in mischia' };
  if (s.pending.length) return { ...NONE, reason: 'Si attende una decisione' };
  if (s.phase === 'manoeuvre') {
    if (s.activeSide !== me) return { ...NONE, reason: "Tocca all'avversario" };
    return base(1);
  }
  if (s.phase === 'endTurn') {
    if (s.endTurn?.freeDone[me]) return { ...NONE, reason: 'Hai già concluso le azioni di fine turno' };
    if (!eligibleForFreeAction(u)) return { ...NONE, reason: 'Nessuna azione gratuita per questa unità' };
    return base(1, true);
  }
  if (s.phase !== 'battle') return NONE;
  const a = s.activation;
  if (!a) return { ...NONE, reason: 'Gira una carta' };
  if (a.side !== me) return { ...NONE, reason: "È il turno dell'avversario" };
  if (a.units.includes(u.id)) {
    if (u.actionsLeft <= 0) return { ...NONE, reason: 'Ha già usato tutte le azioni' };
    return base(u.actionsLeft);
  }
  if (a.kind === 'leader') {
    const l = s.leaders[a.leaderId!];
    if (a.tokensLeft <= 0) return { ...NONE, reason: 'Segnalini Ordine esauriti' };
    const why = orderBlock(s, l, u);
    if (why) return { ...NONE, reason: `${u.name} ${why}` };
    return { ...base(2), needsOrder: l.id };
  }
  return { ...NONE, reason: 'Non attivata da questa carta' };
}

export interface TargetOption {
  kind: 'shoot' | 'attack' | 'charge';
  ok: boolean;
  label: string;
  detail: string;
}

/** Opzioni contro un'unità nemica per l'unità selezionata. */
export function targetOptions(s: GameState, me: Side, u: Unit, t: Unit): TargetOption[] {
  const caps = unitCaps(s, me, u);
  const res: TargetOption[] = [];
  if (!caps.canAct) return res;
  const manoeuvre = s.phase === 'manoeuvre';
  if (caps.shoot) {
    const shotsMax = u.companies[0].type === 'archers' ? 2 : 1;
    const v = validTargets(s, u).find((x) => x.target.id === t.id);
    if (u.shotsThisTurn >= shotsMax) res.push({ kind: 'shoot', ok: false, label: 'Tira', detail: 'Ha già tirato il massimo in questo turno' });
    else if (!v) res.push({ kind: 'shoot', ok: false, label: 'Tira', detail: 'Fuori arco, fuori portata o non visibile' });
    else if (!v.allowed) res.push({ kind: 'shoot', ok: false, label: 'Tira', detail: v.why ?? '' });
    else {
      const arrows = u.companies.find((c) => c.type === 'archers')?.arrows;
      res.push({
        kind: 'shoot',
        ok: true,
        label: 'Tira',
        detail: `${v.check.range!.toFixed(1)}" · ${v.check.dice} dadi, colpisce con ${v.check.hitOn}+${arrows !== undefined ? ` · frecce ${arrows}` : ''}`,
      });
    }
  }
  if (caps.attack) {
    const a = checkAttack(s, u, t, { manoeuvre });
    const side = a.side === 'front' ? 'di fronte' : a.side === 'rear' ? 'alle spalle' : 'sul fianco';
    res.push({ kind: 'attack', ok: a.ok, label: 'Attacca', detail: a.ok ? `${a.distance!.toFixed(1)}" · ${side}` : a.reason ?? '' });
  }
  if (caps.charge) {
    const a = checkAttack(s, u, t, { manoeuvre, charge: true });
    res.push({
      kind: 'charge',
      ok: a.ok,
      label: 'Carica!',
      detail: a.ok ? `${a.distance!.toFixed(1)}"${a.chargeBonus ? ' · con bonus di carica' : ' · senza bonus (non dritta, in salita o terreno difficile)'}` : a.reason ?? '',
    });
  }
  return res;
}

export function troopLabel(u: Unit): string {
  return u.companies.map((c) => (c.dismountedKnights ? "Cavalieri appiedati" : c.dismountedLH ? 'Cavalleggeri appiedati' : TROOPS[c.type].name)).join(' + ');
}

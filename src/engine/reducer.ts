import { specialDef, BONUS_CARDS } from './cards';
import { COMMAND_RANGE, TROOPS } from './data';
import { Ctx, RuleError, fail } from './ctx';
import { closestPointOnPolygon, dist, ellipsePolygon, normAngle, pointInPolygon, polygonsOverlap } from './geometry';
import { answerDuel, answerFollowUp, answerPursue, answerReaction, attackLeader, checkAttack, performAttack, processMeleeQueue } from './melee';
import { claimArmyMorale, endGame, moraleTest, regainArmyMorale, splitFormation } from './morale';
import { leaderAllowance, planMove, planWheel } from './movement';
import { Dice } from './rng';
import { loadArmy, type ArmyDef } from './setup';
import { resolveShooting, validTargets } from './shooting';
import { beginEndTurn, buildSpecialDeck, computeArmyMorale, drawPlayCard, eligibleForFreeAction, maybeFinishEndTurn, startBattle } from './turn';
import type { AreaFeature, GameState, LineFeature, Side, Unit } from './types';
import { otherSide } from './types';
import {
  cinc,
  isArtillery,
  isCavalry,
  isLoose,
  isSkirmisher,
  leaderOf,
  liveLeaders,
  liveUnits,
  syncAttachedLeaders,
  unitPoly,
} from './units';

export type Intent = { side: Side; seed?: number } & (
  | { t: 'setPlayer'; name?: string; faction?: string; color?: string }
  | { t: 'setOptions'; options: Partial<GameState['options']> }
  | { t: 'setArmy'; army: ArmyDef }
  | { t: 'armyReady'; ready: boolean }
  | { t: 'addArea'; feature: Omit<AreaFeature, 'id'> }
  | { t: 'addLine'; feature: Omit<LineFeature, 'id'> }
  | { t: 'removeFeature'; id: string }
  | { t: 'moveFeature'; id: string; dx: number; dy: number }
  | { t: 'randomTerrain' }
  | { t: 'clearTerrain' }
  | { t: 'terrainDone' }
  | { t: 'place'; unitId: string; x: number; y: number; facing: number }
  | { t: 'unplace'; unitId: string }
  | { t: 'placeLeader'; leaderId: string; x: number; y: number; attachTo?: string }
  | { t: 'placeDefence'; points: { x: number; y: number }[]; kind: 'stakes' | 'fieldDefence' }
  | { t: 'deployReady'; ready: boolean }
  | { t: 'move'; unitId: string; x: number; y: number; facing?: number; charge?: boolean }
  | { t: 'wheel'; unitId: string; angle: number }
  | { t: 'aboutFace'; unitId: string }
  | { t: 'pivot'; unitId: string; angle: number }
  | { t: 'shoot'; unitId: string; targetId: string }
  | { t: 'attack'; unitId: string; targetId: string; charge?: boolean }
  | { t: 'attackLeader'; unitId: string; leaderId: string }
  | { t: 'rally'; unitId: string; what?: 'disarray' | 'daunted' }
  | { t: 'packUp'; unitId: string }
  | { t: 'special'; unitId: string; kind: 'split' | 'join' | 'stakes' | 'dismountKnights' | 'dismountLH' | 'remountLH' | 'formBlock' | 'chopHedge'; otherId?: string; featureId?: string }
  | { t: 'toggleWoodEdge'; unitId: string }
  | { t: 'order'; leaderId: string; unitId: string }
  | { t: 'leaderMove'; leaderId: string; x: number; y: number; attachTo?: string }
  | { t: 'mount'; leaderId: string }
  | { t: 'leaderRally'; leaderId: string; what?: 'disarray' | 'daunted' }
  | { t: 'endActivation' }
  | { t: 'drawCard' }
  | { t: 'manoeuvrePass' }
  | { t: 'answer'; pendingId: string; choice: string }
  | { t: 'playCard'; handId: string; unitId?: string; leaderId?: string }
  | { t: 'discardCard'; handId: string }
  | { t: 'freeAction'; unitId: string; kind: 'rally' | 'shoot'; targetId?: string }
  | { t: 'freeAutoRally' }
  | { t: 'endTurnDone' }
  | { t: 'manualUnit'; unitId: string; patch: Partial<Pick<Unit, 'x' | 'y' | 'facing' | 'disarray' | 'daunted' | 'name'>>; companies?: { figures?: number; kills?: number; arrows?: number }[] }
  | { t: 'manualLeader'; leaderId: string; patch: { x?: number; y?: number; cls?: number; mounted?: boolean; attachedTo?: string | null; killed?: boolean } }
  | { t: 'manualMorale'; target: Side; value: number }
  | { t: 'manualRemove'; unitId: string }
  | { t: 'note'; text: string }
  | { t: 'concede' }
);

export interface ApplyResult {
  state: GameState;
  error?: string;
}

/** Applica un'azione allo stato (copia) e restituisce il nuovo stato. Deterministico dato il seme. */
export function applyIntent(state: GameState, intent: Intent, overrides: Record<number, number> = {}): ApplyResult {
  const s: GameState = structuredClone(state);
  const seed = intent.seed ?? 1;
  s.lastIntentId++;
  const ctx = new Ctx(s, new Dice(seed, overrides), intent.side, s.lastIntentId);
  try {
    handle(ctx, intent);
    afterIntent(ctx);
    return { state: s };
  } catch (e) {
    if (e instanceof RuleError) return { state, error: e.message };
    console.error(e);
    return { state, error: 'Errore interno: ' + (e as Error).message };
  }
}

function afterIntent(ctx: Ctx) {
  const s = ctx.s;
  if (s.phase === 'gameOver') return;
  if (!s.pending.length) processMeleeQueue(ctx);
  if (s.phase === 'endTurn') maybeFinishEndTurn(ctx);
  // Un'attivazione si chiude da sola quando non resta più nulla da fare.
  const a = s.activation;
  if (a && !s.pending.length && a.kind !== 'leader' && a.kind !== 'manoeuvre') {
    const any = a.units.some((id) => s.units[id] && !s.units[id].removed && s.units[id].actionsLeft > 0 && !s.units[id].meleeId);
    if (!any) {
      s.activation = undefined;
      ctx.log('Attivazione conclusa.', 'info');
    }
  }
}

function mustBePhase(ctx: Ctx, ...p: GameState['phase'][]) {
  if (!p.includes(ctx.s.phase)) fail('Azione non disponibile in questa fase');
}

function unitOf(ctx: Ctx, id: string): Unit {
  const u = ctx.s.units[id];
  if (!u || u.removed) fail('Unità non trovata');
  return u;
}

function own(ctx: Ctx, u: { side: Side }) {
  if (u.side !== ctx.actor) fail("Non è un'unità tua");
}

/** Verifica che l'unità possa compiere un'azione ora e la scala. */
function spendAction(ctx: Ctx, u: Unit, cost = 1): 'manoeuvre' | 'battle' {
  const s = ctx.s;
  own(ctx, u);
  if (s.pending.length) fail('Rispondi prima alla decisione in sospeso');
  if (s.phase === 'manoeuvre') {
    if (s.activeSide !== ctx.actor) fail("Nella Fase di Manovra si muove un'unità a testa: tocca all'avversario");
    if (cost > 1 && !(isArtillery(u))) fail('Le azioni speciali non sono disponibili nella Fase di Manovra');
    return 'manoeuvre';
  }
  if (s.phase !== 'battle') fail('Azione non disponibile in questa fase');
  const a = s.activation;
  if (!a || a.side !== ctx.actor) fail('Non hai un\'attivazione in corso (gira una carta)');
  if (!a.units.includes(u.id)) fail(`${u.name} non è stata attivata in questa attivazione`);
  if (u.meleeId) fail(`${u.name} è impegnata in mischia`);
  if (u.actionsLeft < cost) fail(`${u.name} non ha più azioni disponibili (${u.actionsLeft})`);
  u.actionsLeft -= cost;
  u.actionsUsed += cost;
  a.currentUnit = u.id;
  return 'battle';
}

function endManoeuvreStep(ctx: Ctx) {
  const s = ctx.s;
  if (s.phase !== 'manoeuvre') return;
  s.manoeuvrePasses = 0;
  s.activeSide = otherSide(s.activeSide);
}

function nearestEnemyDist(s: GameState, u: Unit, at: { x: number; y: number }): number {
  let best = Infinity;
  for (const e of liveUnits(s, otherSide(u.side))) {
    if (e.unplaced) continue;
    best = Math.min(best, dist(at, closestPointOnPolygon(at, unitPoly(e))));
  }
  return best;
}

function handle(ctx: Ctx, it: Intent) {
  const s = ctx.s;
  switch (it.t) {
    // ---------------------------------------------------------------- setup
    case 'setPlayer': {
      const p = s.players[it.side];
      if (it.name !== undefined) p.name = it.name.slice(0, 30) || p.name;
      if (it.faction !== undefined) p.faction = it.faction.slice(0, 30);
      if (it.color !== undefined) p.color = it.color;
      return;
    }
    case 'setOptions': {
      mustBePhase(ctx, 'setup');
      s.options = { ...s.options, ...it.options };
      s.armyReady = { A: false, B: false };
      return;
    }
    case 'setArmy': {
      mustBePhase(ctx, 'setup');
      loadArmy(s, it.side, it.army);
      s.armyReady[it.side] = false;
      return;
    }
    case 'armyReady': {
      mustBePhase(ctx, 'setup');
      if (it.ready) {
        if (!liveUnits(s, it.side).length) fail('Prima carica un esercito');
        if (!cinc(s, it.side)) fail('Serve un Comandante in Capo');
      }
      s.armyReady[it.side] = it.ready;
      if (s.armyReady.A && s.armyReady.B) beginTerrain(ctx);
      return;
    }
    case 'addArea': {
      terrainEditor(ctx);
      s.terrain.areas.push({ ...it.feature, id: ctx.newId('ta') });
      return;
    }
    case 'addLine': {
      terrainEditor(ctx);
      s.terrain.lines.push({ ...it.feature, id: ctx.newId('tl') });
      return;
    }
    case 'removeFeature': {
      terrainEditor(ctx);
      s.terrain.areas = s.terrain.areas.filter((a) => a.id !== it.id);
      s.terrain.lines = s.terrain.lines.filter((a) => a.id !== it.id);
      return;
    }
    case 'moveFeature': {
      terrainEditor(ctx);
      const f = [...s.terrain.areas, ...s.terrain.lines].find((x) => x.id === it.id);
      if (!f) fail('Elemento non trovato');
      f.points = f.points.map((p) => ({ x: p.x + it.dx, y: p.y + it.dy }));
      return;
    }
    case 'clearTerrain': {
      terrainEditor(ctx);
      s.terrain = { areas: [], lines: [] };
      return;
    }
    case 'randomTerrain': {
      terrainEditor(ctx);
      s.terrain = randomTerrain(ctx);
      ctx.log('Terreno generato casualmente.', 'info', it.side);
      return;
    }
    case 'terrainDone': {
      mustBePhase(ctx, 'terrain');
      if (it.side !== s.terrainSide) fail("Il terreno lo prepara l'altro giocatore");
      const other = otherSide(s.terrainSide);
      ctx.ask({
        side: other,
        kind: 'edge',
        prompt: `Il terreno è pronto. Da quale lato del tavolo vuoi schierare il tuo esercito, ${s.players[other].name}?`,
        options: [
          { value: 'keep', label: other === 'A' ? 'Lato sud (in basso)' : 'Lato nord (in alto)' },
          { value: 'swap', label: 'Il lato opposto (ruota il tavolo)' },
        ],
        ctx: {},
      });
      return;
    }
    case 'place': {
      mustBePhase(ctx, 'deploy');
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      const at = { x: it.x, y: it.y, facing: normAngle(it.facing) };
      const poly = unitPoly(u, at);
      const zone = deployZoneCheck(s, u, poly);
      if (zone) fail(zone);
      for (const o of liveUnits(s)) if (o.id !== u.id && !o.unplaced && polygonsOverlap(poly, unitPoly(o))) fail(`Si sovrappone a ${o.name}`);
      if (!isSkirmisher(u) && s.terrain.areas.some((a) => a.kind === 'building' && polygonsOverlap(poly, a.points))) fail('Solo gli Schermagliatori possono occupare edifici');
      u.x = at.x;
      u.y = at.y;
      u.facing = at.facing;
      u.unplaced = false;
      syncAttachedLeaders(s, u);
      s.deployReady[it.side] = false;
      return;
    }
    case 'unplace': {
      mustBePhase(ctx, 'deploy');
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      u.unplaced = true;
      for (const l of Object.values(s.leaders)) if (l.attachedTo === u.id) l.unplaced = true;
      return;
    }
    case 'placeLeader': {
      mustBePhase(ctx, 'deploy');
      const l = s.leaders[it.leaderId];
      if (!l) fail('Comandante non trovato');
      own(ctx, l);
      if (it.attachTo) {
        const u = unitOf(ctx, it.attachTo);
        own(ctx, u);
        if (u.unplaced) fail("Schiera prima l'unità");
        l.attachedTo = u.id;
        syncAttachedLeaders(s, u);
      } else {
        const inZone = it.side === 'A' ? it.y >= s.table.height - 9 : it.y <= 9;
        if (!inZone) fail('I comandanti vanno schierati nella propria zona (9" dal bordo)');
        l.attachedTo = undefined;
        l.x = it.x;
        l.y = it.y;
      }
      l.unplaced = false;
      s.deployReady[it.side] = false;
      return;
    }
    case 'placeDefence': {
      mustBePhase(ctx, 'deploy');
      s.terrain.lines.push({ id: ctx.newId('tl'), kind: it.kind, points: it.points, owner: it.side });
      return;
    }
    case 'deployReady': {
      mustBePhase(ctx, 'deploy');
      if (it.ready) {
        const missing = liveUnits(s, it.side).filter((u) => u.unplaced).length + liveLeaders(s, it.side).filter((l) => l.unplaced).length;
        if (missing) fail(`Restano ${missing} unità o comandanti da schierare`);
      }
      s.deployReady[it.side] = it.ready;
      if (s.deployReady.A && s.deployReady.B) {
        s.phase = 'manoeuvre';
        s.turn = 0;
        computeArmyMorale(ctx);
        s.activeSide = s.firstSide;
        s.manoeuvrePasses = 0;
        s.specialDeck = buildSpecialDeck(ctx);
        ctx.log(
          `Inizia la Fase di Manovra: a turno ogni giocatore muove un'unità (azione gratuita). Comincia ${s.players[s.firstSide].name}. La fase termina quando un'unità tira o attacca.`,
          'phase',
        );
      }
      return;
    }

    // ---------------------------------------------------------------- azioni delle unità
    case 'move': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      const manoeuvre = s.phase === 'manoeuvre';
      const plan = planMove(s, u, { x: it.x, y: it.y, facing: it.facing }, { manoeuvre });
      if (!plan.ok) fail(plan.reason!);
      if (u.daunted) {
        const before = nearestEnemyDist(s, u, u);
        const after = nearestEnemyDist(s, u, plan.dest);
        if (after < before - 0.05) fail('Le unità Scosse possono solo allontanarsi dal nemico');
      }
      spendAction(ctx, u);
      u.x = plan.dest.x;
      u.y = plan.dest.y;
      u.facing = plan.dest.facing;
      u.disarray = Math.min(2, u.disarray + plan.disarray);
      for (const id of plan.disarrayOthers) {
        const o = s.units[id];
        o.disarray = Math.min(2, o.disarray + 1);
      }
      u.inBuilding = s.terrain.areas.find((a) => a.kind === 'building' && pointInPolygon(u, a.points))?.id;
      syncAttachedLeaders(s, u);
      ctx.log(
        `${u.name} muove di ${plan.distance.toFixed(1)}"${plan.notes.length ? ' (' + plan.notes.join(', ') + ')' : ''}${plan.disarray ? ` → ${plan.disarray} Disordine` : ''}${
          plan.disarrayOthers.length ? `; disordina ${plan.disarrayOthers.map((id) => s.units[id].name).join(', ')}` : ''
        }.`,
        'info',
        u.side,
      );
      endManoeuvreStep(ctx);
      return;
    }
    case 'wheel': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      if (isArtillery(u)) fail('L\'artiglieria usa "Ruota sul posto"');
      if (u.daunted) fail('Le unità Scosse possono solo allontanarsi dal nemico (usa Dietro-front e Muovi)');
      const w = planWheel(s, u, it.angle);
      if (!w.ok) fail(w.reason!);
      spendAction(ctx, u);
      u.x = w.dest.x;
      u.y = w.dest.y;
      u.facing = w.dest.facing;
      const dis = s.phase === 'manoeuvre' ? 0 : w.disarray;
      u.disarray = Math.min(2, u.disarray + dis);
      syncAttachedLeaders(s, u);
      ctx.log(`${u.name} converge di ${Math.round(it.angle)}°${dis ? ' (oltre 45°: un Disordine)' : ''}.`, 'info', u.side);
      endManoeuvreStep(ctx);
      return;
    }
    case 'aboutFace': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      if (isArtillery(u) && u.gunDeployed) fail("L'artiglieria schierata non può fare dietro-front");
      spendAction(ctx, u);
      u.facing = normAngle(u.facing + 180);
      if (u.formation === 'block' || u.formation === 'mixed') u.companies.reverse();
      const dis = isLoose(u) || s.phase === 'manoeuvre' ? 0 : 1;
      u.disarray = Math.min(2, u.disarray + dis);
      syncAttachedLeaders(s, u);
      ctx.log(`${u.name} fa dietro-front${dis ? ' (un Disordine)' : ''}.`, 'info', u.side);
      endManoeuvreStep(ctx);
      return;
    }
    case 'pivot': {
      const u = unitOf(ctx, it.unitId);
      if (!isArtillery(u)) fail("Solo l'artiglieria ruota sul posto");
      if (u.companies[0].type === 'heavyGun') fail('I pezzi pesanti non possono ruotare');
      if (Math.abs(it.angle) > 45.5) fail('Massimo 45°');
      spendAction(ctx, u);
      u.facing = normAngle(u.facing + it.angle);
      u.pivotedThisTurn = true;
      ctx.log(`${u.name} ruota sul posto di ${Math.round(it.angle)}° (in questo turno tira un solo dado per servente).`, 'info', u.side);
      endManoeuvreStep(ctx);
      return;
    }
    case 'shoot': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      const t = unitOf(ctx, it.targetId);
      if (u.daunted && s.phase === 'battle') fail('Le unità Scosse non possono tirare (solo allontanarsi o riordinarsi)');
      const maxShots = u.companies[0].type === 'archers' ? 2 : 1;
      if (u.shotsThisTurn >= maxShots) fail('Questa unità ha già tirato il massimo consentito in questo turno');
      const opts = validTargets(s, u);
      const pick = opts.find((o) => o.target.id === t.id);
      if (!pick) fail('Bersaglio non valido (fuori arco, portata o vista)');
      if (!pick.allowed) fail(pick.why!);
      const phase = spendAction(ctx, u);
      resolveShooting(ctx, u, t);
      if (phase === 'manoeuvre') startBattle(ctx, `${u.name} ha tirato`);
      return;
    }
    case 'attack': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      const t = unitOf(ctx, it.targetId);
      const manoeuvre = s.phase === 'manoeuvre';
      const chk = checkAttack(s, u, t, { charge: it.charge, manoeuvre });
      if (!chk.ok) fail(chk.reason!);
      const phase = spendAction(ctx, u);
      if (phase === 'manoeuvre') {
        u.actionsUsed = 0;
        startBattle(ctx, `${u.name} ha attaccato`);
        u.ordered = true;
      }
      performAttack(ctx, u, t, { charge: it.charge, manoeuvre, ambush: u.ambushThisTurn });
      return;
    }
    case 'attackLeader': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      const l = s.leaders[it.leaderId];
      if (!l || l.killed || l.side === u.side) fail('Bersaglio non valido');
      if (l.attachedTo) fail('Il comandante è aggregato a un\'unità: attacca l\'unità');
      if (isSkirmisher(u) && u.companies[0].type !== 'kern') fail('Gli Schermagliatori non possono attaccare');
      const phase = spendAction(ctx, u);
      if (phase === 'manoeuvre') startBattle(ctx, `${u.name} ha attaccato`);
      attackLeader(ctx, u, l);
      return;
    }
    case 'rally': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      if (!leaderOf(s, u)) fail('Per riordinarsi serve un comandante aggregato all\'unità');
      if (s.phase === 'manoeuvre') fail('Non disponibile nella Fase di Manovra');
      spendAction(ctx, u);
      rallyOnce(ctx, u, it.what);
      return;
    }
    case 'packUp': {
      const u = unitOf(ctx, it.unitId);
      if (!isArtillery(u)) fail("Solo per l'artiglieria");
      if (u.companies[0].type === 'heavyGun') fail('I pezzi pesanti non si spostano');
      spendAction(ctx, u, s.phase === 'manoeuvre' ? 1 : 2);
      u.gunDeployed = !u.gunDeployed;
      ctx.log(`${u.name} ${u.gunDeployed ? 'sgancia e schiera il pezzo' : 'aggancia il pezzo al traino'}.`, 'info', u.side);
      endManoeuvreStep(ctx);
      return;
    }
    case 'special': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      if (s.phase !== 'battle') fail('Le azioni speciali si fanno nella Fase di Battaglia');
      if (u.daunted) fail('Le unità Scosse non possono compiere azioni speciali');
      specialAction(ctx, u, it);
      return;
    }
    case 'toggleWoodEdge': {
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      u.woodEdge = !u.woodEdge;
      ctx.log(`${u.name} è ${u.woodEdge ? 'schierata al margine del bosco' : "all'interno del bosco"}.`, 'info', u.side);
      return;
    }

    // ---------------------------------------------------------------- comandanti
    case 'order': {
      mustBePhase(ctx, 'battle');
      const a = s.activation;
      if (!a || a.kind !== 'leader' || a.side !== it.side || a.leaderId !== it.leaderId) fail('Non è il turno di questo comandante');
      const l = s.leaders[it.leaderId];
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      if (a.tokensLeft <= 0) fail('Segnalini Ordine esauriti');
      if (l.attachedTo && s.units[l.attachedTo]?.meleeId) fail(`${l.name} è impegnato a combattere in mischia: non può dare ordini`);
      if (u.ordered) fail(`${u.name} ha già ricevuto un Ordine in questo turno`);
      if (u.initiative) fail(`${u.name} ha già agito d'iniziativa in questo turno`);
      if (u.meleeId) fail(`${u.name} è impegnata in una mischia che continua`);
      if (u.wardId !== l.wardId && !l.isCinC) fail('Solo il Comandante in Capo può dare ordini a unità di altre Schiere');
      const d = l.attachedTo === u.id ? 0 : dist(l, closestPointOnPolygon(l, unitPoly(u)));
      if (d > COMMAND_RANGE + 0.05) fail(`${u.name} è fuori dal raggio di comando (${d.toFixed(1)}" > 6")`);
      a.tokensLeft--;
      u.ordered = true;
      u.actionsLeft = 2;
      u.actionsUsed = 0;
      a.units.push(u.id);
      a.currentUnit = u.id;
      ctx.log(`${l.name} dà un Ordine a ${u.name}${u.daunted ? ' (Scossa: può solo allontanarsi dal nemico o riordinarsi)' : ''}.`, 'info', u.side);
      return;
    }
    case 'leaderMove': {
      const l = s.leaders[it.leaderId];
      if (!l || l.killed) fail('Comandante non trovato');
      own(ctx, l);
      const token = useLeaderToken(ctx, l.id);
      const allowance = leaderAllowance(s, l, it);
      let tx = it.x;
      let ty = it.y;
      let target: Unit | undefined;
      if (it.attachTo) {
        target = unitOf(ctx, it.attachTo);
        if (target.side !== l.side) fail('Puoi aggregarti solo a unità amiche');
        const p = closestPointOnPolygon(l, unitPoly(target));
        tx = p.x;
        ty = p.y;
      }
      const d = dist(l, { x: tx, y: ty });
      if (d > allowance + 0.05) fail(`Troppo lontano: ${d.toFixed(1)}" su ${allowance}"`);
      if (tx < 0 || ty < 0 || tx > s.table.width || ty > s.table.height) fail('Fuori dal tavolo');
      const prev = l.attachedTo ? s.units[l.attachedTo] : undefined;
      l.attachedTo = target?.id;
      l.x = tx;
      l.y = ty;
      if (target) syncAttachedLeaders(s, target);
      ctx.log(`${l.name} si muove di ${d.toFixed(1)}"${target ? ` e si aggrega a ${target.name}` : ''}.`, 'info', l.side);
      if (prev && prev.id !== target?.id && prev.meleeId && !prev.removed) moraleTest(ctx, prev, { reason: `${l.name} abbandona la mischia` });
      if (token === 'manoeuvre') endManoeuvreStep(ctx);
      return;
    }
    case 'mount': {
      const l = s.leaders[it.leaderId];
      if (!l || l.killed) fail('Comandante non trovato');
      own(ctx, l);
      if (s.phase === 'manoeuvre') fail('Non nella Fase di Manovra');
      if (l.needsRemount) {
        const cav = liveUnits(s, l.side).find((u) => isCavalry(u) && dist(l, closestPointOnPolygon(l, unitPoly(u))) <= COMMAND_RANGE);
        if (!cav) fail('Serve una unità di Cavalleria amica entro 6" per avere una nuova cavalcatura');
        useLeaderToken(ctx, l.id);
        l.mounted = true;
        l.needsRemount = false;
        ctx.log(`${l.name} riceve una nuova cavalcatura da ${cav.name}.`, 'info', l.side);
        return;
      }
      if (l.mountSwapUsed) fail('Si può montare o smontare una sola volta per battaglia');
      useLeaderToken(ctx, l.id);
      l.mounted = !l.mounted;
      l.mountSwapUsed = true;
      ctx.log(`${l.name} ${l.mounted ? 'monta a cavallo' : 'smonta da cavallo'}.`, 'info', l.side);
      return;
    }
    case 'leaderRally': {
      const l = s.leaders[it.leaderId];
      if (!l || l.killed) fail('Comandante non trovato');
      own(ctx, l);
      if (!l.attachedTo) fail("Il comandante deve essere aggregato all'unità da riordinare");
      const u = unitOf(ctx, l.attachedTo);
      if (u.meleeId) fail("L'unità è in mischia");
      useLeaderToken(ctx, l.id);
      rallyOnce(ctx, u, it.what);
      return;
    }
    case 'endActivation': {
      mustBePhase(ctx, 'battle');
      const a = s.activation;
      if (!a) fail('Nessuna attivazione in corso');
      if (a.side !== it.side) fail("È l'attivazione dell'avversario");
      if (s.pending.length) fail('Ci sono decisioni in sospeso');
      for (const id of a.units) {
        const u = s.units[id];
        if (u && a.kind !== 'leader') u.actionsLeft = 0;
        if (u && a.kind === 'leader') u.actionsLeft = 0;
      }
      s.activation = undefined;
      ctx.log(`${s.players[it.side].name} conclude l'attivazione.`, 'info', it.side);
      return;
    }
    case 'drawCard': {
      drawPlayCard(ctx);
      return;
    }
    case 'manoeuvrePass': {
      mustBePhase(ctx, 'manoeuvre');
      if (s.activeSide !== it.side) fail("Tocca all'avversario");
      s.manoeuvrePasses++;
      ctx.log(`${s.players[it.side].name} passa.`, 'info', it.side);
      s.activeSide = otherSide(s.activeSide);
      if (s.manoeuvrePasses >= 2) startBattle(ctx, 'entrambi i giocatori hanno passato');
      return;
    }

    // ---------------------------------------------------------------- decisioni
    case 'answer': {
      const p = s.pending.find((x) => x.id === it.pendingId);
      if (!p) fail('Decisione non trovata');
      if (p.side !== it.side) fail("Questa decisione spetta all'avversario");
      if (!p.options.some((o) => o.value === it.choice)) fail('Scelta non valida');
      s.pending = s.pending.filter((x) => x.id !== p.id);
      answer(ctx, p.kind, p.ctx, it.choice);
      return;
    }
    case 'playCard': {
      playCard(ctx, it.handId, it.unitId, it.leaderId);
      return;
    }
    case 'discardCard': {
      const hand = s.hands[it.side];
      const i = hand.findIndex((h) => h.id === it.handId);
      if (i < 0) fail('Carta non trovata');
      hand.splice(i, 1);
      return;
    }

    // ---------------------------------------------------------------- fine turno
    case 'freeAction': {
      mustBePhase(ctx, 'endTurn');
      const u = unitOf(ctx, it.unitId);
      own(ctx, u);
      if (!eligibleForFreeAction(u)) fail('Questa unità non ha diritto all\'azione gratuita');
      if (it.kind === 'rally') {
        if (u.disarray <= 0) fail('Nessun Disordine da togliere');
        u.disarray--;
        u.freeUsed = true;
        ctx.log(`${u.name} toglie un Disordine (azione gratuita di fine turno).`, 'info', u.side);
      } else {
        if (u.companies[0].type !== 'archers') fail('Solo gli Arcieri possono tirare come azione gratuita');
        const t = unitOf(ctx, it.targetId!);
        const opts = validTargets(s, u);
        const pick = opts.find((o) => o.target.id === t.id);
        if (!pick) fail('Bersaglio non valido');
        if (!pick.allowed) fail(pick.why!);
        u.freeUsed = true;
        resolveShooting(ctx, u, t, { free: true });
      }
      return;
    }
    case 'freeAutoRally': {
      mustBePhase(ctx, 'endTurn');
      for (const u of liveUnits(s, it.side)) {
        if (eligibleForFreeAction(u) && u.disarray > 0) {
          u.disarray--;
          u.freeUsed = true;
        }
      }
      ctx.log(`${s.players[it.side].name}: le unità idonee tolgono un Disordine.`, 'info', it.side);
      return;
    }
    case 'endTurnDone': {
      mustBePhase(ctx, 'endTurn');
      s.endTurn!.freeDone[it.side] = true;
      return;
    }

    // ---------------------------------------------------------------- strumenti manuali
    case 'manualUnit': {
      const u = unitOf(ctx, it.unitId);
      const before = JSON.stringify({ x: u.x, y: u.y, f: u.facing, d: u.disarray, s: u.daunted, c: u.companies.map((c) => c.figures) });
      Object.assign(u, it.patch);
      if (it.companies) it.companies.forEach((p, i) => u.companies[i] && Object.assign(u.companies[i], p));
      u.disarray = Math.max(0, Math.min(2, u.disarray));
      syncAttachedLeaders(s, u);
      void before;
      ctx.log(`MODIFICA MANUALE di ${s.players[it.side].name} a ${u.name}.`, 'manual', it.side);
      return;
    }
    case 'manualLeader': {
      const l = s.leaders[it.leaderId];
      if (!l) fail('Comandante non trovato');
      const p = it.patch;
      if (p.x !== undefined) l.x = p.x;
      if (p.y !== undefined) l.y = p.y;
      if (p.cls !== undefined) l.cls = Math.max(0, Math.min(3, p.cls));
      if (p.mounted !== undefined) l.mounted = p.mounted;
      if (p.attachedTo !== undefined) l.attachedTo = p.attachedTo ?? undefined;
      if (p.killed !== undefined) l.killed = p.killed;
      if (l.attachedTo && s.units[l.attachedTo]) syncAttachedLeaders(s, s.units[l.attachedTo]);
      ctx.log(`MODIFICA MANUALE di ${s.players[it.side].name} al comandante ${l.name}.`, 'manual', it.side);
      return;
    }
    case 'manualMorale': {
      s.armyMorale[it.target] = Math.max(0, it.value);
      ctx.log(`MODIFICA MANUALE: gettoni Morale d'Armata di ${s.players[it.target].name} = ${it.value}.`, 'manual', it.side);
      return;
    }
    case 'manualRemove': {
      const u = unitOf(ctx, it.unitId);
      u.removed = true;
      u.removedReason = 'rimossa manualmente';
      if (u.meleeId) {
        const m = s.melees[u.meleeId];
        if (m) {
          m.attackers = m.attackers.filter((x) => x !== u.id);
          m.defenders = m.defenders.filter((x) => x !== u.id);
          if (!m.attackers.length || !m.defenders.length) {
            for (const id of [...m.attackers, ...m.defenders]) s.units[id].meleeId = undefined;
            delete s.melees[m.id];
          }
        }
      }
      ctx.log(`MODIFICA MANUALE: ${u.name} rimossa dal tavolo da ${s.players[it.side].name}.`, 'manual', it.side);
      return;
    }
    case 'note': {
      ctx.log(`${s.players[it.side].name}: ${it.text.slice(0, 300)}`, 'manual', it.side);
      return;
    }
    case 'concede': {
      endGame(ctx, otherSide(it.side), `${s.players[it.side].name} si arrende`);
      return;
    }
  }
}

function useLeaderToken(ctx: Ctx, leaderId: string): 'manoeuvre' | 'battle' {
  const s = ctx.s;
  if (s.phase === 'manoeuvre') {
    if (s.activeSide !== ctx.actor) fail("Nella Fase di Manovra si muove un'unità a testa: tocca all'avversario");
    return 'manoeuvre';
  }
  mustBePhase(ctx, 'battle');
  const a = s.activation;
  if (!a || a.kind !== 'leader' || a.leaderId !== leaderId) fail('Il comandante può agire solo quando è in gioco la sua carta');
  if (a.tokensLeft <= 0) fail('Segnalini Ordine esauriti');
  a.tokensLeft--;
  return 'battle';
}

function rallyOnce(ctx: Ctx, u: Unit, what?: 'disarray' | 'daunted') {
  const s = ctx.s;
  const target = what ?? (u.daunted ? 'daunted' : 'disarray');
  if (target === 'daunted' && u.daunted) {
    if (u.dauntedThisTurn) fail("Un'unità diventata Scossa in questo turno non può essere riordinata nello stesso turno");
    u.rallyCount = (u.rallyCount ?? 0) + 1;
    if (u.rallyCount >= 2) {
      u.daunted = false;
      u.rallyCount = 0;
      ctx.log(`${u.name} si riprende: tolto il segnalino Scossa.`, 'morale', u.side);
      for (const c of u.companies) if (TROOPS[c.type].arm === 'infantry' || TROOPS[c.type].arm === 'cavalry') regainArmyMorale(ctx, u.side, `${u.name} riordinata`);
    } else ctx.log(`${u.name} inizia a riordinarsi (serve un'altra azione di Riordino per togliere Scossa).`, 'morale', u.side);
    return;
  }
  if (u.disarray > 0) {
    u.disarray--;
    ctx.log(`${u.name} si riordina: tolto un Disordine.`, 'info', u.side);
    return;
  }
  if (u.rumourDisarray) {
    u.rumourDisarray = false;
    ctx.log(`${u.name} si riordina.`, 'info', u.side);
    return;
  }
  fail("L'unità non ha nulla da riordinare");
}

function specialAction(ctx: Ctx, u: Unit, it: Extract<Intent, { t: 'special' }>) {
  const s = ctx.s;
  const c = u.companies[0];
  switch (it.kind) {
    case 'split': {
      if (u.companies.length < 2) fail('Non è una formazione appaiata');
      spendAction(ctx, u, 2);
      const parts = splitFormation(ctx, u, 1);
      parts[1].ordered = true;
      parts[1].actionsLeft = 0;
      return;
    }
    case 'join':
    case 'formBlock': {
      const o = unitOf(ctx, it.otherId!);
      own(ctx, o);
      if (u.companies.length > 1 || o.companies.length > 1) fail('Si possono unire solo due compagnie singole');
      const a = u.companies[0];
      const b = o.companies[0];
      const mixed = (a.type === 'archers' && (b.type === 'billmen' || b.type === 'menAtArms')) || (b.type === 'archers' && (a.type === 'billmen' || a.type === 'menAtArms'));
      if (a.type !== b.type && !mixed) fail('Servono due compagnie dello stesso tipo (o Arcieri con Alabardieri/Uomini d\'Arme)');
      if (a.quality !== b.quality) fail('Le compagnie devono avere la stessa qualità');
      if (TROOPS[a.type].arm !== 'infantry') fail('Solo le Compagnie di fanteria formano formazioni appaiate');
      if (dist(u, o) > 6) fail('Le due compagnie devono essere vicine (entro 6")');
      if (o.meleeId || o.daunted) fail("L'altra compagnia non è disponibile");
      spendAction(ctx, u, 2);
      const formation = mixed ? 'mixed' : it.kind === 'formBlock' ? 'block' : 'line';
      u.companies = [a, b];
      u.formation = formation;
      if (mixed && b.type === 'archers') u.companies = [b, a];
      u.disarray = Math.max(u.disarray, o.disarray);
      for (const l of Object.values(s.leaders)) if (l.attachedTo === o.id) l.attachedTo = u.id;
      o.removed = true;
      o.removedReason = 'unita in formazione';
      syncAttachedLeaders(s, u);
      ctx.log(`${u.name} e ${o.name} formano ${formation === 'line' ? 'una Linea' : formation === 'block' ? 'un Blocco' : 'un Blocco Misto'}.`, 'info', u.side);
      return;
    }
    case 'stakes': {
      if (!u.companies.some((x) => x.stakes && !x.stakesPlanted)) fail('Questa compagnia non ha pali da piantare');
      spendAction(ctx, u, 2);
      for (const x of u.companies) if (x.stakes) x.stakesPlanted = true;
      const poly = unitPoly(u);
      const f = { x: Math.sin((u.facing * Math.PI) / 180), y: -Math.cos((u.facing * Math.PI) / 180) };
      const p1 = { x: poly[0].x + f.x * 0.6, y: poly[0].y + f.y * 0.6 };
      const p2 = { x: poly[1].x + f.x * 0.6, y: poly[1].y + f.y * 0.6 };
      s.terrain.lines.push({ id: ctx.newId('tl'), kind: 'stakes', points: [p1, p2], owner: u.side });
      ctx.log(`${u.name} pianta i pali davanti al proprio fronte.`, 'info', u.side);
      return;
    }
    case 'dismountKnights': {
      if (c.type !== 'knights' || c.dismountedKnights) fail('Solo i Cavalieri a cavallo possono appiedarsi');
      spendAction(ctx, u, 2);
      c.dismountedKnights = true;
      ctx.log(`${u.name} smonta per combattere a piedi come Uomini d'Arme (testa il morale come cavalleria). I cavalli vengono mandati nelle retrovie.`, 'info', u.side);
      return;
    }
    case 'dismountLH': {
      if (c.type !== 'lightHorse' || !c.mountedShooters || c.dismountedLH) fail('Solo la Cavalleria Leggera armata di archi o balestre può appiedarsi');
      spendAction(ctx, u, 2);
      c.dismountedLH = true;
      ctx.log(`${u.name} smonta e combatte come Schermagliatori (due uomini tengono i cavalli).`, 'info', u.side);
      return;
    }
    case 'remountLH': {
      if (!c.dismountedLH) fail('Non è appiedata');
      spendAction(ctx, u, 2);
      c.dismountedLH = false;
      ctx.log(`${u.name} rimonta a cavallo.`, 'info', u.side);
      return;
    }
    case 'chopHedge': {
      if (!u.companies.some((x) => x.type === 'billmen')) fail('Solo gli Alabardieri aprono varchi nelle siepi');
      const l = s.terrain.lines.find((x) => x.id === it.featureId);
      if (!l || l.kind !== 'hedge') fail('Seleziona una siepe');
      spendAction(ctx, u, 2);
      // Apre un varco di 6" nel punto più vicino all'unità.
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < l.points.length - 1; i++) {
        const mid = { x: (l.points[i].x + l.points[i + 1].x) / 2, y: (l.points[i].y + l.points[i + 1].y) / 2 };
        const d = dist(mid, u);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (bd > 4) fail('La siepe è troppo lontana');
      const a = l.points.slice(0, best + 1);
      const b = l.points.slice(best + 1);
      s.terrain.lines = s.terrain.lines.filter((x) => x.id !== l.id);
      if (a.length >= 2) s.terrain.lines.push({ ...l, id: ctx.newId('tl'), points: a });
      if (b.length >= 2) s.terrain.lines.push({ ...l, id: ctx.newId('tl'), points: b });
      ctx.log(`${u.name} apre un varco nella siepe.`, 'info', u.side);
      return;
    }
  }
}

function answer(ctx: Ctx, kind: string, c: any, choice: string) {
  const s = ctx.s;
  switch (kind) {
    case 'reaction':
      answerReaction(ctx, c, choice);
      return;
    case 'duel':
      answerDuel(ctx, c, choice);
      return;
    case 'followup':
      answerFollowUp(ctx, c, choice);
      return;
    case 'pursue':
      answerPursue(ctx, c, choice);
      return;
    case 'edge': {
      if (choice === 'swap') {
        const W = s.table.width;
        const H = s.table.height;
        const rot = (p: { x: number; y: number }) => ({ x: W - p.x, y: H - p.y });
        for (const a of s.terrain.areas) a.points = a.points.map(rot);
        for (const l of s.terrain.lines) l.points = l.points.map(rot);
        ctx.log('Il tavolo viene ruotato: gli eserciti si schierano sui lati opposti.', 'info');
      }
      beginDeploy(ctx);
      return;
    }
    case 'horse': {
      const l = s.leaders[choice];
      s.hands[ctx.actor] = s.hands[ctx.actor].filter((h) => h.specialKey !== 'horse');
      if (!l) return;
      l.mounted = false;
      l.stunned = true;
      l.needsRemount = true;
      s.playDeck = s.playDeck.filter((cd) => cd.leaderId !== l.id);
      if (s.activation?.leaderId === l.id) s.activation = undefined;
      ctx.log(`"Un cavallo! Un cavallo!": il cavallo di ${l.name} si imbizzarrisce e lo disarciona! È stordito per il resto del turno e resta a piedi.`, 'card', ctx.actor);
      return;
    }
  }
}

function playCard(ctx: Ctx, handId: string, unitId?: string, leaderId?: string) {
  const s = ctx.s;
  const hand = s.hands[ctx.actor];
  const card = hand.find((h) => h.id === handId);
  if (!card) fail('Carta non trovata');
  if (s.phase !== 'battle' && s.phase !== 'endTurn') fail('Le carte si giocano durante la battaglia');
  const remove = () => {
    s.hands[ctx.actor] = s.hands[ctx.actor].filter((h) => h.id !== handId);
  };
  if (card.kind === 'bonus') {
    switch (card.bonusKind) {
      case 'perk': {
        if (s.phase !== 'battle') fail('Si gioca durante la Fase di Battaglia');
        const u = unitOf(ctx, unitId!);
        own(ctx, u);
        if (u.meleeId) fail("L'unità deve essere non impegnata");
        if (s.activation && s.activation.side !== ctx.actor) fail("Aspetta la fine dell'attivazione avversaria");
        if (s.pending.length) fail('Ci sono decisioni in sospeso');
        remove();
        u.actionsLeft += 1;
        if (!s.activation) s.activation = { kind: 'perk', side: ctx.actor, tokensLeft: 0, units: [u.id] };
        else if (!s.activation.units.includes(u.id)) s.activation.units.push(u.id);
        ctx.log(`${s.players[ctx.actor].name} gioca "Vantaggio": ${u.name} compie un'azione gratuita.`, 'card', ctx.actor);
        return;
      }
      case 'forfeit': {
        const u = unitOf(ctx, unitId!);
        if (u.side === ctx.actor) fail("Va giocata su un'unità nemica");
        if (!u.ordered) fail("L'unità nemica non ha ricevuto un Ordine in questo turno");
        if (u.actionsUsed >= 1 && u.actionsLeft === 0) fail('Troppo tardi: ha già agito');
        remove();
        u.actionsLeft = u.actionsUsed === 0 ? 1 : 0;
        ctx.log(`${s.players[ctx.actor].name} gioca "Penalità" su ${u.name}: in questo turno compie una sola azione.`, 'card', ctx.actor);
        return;
      }
      case 'dummy': {
        remove();
        ctx.log(`${s.players[ctx.actor].name} scarta una carta Bonus.`, 'card', ctx.actor);
        return;
      }
      case 'reroll':
        fail('La carta Ritira si usa dal registro dei lanci (pulsante "Ritira" accanto al tuo ultimo lancio)');
    }
    return;
  }
  // Evento speciale
  const def = specialDef(card.specialKey!);
  switch (def.key) {
    case 'rumour': {
      const l = s.leaders[leaderId!];
      if (!l || l.killed || l.side === ctx.actor) fail('Scegli un comandante nemico');
      if (!l.attachedTo || !s.units[l.attachedTo]?.meleeId) fail('Il comandante deve essere in una mischia che continua');
      remove();
      for (const u of liveUnits(s, l.side)) if (u.wardId === l.wardId && u.id !== l.attachedTo) u.rumourDisarray = true;
      ctx.log(`"Una voce insistente": lo stendardo di ${l.name} cade e si sparge la voce della sua morte! Le altre unità della sua Schiera sono in Disordine fino alla prossima carta Comandante amica.`, 'card', ctx.actor);
      return;
    }
    case 'counterfeit':
      fail("Questa carta si attiva da sola quando il tuo C-in-C viene ferito o ucciso");
    case 'ambush': {
      const u = unitOf(ctx, unitId!);
      own(ctx, u);
      remove();
      u.ambushThisTurn = true;
      ctx.log(`${s.players[ctx.actor].name} gioca "Imboscata" con ${u.name}: se attacca in questo turno, il nemico non potrà girarsi.`, 'card', ctx.actor);
      return;
    }
    default: {
      remove();
      ctx.log(`${s.players[ctx.actor].name} gioca l'Evento Speciale "${def.name}"${unitId ? ` su ${s.units[unitId]?.name}` : ''}. Applicate l'effetto della carta stampata (strumenti manuali).`, 'card', ctx.actor);
      return;
    }
  }
}

function terrainEditor(ctx: Ctx) {
  const s = ctx.s;
  if (s.phase !== 'terrain' && s.phase !== 'setup') fail('Il terreno si prepara prima dello schieramento');
  if (s.phase === 'terrain' && ctx.actor !== s.terrainSide) fail("Il terreno lo prepara l'altro giocatore (ha vinto il lancio della moneta)");
}

function beginTerrain(ctx: Ctx) {
  const s = ctx.s;
  // Classe di comando casuale (opzionale).
  if (s.options.randomCommandClass) {
    for (const side of ['A', 'B'] as Side[]) {
      let hero = false;
      for (const l of liveLeaders(s, side)) {
        let cls = 2;
        for (let tries = 0; tries < 20; tries++) {
          const d = ctx.dice.roll(1, side, `Classe di comando ${l.name}`)[0];
          cls = d === 6 ? 3 : d === 1 ? 1 : 2;
          if (cls === 3 && hero) continue;
          if (cls === 1 && l.isCinC) continue;
          break;
        }
        if (cls === 3) hero = true;
        l.cls = cls;
        l.maxClass = cls;
      }
    }
    ctx.log('Classi di comando tirate a caso.', 'info');
  }
  const coin = ctx.dice.roll(1, 'A', 'Lancio della moneta')[0];
  s.terrainSide = coin <= 3 ? 'A' : 'B';
  s.phase = 'terrain';
  ctx.log(`Lancio della moneta: ${s.players[s.terrainSide].name} prepara il terreno; ${s.players[otherSide(s.terrainSide)].name} sceglierà il lato del tavolo.`, 'phase');
}

function beginDeploy(ctx: Ctx) {
  const s = ctx.s;
  s.phase = 'deploy';
  const a = ctx.dice.roll(1, 'A', `Iniziativa ${s.players.A.name}`)[0];
  let b = ctx.dice.roll(1, 'B', `Iniziativa ${s.players.B.name}`)[0];
  let guard = 0;
  let aa = a;
  while (aa === b && guard++ < 10) {
    aa = ctx.dice.roll(1, 'A', 'Spareggio')[0];
    b = ctx.dice.roll(1, 'B', 'Spareggio')[0];
  }
  s.firstSide = aa > b ? 'A' : 'B';
  ctx.log(
    `Schieramento: ${s.players[s.firstSide].name} comincia. Schierate prima Schermagliatori e Artiglieria, poi una Schiera alla volta, entro 9" dal proprio bordo (a meno di 9" dai lati solo Schermagliatori e Cavalleria).`,
    'phase',
  );
}

function deployZoneCheck(s: GameState, u: Unit, poly: { x: number; y: number }[]): string | null {
  const H = s.table.height;
  const W = s.table.width;
  for (const p of poly) {
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return 'Fuori dal tavolo';
    if (u.side === 'A' && p.y < H - 9) return 'Fuori dalla zona di schieramento (9" dal tuo bordo)';
    if (u.side === 'B' && p.y > 9) return 'Fuori dalla zona di schieramento (9" dal tuo bordo)';
    const sideOk = isSkirmisher(u) || isCavalry(u);
    if (!sideOk && (p.x < 9 || p.x > W - 9)) return 'Solo Schermagliatori e Cavalleria possono schierarsi entro 9" dai lati del tavolo';
  }
  return null;
}

function randomTerrain(ctx: Ctx) {
  const s = ctx.s;
  const d = () => ctx.dice.roll(1, ctx.actor, 'Terreno')[0];
  const areas: AreaFeature[] = [];
  const lines: LineFeature[] = [];
  const W = s.table.width;
  const H = s.table.height;
  const nFeatures = 3 + Math.floor(d() / 2);
  const kinds: AreaFeature['kind'][] = ['wood', 'hill', 'wood', 'hill', 'marsh', 'builtUp'];
  for (let i = 0; i < nFeatures; i++) {
    const kind = kinds[(d() - 1) % kinds.length];
    const cx = 8 + ((d() + d() * 6) / 42) * (W - 16);
    const cy = 12 + ((d() - 1) / 5) * (H - 24);
    const rx = 4 + d();
    const ry = 3 + d() * 0.7;
    if (kind === 'builtUp') {
      areas.push({ id: ctx.newId('ta'), kind: 'building', points: [{ x: cx - 1.5, y: cy - 1 }, { x: cx + 1.5, y: cy - 1 }, { x: cx + 1.5, y: cy + 1 }, { x: cx - 1.5, y: cy + 1 }] });
      continue;
    }
    areas.push({ id: ctx.newId('ta'), kind, points: ellipsePolygon(cx, cy, rx, ry, 18, 0.12) });
  }
  const nHedges = Math.floor(d() / 3);
  for (let i = 0; i < nHedges; i++) {
    const x = 10 + ((d() - 1) / 5) * (W - 20);
    const y = 16 + ((d() - 1) / 5) * (H - 32);
    lines.push({ id: ctx.newId('tl'), kind: d() <= 4 ? 'hedge' : 'wall', points: [{ x: x - 6, y }, { x, y: y + 0.5 }, { x: x + 6, y }] });
  }
  return { areas, lines };
}

/** Informazioni sulle carte bonus per l'interfaccia. */
export function bonusName(kind: string) {
  return BONUS_CARDS[kind as keyof typeof BONUS_CARDS]?.name ?? kind;
}

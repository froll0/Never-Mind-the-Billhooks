import { specialDef } from './cards';
import { Ctx, fail } from './ctx';
import { processMeleeQueue, enqueueMelee } from './melee';
import { moraleTest } from './morale';
import type { BonusCard, PlayCard, Side, SpecialCard, Unit } from './types';
import { otherSide } from './types';
import { countsForArmyMorale, isArtillery, isSkirmisher, liveLeaders, liveUnits, unitHalfStrength } from './units';
import { SPECIAL_EVENTS } from './cards';

export function buildBonusDeck(ctx: Ctx): BonusCard[] {
  const kinds: BonusCard['kind'][] = ['perk', 'forfeit', 'reroll', 'dummy'];
  if (ctx.s.specialDrawCount < 2) kinds.push('special');
  return ctx.dice.shuffle(kinds.map((k, i) => ({ id: `b${i}-${k}`, kind: k })));
}

export function buildSpecialDeck(ctx: Ctx): SpecialCard[] {
  return ctx.dice.shuffle(SPECIAL_EVENTS.map((c, i) => ({ id: `se${i}`, key: c.key })));
}

export function buildPlayDeck(ctx: Ctx): PlayCard[] {
  const s = ctx.s;
  const cards: PlayCard[] = [];
  for (const l of liveLeaders(s)) cards.push({ id: `pl-${l.id}`, kind: 'leader', leaderId: l.id, side: l.side });
  cards.push({ id: 'pb1', kind: 'bonus' }, { id: 'pb2', kind: 'bonus' });
  cards.push({ id: 'ps-A', kind: 'skirmish', side: 'A' }, { id: 'ps-B', kind: 'skirmish', side: 'B' });
  return ctx.dice.shuffle(cards);
}

/** Inizio della Fase di Battaglia principale. */
export function startBattle(ctx: Ctx, why: string) {
  const s = ctx.s;
  s.phase = 'battle';
  s.turn = 1;
  s.activation = undefined;
  ctx.log(`Inizia la Fase di Battaglia (${why}). Turno 1.`, 'phase');
  startTurn(ctx);
}

export function startTurn(ctx: Ctx) {
  const s = ctx.s;
  s.playDeck = buildPlayDeck(ctx);
  s.playDiscard = [];
  s.currentCard = undefined;
  s.bonusDeck = buildBonusDeck(ctx);
  s.bonusDrawnThisTurn = 0;
  s.sawRoutTested = [];
  for (const u of Object.values(s.units)) resetUnitForTurn(u);
  for (const l of Object.values(s.leaders)) {
    l.stunned = false;
    l.usedThisActivation = 0;
  }
}

export function resetUnitForTurn(u: Unit) {
  u.ordered = false;
  u.initiative = false;
  u.actionsLeft = 0;
  u.actionsUsed = 0;
  u.shotsThisTurn = 0;
  u.lossesThisTurn = false;
  u.lossesAfterWin = false;
  u.wonMeleeThisTurn = false;
  u.dauntedThisTurn = false;
  u.pivotedThisTurn = false;
  u.shotAtByThisTurn = [];
  u.revealed = false;
  u.ambushThisTurn = false;
  u.rallyCount = 0;
  u.freeUsed = false;
}

/** Gira la prossima carta del Mazzo di Gioco. */
export function drawPlayCard(ctx: Ctx) {
  const s = ctx.s;
  if (s.phase !== 'battle') fail('Non siamo nella Fase di Battaglia');
  if (s.activation) fail("Termina prima l'attivazione in corso");
  if (s.pending.length) fail('Ci sono decisioni in sospeso');
  if (s.meleeQueue.length) fail('Ci sono mischie da risolvere');
  if (s.currentCard) s.playDiscard.push(s.currentCard);
  s.currentCard = undefined;
  if (s.playDeck.length <= 1) {
    const last = s.playDeck[0];
    if (last) ctx.log(`Resta solo l'ultima carta del mazzo (${cardLabel(ctx, last)}): viene ignorata. Fine del turno ${s.turn}.`, 'phase');
    beginEndTurn(ctx);
    return;
  }
  const card = s.playDeck.shift()!;
  s.currentCard = card;
  s.sawRoutTested = [];
  if (card.kind === 'leader') {
    const l = s.leaders[card.leaderId!];
    if (!l || l.killed) {
      ctx.log('Carta di un comandante caduto: scartata.', 'card');
      return;
    }
    // La "voce" si dissolve alla prossima carta Comandante amica.
    for (const u of liveUnits(s, l.side)) u.rumourDisarray = false;
    if (l.stunned) {
      ctx.log(`Carta di ${l.name}: è stordito e non può agire in questo turno.`, 'card', l.side);
      return;
    }
    s.activation = { kind: 'leader', side: l.side, leaderId: l.id, tokensLeft: l.cls, units: [] };
    l.usedThisActivation = 0;
    ctx.log(`Carta Comandante: ${l.name} (${s.players[l.side].name}) ha ${l.cls} Segnalini Ordine.`, 'card', l.side);
    return;
  }
  if (card.kind === 'skirmish') {
    const side = card.side!;
    const units = liveUnits(s, side).filter((u) => !u.unplaced && (isSkirmisher(u) || isArtillery(u)) && !u.ordered && !u.meleeId);
    if (!units.length) {
      ctx.log(`Carta Schermagliatori e Artiglieria (${s.players[side].name}): nessuna unità può agire.`, 'card', side);
      return;
    }
    for (const u of units) {
      u.initiative = true;
      u.actionsLeft = 2;
      u.actionsUsed = 0;
    }
    s.activation = { kind: 'skirmish', side, tokensLeft: 0, units: units.map((u) => u.id) };
    ctx.log(`Carta Schermagliatori e Artiglieria: ${s.players[side].name} agisce d'iniziativa con ${units.length} unità.`, 'card', side);
    return;
  }
  // Carta Bonus
  s.bonusDrawnThisTurn++;
  ctx.log('Carta Bonus pescata.', 'card');
  if (s.bonusDrawnThisTurn === 1) {
    const ms = Object.values(s.melees).filter((m) => m.startedTurn < s.turn || m.round === 0);
    if (ms.length) {
      ctx.log(`Prima carta Bonus del turno: si combattono ${ms.length} mischie in corso.`, 'combat');
      for (const m of ms) enqueueMelee(s, m.id);
    }
  }
  bonusDiceOff(ctx);
  processMeleeQueue(ctx);
}

function bonusDiceOff(ctx: Ctx) {
  const s = ctx.s;
  const a = ctx.dice.roll(1, 'A', `Spareggio Bonus ${s.players.A.name}`)[0];
  const b = ctx.dice.roll(1, 'B', `Spareggio Bonus ${s.players.B.name}`)[0];
  if (a === b) {
    ctx.log(`Spareggio per il mazzo Bonus: ${a} a ${b}, pareggio: nessuno prende la carta.`, 'card');
    return;
  }
  const w: Side = a > b ? 'A' : 'B';
  const card = s.bonusDeck.shift();
  if (!card) {
    ctx.log('Il mazzo Bonus è vuoto.', 'card');
    return;
  }
  ctx.log(`Spareggio per il mazzo Bonus: ${a} a ${b}. ${s.players[w].name} pesca una carta Bonus (segreta).`, 'card', w);
  if (card.kind === 'special') {
    s.specialDrawCount++;
    if (!s.specialDeck.length) s.specialDeck = buildSpecialDeck(ctx);
    const sc = s.specialDeck.shift()!;
    const def = specialDef(sc.key);
    s.hands[w].push({ id: ctx.newId('h'), kind: 'special', specialKey: sc.key, expiresEndOfTurn: false });
    ctx.log(`${s.players[w].name} pesca una carta Evento Speciale${def.immediate ? ` che va giocata subito: "${def.name}"` : ' (segreta)'}.`, 'card', w);
    if (def.immediate) {
      const enemyMounted = liveLeaders(s, otherSide(w)).filter((l) => l.mounted && !l.unplaced);
      if (!enemyMounted.length) {
        ctx.log(`"${def.name}": nessun comandante nemico a cavallo, la carta non ha effetto.`, 'card', w);
        s.hands[w] = s.hands[w].filter((h) => h.specialKey !== sc.key);
      } else {
        ctx.ask({
          side: w,
          kind: 'horse',
          prompt: `"${def.name}": scegli il comandante nemico a cavallo da disarcionare.`,
          options: enemyMounted.map((l) => ({ value: l.id, label: l.name })),
          ctx: {},
        });
      }
    }
    if (s.specialDrawCount >= 2) ctx.log('La carta Evento Speciale è uscita per la seconda volta: viene tolta dal mazzo Bonus.', 'card');
    return;
  }
  s.hands[w].push({ id: ctx.newId('h'), kind: 'bonus', bonusKind: card.kind, expiresEndOfTurn: true });
}

export function cardLabel(ctx: Ctx, c: PlayCard): string {
  if (c.kind === 'leader') return `Comandante ${ctx.s.leaders[c.leaderId!]?.name ?? ''}`;
  if (c.kind === 'skirmish') return `Schermagliatori e Artiglieria (${ctx.s.players[c.side!].name})`;
  return 'Bonus';
}

// ---------------------------------------------------------------------------
// Fine del turno
// ---------------------------------------------------------------------------

export function eligibleForFreeAction(u: Unit): boolean {
  if (u.removed || u.unplaced || u.daunted || u.meleeId) return false;
  if (isSkirmisher(u) || isArtillery(u)) return false;
  if (u.ordered || u.initiative || u.freeUsed) return false;
  return true;
}

export function beginEndTurn(ctx: Ctx) {
  const s = ctx.s;
  s.phase = 'endTurn';
  s.activation = undefined;
  s.currentCard = undefined;
  const freeDone: Record<Side, boolean> = { A: false, B: false };
  for (const side of ['A', 'B'] as Side[]) {
    const elig = liveUnits(s, side).filter((u) => eligibleForFreeAction(u) && (u.disarray > 0 || u.companies[0].type === 'archers'));
    if (!elig.length) freeDone[side] = true;
  }
  s.endTurn = { freeDone };
  ctx.log('Fine turno – azioni gratuite: le unità non attivate (non Scosse) possono togliere un Disordine o, se Arcieri, tirare una volta.', 'phase');
  maybeFinishEndTurn(ctx);
}

export function maybeFinishEndTurn(ctx: Ctx) {
  const s = ctx.s;
  if (s.phase !== 'endTurn' || !s.endTurn) return;
  if (!s.endTurn.freeDone.A || !s.endTurn.freeDone.B) return;
  if (s.pending.length) return;
  // Test di fine turno, da destra a sinistra.
  const units = liveUnits(s)
    .filter((u) => !u.unplaced)
    .sort((a, b) => b.x - a.x);
  for (const u of units) {
    if (u.removed) continue;
    if (isOver(s)) return;
    if (u.meleeId) continue;
    const half = unitHalfStrength(u);
    if (!u.daunted && !half) continue;
    if (u.wonMeleeThisTurn && !u.lossesAfterWin) continue;
    if (u.daunted) {
      moraleTest(ctx, u, { reason: 'è Scossa (fine turno)', scope: 'unit' });
    } else {
      const idx = u.companies.findIndex((c) => c.figures <= c.maxFigures / 2);
      moraleTest(ctx, u, { reason: 'è a metà forza o meno (fine turno)', companyIdx: Math.max(0, idx), scope: u.companies.length === 2 ? 'company' : 'unit' });
    }
  }
  if (isOver(s)) return;
  // Le carte Bonus non giocate tornano nel mazzo.
  for (const side of ['A', 'B'] as Side[]) {
    const expired = s.hands[side].filter((h) => h.expiresEndOfTurn);
    if (expired.length) ctx.log(`${s.players[side].name} perde ${expired.length} carta/e Bonus non giocate.`, 'card', side);
    s.hands[side] = s.hands[side].filter((h) => !h.expiresEndOfTurn);
  }
  s.turn++;
  s.phase = 'battle';
  s.endTurn = undefined;
  startTurn(ctx);
  ctx.log(`— Turno ${s.turn} — si rimescolano il Mazzo di Gioco e il mazzo Bonus.`, 'phase');
}

function isOver(s: { phase: string }) {
  return s.phase === 'gameOver';
}

export function computeArmyMorale(ctx: Ctx) {
  const s = ctx.s;
  for (const side of ['A', 'B'] as Side[]) {
    let n = 0;
    for (const u of liveUnits(s, side)) for (const c of u.companies) if (countsForArmyMorale(c)) n++;
    s.armyMorale[side] = n;
    s.armyMoraleStart[side] = n;
  }
  ctx.log(`Gettoni Morale d'Armata: ${s.players.A.name} ${s.armyMorale.A}, ${s.players.B.name} ${s.armyMorale.B}.`, 'phase');
}

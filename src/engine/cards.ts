import type { BonusCardKind } from './types';

export interface SpecialEventDef {
  key: string;
  name: string;
  text: string;
  /** Va giocata subito appena pescata. */
  immediate?: boolean;
  /** Il testo della carta non era leggibile nel PDF: effetto da applicare a mano. */
  manual?: boolean;
  /** Richiede di scegliere un bersaglio. */
  target?: 'enemyLeader' | 'enemyMountedLeader' | 'friendlyUnit' | 'enemyUnit' | 'none';
  theatre?: string;
}

export const BONUS_CARDS: Record<BonusCardKind, { name: string; text: string }> = {
  perk: { name: 'Vantaggio', text: "Un'unità non impegnata in mischia compie un'azione gratuita (es. Muovi, Tira, Riordina)." },
  forfeit: { name: 'Penalità', text: "Gioca su un'unità nemica quando riceve un Ordine: in questo turno compie una sola azione invece di due." },
  reroll: { name: 'Ritira', text: 'Ritira immediatamente un dado o un gruppo di dadi che hai appena lanciato.' },
  special: { name: 'Evento Speciale', text: 'Pesca una carta Evento Speciale: puoi giocarla in qualsiasi momento della battaglia.' },
  dummy: { name: 'Nessun effetto', text: "Nessun effetto (non dirlo all'avversario!)." },
};

/** Mazzo Eventi Speciali delle regole base. */
export const SPECIAL_EVENTS: SpecialEventDef[] = [
  {
    key: 'horse',
    name: 'Un cavallo! Un cavallo!',
    text: "Il cavallo di un Comandante nemico montato si imbizzarrisce e lo disarciona: è stordito e fuori azione per il resto del suo turno, e resta a piedi finché non ordina a un'unità di Cavalleria di fornirgli una cavalcatura. Va giocata immediatamente.",
    immediate: true,
    target: 'enemyMountedLeader',
  },
  {
    key: 'rumour',
    name: 'Una voce insistente',
    text: "Gioca su un Comandante nemico in una mischia che continua. Il suo stendardo cade e corre voce che sia morto: le altre unità della sua Schiera prendono un Disordine temporaneo fino alla prossima carta Comandante amica.",
    target: 'enemyLeader',
  },
  {
    key: 'counterfeit',
    name: 'Un falso sfacciato',
    text: "Gioca se il tuo C-in-C viene ferito o ucciso: era solo un sosia con le sue insegne. Il vero comandante non subisce alcun effetto. (L'app la gioca automaticamente quando serve.)",
    target: 'none',
  },
  {
    key: 'ambush',
    name: 'Imboscata',
    text: "Testo della carta non presente nell'estrazione del PDF. Effetto supportato dall'app: l'unità amica scelta, se attacca in questo turno, emerge da un'imboscata e il nemico non può girarsi per fronteggiare un attacco sul fianco o sul retro. Per il resto applicate il testo della vostra carta stampata.",
    target: 'friendlyUnit',
    manual: true,
  },
  {
    key: 'treachery',
    name: 'Tradimento',
    text: "Testo della carta non presente nell'estrazione del PDF: applicate l'effetto della vostra carta stampata usando gli strumenti manuali (modifica unità, sposta, rimuovi).",
    manual: true,
    target: 'enemyUnit',
  },
  {
    key: 'falseColours',
    name: 'Falsi colori',
    text: "Testo della carta non presente nell'estrazione del PDF: applicate l'effetto della vostra carta stampata usando gli strumenti manuali.",
    manual: true,
    target: 'none',
  },
  {
    key: 'fauconberg',
    name: 'Lo stratagemma di Fauconberg',
    text: "Testo della carta non presente nell'estrazione del PDF: applicate l'effetto della vostra carta stampata usando gli strumenti manuali.",
    manual: true,
    target: 'none',
  },
];

export function specialDef(key: string): SpecialEventDef {
  return SPECIAL_EVENTS.find((c) => c.key === key) ?? { key, name: key, text: '', manual: true, target: 'none' };
}

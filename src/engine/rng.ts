import type { DiceRoll, Side } from './types';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Generatore di dadi deterministico. Ogni "lancio" (gruppo di dadi) ha un seme proprio
 * derivato dal seme dell'azione: così la carta Ritira può rilanciare un solo gruppo
 * rigiocando l'azione con un seme diverso per quel gruppo.
 */
export class Dice {
  private group = 0;
  readonly rolls: DiceRoll[] = [];
  constructor(
    private seed: number,
    private overrides: Record<number, number> = {},
  ) {}

  private nextRand(): () => number {
    const g = this.group;
    const s = this.overrides[g] ?? hash(this.seed, g);
    return mulberry32(s);
  }

  /** Lancia n D6 e registra il lancio nel registro. */
  roll(n: number, side: Side, label: string, target?: string): number[] {
    const r = this.nextRand();
    const dice: number[] = [];
    for (let i = 0; i < n; i++) dice.push(1 + Math.floor(r() * 6));
    this.rolls.push({ label, side, dice, target, group: this.group });
    this.group++;
    return dice;
  }

  /** Lancia n D6 e rilancia una volta i risultati indicati (es. gli 1). */
  rollWithReroll(n: number, side: Side, label: string, rerollIf: (v: number) => boolean, target?: string): number[] {
    const r = this.nextRand();
    const first: number[] = [];
    for (let i = 0; i < n; i++) first.push(1 + Math.floor(r() * 6));
    const rerolled: number[] = [];
    const final = first.map((v) => {
      if (rerollIf(v)) {
        const nv = 1 + Math.floor(r() * 6);
        rerolled.push(nv);
        return nv;
      }
      return v;
    });
    this.rolls.push({ label, side, dice: first, rerolled: rerolled.length ? rerolled : undefined, target, group: this.group });
    this.group++;
    return final;
  }

  /** Numero casuale in [0,1) senza registrazione (terreno casuale). */
  random(): () => number {
    const r = this.nextRand();
    this.group++;
    return r;
  }

  /** Mescola senza registrazione (mazzi di carte). */
  shuffle<T>(arr: T[]): T[] {
    const r = this.nextRand();
    this.group++;
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  }
  return Math.floor(Math.random() * 4294967296);
}

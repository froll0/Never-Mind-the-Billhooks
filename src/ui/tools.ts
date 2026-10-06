import type { AreaKind, LineKind, Point } from '../engine/types';

export type Tool =
  | { k: 'none' }
  | { k: 'move'; unitId: string; facing?: number }
  | { k: 'attack'; unitId: string; charge: boolean }
  | { k: 'shoot'; unitId: string; free?: boolean }
  | { k: 'leaderMove'; leaderId: string }
  | { k: 'place'; unitId: string; facing: number }
  | { k: 'placeLeader'; leaderId: string }
  | { k: 'area'; kind: AreaKind; start?: Point }
  | { k: 'line'; kind: LineKind; points: Point[] }
  | { k: 'defence'; kind: 'stakes' | 'fieldDefence'; points: Point[] }
  | { k: 'measure'; start?: Point }
  | { k: 'manualMove'; unitId?: string; leaderId?: string }
  | { k: 'pickUnit'; purpose: 'perk' | 'forfeit' | 'ambush' | 'join' | 'formBlock' | 'special' | 'attackLeader'; handId?: string; unitId?: string; enemy?: boolean }
  | { k: 'pickLeader'; purpose: 'rumour' | 'attackLeader'; handId?: string; unitId?: string }
  | { k: 'pickFeature'; purpose: 'delete' | 'chopHedge'; unitId?: string };

export type Selection = { kind: 'unit'; id: string } | { kind: 'leader'; id: string } | null;

export const AREA_NAMES: Record<AreaKind, string> = {
  wood: 'Bosco',
  hill: 'Collina',
  steepHill: 'Collina ripida',
  marsh: 'Palude',
  building: 'Edificio',
  builtUp: 'Abitato',
};

export const LINE_NAMES: Record<LineKind, string> = {
  hedge: 'Siepe',
  wall: 'Muro',
  stream: 'Torrente',
  fence: 'Staccionata',
  stakes: 'Pali',
  fieldDefence: 'Difese campali',
};

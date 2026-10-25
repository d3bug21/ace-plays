import type { Stage, StageInfo, ObjectiveDef } from './types';
import * as meadow from './meadow';
import * as dino from './dino';
import * as coral from './coral';
import * as trench from './trench';
import * as frosty from './frosty';

export interface StageMeta {
  info: StageInfo;
  objectives: ObjectiveDef[];
  /** Intro card gradient (inner, outer) - muted. */
  introColors: [string, string];
}

export interface StageEntry extends StageMeta {
  id: string;
  factory: () => Stage;
}

interface StageModule {
  meta: StageMeta;
  create: () => Stage;
}

const mods: StageModule[] = [meadow, dino, coral, trench, frosty];

/** Stages in adventure order. Each unlocks when the previous one is completed. */
export const STAGES: StageEntry[] = mods.map((m) => ({ id: m.meta.info.id, ...m.meta, factory: m.create }));

export function stageIndex(id: string): number {
  return STAGES.findIndex((s) => s.id === id);
}

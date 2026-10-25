import type { ObjectiveDef } from '../stages/types';

export interface ObjectiveState {
  def: ObjectiveDef;
  count: number;
  done: boolean;
}

type Listener = (o: ObjectiveState, justCompleted: boolean) => void;

/**
 * Tracks stage objectives. Main objectives form a sequence; only the first
 * unfinished main objective is "current". Treasures and the challenge can be
 * done at any time and award the second and third star.
 */
export class ObjectiveTracker {
  readonly list: ObjectiveState[] = [];
  private listeners: Listener[] = [];
  private byId = new Map<string, ObjectiveState>();

  reset(defs: ObjectiveDef[]): void {
    this.list.length = 0;
    this.byId.clear();
    for (const def of defs) {
      const s = { def, count: 0, done: false };
      this.list.push(s);
      this.byId.set(def.id, s);
    }
    this.listeners.length = 0;
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  get(id: string): ObjectiveState | undefined {
    return this.byId.get(id);
  }

  /** The first unfinished main objective (what Ace should do next). */
  current(): ObjectiveState | null {
    for (const o of this.list) if (o.def.kind === 'main' && !o.done) return o;
    return null;
  }

  isCurrent(id: string): boolean {
    return this.current()?.def.id === id;
  }

  isDone(id: string): boolean {
    return !!this.byId.get(id)?.done;
  }

  /** Add progress. Main objectives only accept progress once they are current. */
  add(id: string, amount = 1): boolean {
    const o = this.byId.get(id);
    if (!o || o.done) return false;
    if (o.def.kind === 'main' && !this.isCurrent(id)) return false;
    o.count = Math.min(o.def.target, o.count + amount);
    const completed = o.count >= o.def.target;
    if (completed) o.done = true;
    for (const l of this.listeners) l(o, completed);
    return completed;
  }

  /** Set absolute progress (e.g. number of lanterns currently lit). */
  set(id: string, count: number): boolean {
    const o = this.byId.get(id);
    if (!o || o.done) return false;
    if (o.def.kind === 'main' && !this.isCurrent(id)) return false;
    const n = Math.min(o.def.target, Math.max(0, count));
    if (n === o.count) return false;
    return this.add(id, n - o.count);
  }

  complete(id: string): boolean {
    const o = this.byId.get(id);
    if (!o || o.done) return false;
    return this.add(id, o.def.target - o.count);
  }

  mainDone(): boolean {
    return this.list.filter((o) => o.def.kind === 'main').every((o) => o.done);
  }

  treasuresDone(): boolean {
    const t = this.list.filter((o) => o.def.kind === 'treasure');
    return t.length > 0 && t.every((o) => o.done);
  }

  challengeDone(): boolean {
    const t = this.list.filter((o) => o.def.kind === 'challenge');
    return t.length > 0 && t.every((o) => o.done);
  }

  stars(): [boolean, boolean, boolean] {
    return [this.mainDone(), this.treasuresDone(), this.challengeDone()];
  }
}

/**
 * AdapterUndoScope — DSH-inspired revertible effects for adapter slots.
 *
 * When an adapter slot is mounted, it registers the side effects it performs
 * (free-pass state, pending approvals, endpoint files, subscriptions).
 * `undoAll()` replays them in reverse order, so removing one adapter can
 * never corrupt another adapter's state (temporal composability).
 *
 * Each effect has a stable name for diagnostics and future reward
 * attribution; the scope tracks what it has undone.
 */

export type UndoEffect = {
  name: string;
  undo: () => void | Promise<void>;
};

export class AdapterUndoScope {
  private readonly effects: UndoEffect[] = [];
  private undone = false;

  /** Register a side effect with its inverse operation. */
  effect(name: string, undo: () => void | Promise<void>): void {
    if (this.undone) {
      throw new Error(`AdapterUndoScope: cannot register "${name}" after undo`);
    }
    this.effects.push({ name, undo });
  }

  /** Number of registered effects (for diagnostics). */
  get size(): number {
    return this.effects.length;
  }

  /** Registered effect names, in registration order. */
  names(): string[] {
    return this.effects.map((effect) => effect.name);
  }

  /** Undo every registered effect in reverse registration order. */
  async undoAll(): Promise<string[]> {
    if (this.undone) {
      return [];
    }
    this.undone = true;
    const undone: string[] = [];
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      if (!effect) {
        continue;
      }
      try {
        await effect.undo();
        undone.push(effect.name);
      } catch (error) {
        // Best-effort undo: a failing inverse must not block the rest.
        undone.push(`${effect.name}(error:${error instanceof Error ? error.message : String(error)})`);
      }
    }
    return undone;
  }
}

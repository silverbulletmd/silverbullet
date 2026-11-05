export type ReloadingStoreDeps<T> = {
  load: () => Promise<T>;
  subscribeReload: (changed: () => void) => () => void;
  onDirty?: (dirty: boolean) => void;
};

/**
 * A Workbench tab's state that loads on its first subscriber and follows
 * reloads while any remain. Only the latest load lands; a failed one leaves
 * what was loaded before and records `loadError`.
 */
export abstract class ReloadingStore<T> {
  loadError?: string;
  private listeners = new Set<() => void>();
  private stopReload?: () => void;
  private loads = 0;
  private wasDirty = false;

  constructor(private store: ReloadingStoreDeps<T>) {}

  get dirty(): boolean {
    return false;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.stopReload = this.store.subscribeReload(() => void this.load());
      void this.load();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopReload?.();
        this.stopReload = undefined;
        this.stopped();
      }
    };
  }

  protected get subscribed(): boolean {
    return this.listeners.size > 0;
  }

  /** Takes a load's result; it is the latest one. Must emit. */
  protected abstract loaded(value: T): void;

  protected loadErrorMessage(e: any): string {
    return e?.message ?? String(e);
  }

  protected stopped(): void {}

  protected async load(): Promise<void> {
    const n = ++this.loads;
    let value: T;
    try {
      value = await this.store.load();
    } catch (e: any) {
      if (n !== this.loads) return;
      this.loadError = this.loadErrorMessage(e);
      this.emit();
      return;
    }
    if (n !== this.loads) return;
    this.loadError = undefined;
    this.loaded(value);
  }

  protected emit(): void {
    const dirty = this.dirty;
    if (dirty !== this.wasDirty) {
      this.wasDirty = dirty;
      this.store.onDirty?.(dirty);
    }
    for (const listener of this.listeners) listener();
  }
}

export class LoadingState {
  pending = false;
  visible = false;
  private token = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  begin(): { isCurrent: () => boolean; finish: () => void } {
    const token = ++this.token;
    if (!this.pending) {
      this.pending = true;
      this.timer = setTimeout(() => {
        this.visible = true;
        this.notify();
      }, 150);
      this.notify();
    }
    return {
      isCurrent: () => token === this.token,
      finish: () => {
        if (token === this.token) this.settle();
      },
    };
  }

  cancel(): void {
    this.token++;
    this.settle();
  }

  private settle(): void {
    clearTimeout(this.timer);
    if (!this.pending) return;
    this.pending = false;
    this.visible = false;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

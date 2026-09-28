import type { CaptureStore } from "./store.ts";
import type { CaptureRecord } from "./types.ts";

export class CaptureInvocationContext {
  private active?: CaptureRecord;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private store: CaptureStore,
    private ownerId: string,
  ) {}

  async run<T>(capture: CaptureRecord, action: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    try {
      const stored = await this.store.get(capture.id, this.ownerId);
      if (!stored || capture.ownerId !== this.ownerId) {
        throw new Error("Capture is unavailable");
      }
      this.active = stored;
      return await action();
    } finally {
      this.active = undefined;
      release();
    }
  }

  async readFile(handle: string): Promise<Blob> {
    const capture = this.active;
    if (!capture?.files.some((file) => file.handle === handle)) {
      throw new Error("Capture file is unavailable");
    }
    return this.store.readFile(capture.id, handle, this.ownerId);
  }
}

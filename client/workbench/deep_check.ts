import type { LintOptions, SpaceLintDiagnostic } from "../space_lint.ts";
import { errorMessage } from "./value_preview.ts";

export type DeepCheckState =
  | { kind: "idle" }
  | {
      kind: "running";
      done: number;
      total: number;
      page: string;
      found: SpaceLintDiagnostic[];
    }
  | {
      kind: "done";
      found: SpaceLintDiagnostic[];
      pages: number;
      ms: number;
      at: number;
      cancelled: boolean;
      error?: string;
    };

/** Runs the space-wide lint on demand, reporting progress and keeping the last result. */
export class DeepCheck {
  state: DeepCheckState = { kind: "idle" };
  private listeners = new Set<(s: DeepCheckState) => void>();
  private controller: AbortController | undefined;

  constructor(
    private lint: (opts: LintOptions) => Promise<SpaceLintDiagnostic[]>,
  ) {}

  onChange(fn: (s: DeepCheckState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(s: DeepCheckState) {
    this.state = s;
    for (const fn of [...this.listeners]) fn(s);
  }

  async run(): Promise<void> {
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    const started = Date.now();
    let done = 0;
    let total = 0;
    // Progress carries only each page's findings, so accumulate them here.
    const acc: SpaceLintDiagnostic[] = [];
    let found: SpaceLintDiagnostic[] = [];
    let error: string | undefined;
    try {
      this.set({ kind: "running", done: 0, total: 0, page: "", found: [] });
      found = await this.lint({
        signal: controller.signal,
        onProgress: (p) => {
          done = p.done;
          total = p.total;
          acc.push(...p.found);
          this.set({
            kind: "running",
            done: p.done,
            total: p.total,
            page: p.page,
            found: [...acc],
          });
        },
      });
    } catch (e) {
      found = acc;
      error = errorMessage(e);
    } finally {
      this.controller = undefined;
    }
    const cancelled = controller.signal.aborted;
    this.set({
      kind: "done",
      found,
      pages: cancelled ? done : total,
      ms: Date.now() - started,
      at: Date.now(),
      cancelled,
      ...(error === undefined ? {} : { error }),
    });
  }

  cancel(): void {
    this.controller?.abort();
  }
}

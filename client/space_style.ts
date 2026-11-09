import type { Client } from "./client.ts";
import type { ToolBlock } from "./tooling.ts";

/**
 * A `space-style` block in the last load. `rules`: how many top-level rules
 * the browser parsed from it.
 */
export type StyleRecord = {
  ref: string;
  source: string;
  priority: number;
  rules: number;
};

/** One load of the space's styles, in the order they apply. */
export type StyleLoad = { styles: StyleRecord[]; loadedAt: number };

/** Applies the space's `space-style` blocks, highest priority first, and records how the last load went. */
export class SpaceStyles {
  /** The last completed load, replaced whole once a load finishes. */
  lastLoad: StyleLoad | undefined;
  private listeners = new Set<(load: StyleLoad) => void>();

  constructor(private client: Client) {}

  onLoad(fn: (load: StyleLoad) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Applies `spaceStyles`, which come already in load order. */
  load(spaceStyles: ToolBlock[]): void {
    const { client } = this;
    if (client.bootConfig.disableSpaceStyle) {
      console.warn("Not loading custom styles, since space style is disabled");
      return;
    }

    const customStylesContent = spaceStyles
      .map((s) => `<style>${s.code}</style>`)
      .join("\n\n");
    client.ui.viewDispatch({
      type: "set-ui-option",
      key: "customStyles",
      value: customStylesContent,
    });
    const container = document.getElementById("custom-styles")!;
    container.innerHTML = customStylesContent;

    // One <style> per block, in the same order
    const sheets = container.querySelectorAll("style");
    this.lastLoad = {
      styles: spaceStyles.map((s, i) => ({
        ref: s.ref,
        source: s.code,
        priority: s.priority,
        rules: sheets[i]?.sheet?.cssRules.length ?? 0,
      })),
      loadedAt: Date.now(),
    };
    for (const fn of this.listeners) fn(this.lastLoad);
  }
}

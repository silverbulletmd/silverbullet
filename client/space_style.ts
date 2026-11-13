import { themeBlocks } from "@silverbulletmd/silverbullet/lib/themes";
import type { Client } from "./client.ts";
import { THEME_STYLE_ID, updateThemeColor } from "./space_theme.ts";
import type { ToolBlock } from "./tooling.ts";

/**
 * A `space-style` block in the last load. `rules`: how many top-level rules
 * the browser parsed from it. A block of a theme page has `theme` (its page)
 * and `themeName`; `active` is false for one whose theme isn't applied, which
 * is never parsed, so its `rules` is 0.
 */
export type StyleRecord = {
  ref: string;
  source: string;
  priority: number;
  rules: number;
  theme?: string;
  themeName?: string;
  active: boolean;
};

/** One load of the space's styles, in the order they apply. */
export type StyleLoad = { styles: StyleRecord[]; loadedAt: number };

/** Applies the space's `space-style` blocks, highest priority first, and records how the last load went. */
export class SpaceStyles {
  /**
   * The last completed load, replaced whole once a load finishes or the theme
   * changes. In load order: the applied theme blocks (built-in base first),
   * the ordinary styles, then the blocks of themes that aren't applied.
   */
  lastLoad: StyleLoad | undefined;
  private listeners = new Set<(load: StyleLoad) => void>();

  /** The blocks of the last load, `client.tooling`'s at the time. */
  private loaded: ToolBlock[] | undefined;

  constructor(private client: Client) {}

  onLoad(fn: (load: StyleLoad) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Applies `client.tooling`'s styles, which come already in load order.
   * Call it once the theme is applied: the record reads its sheets.
   */
  load(): void {
    const { client } = this;
    if (client.bootConfig.disableSpaceStyle) {
      console.warn("Not loading custom styles, since space style is disabled");
      return;
    }

    const styles = client.tooling?.styles ?? [];
    const content = styles.map((s) => `<style>${s.code}</style>`).join("\n\n");
    // Panels put this in their HTML (see `panelStyles()`). The theme's
    // `#sb-theme` container stays empty: an iframe fills it from its `html`
    // and `theme` messages. `hidden` keeps it out of the layout.
    client.ui?.viewDispatch({
      type: "set-ui-option",
      key: "customStyles",
      value: `<div id="${THEME_STYLE_ID}" hidden></div>${content}`,
    });
    document.getElementById("custom-styles")!.innerHTML = content;
    // A space style may recolor the top bar
    updateThemeColor();

    this.loaded = styles;
    this.record();
  }

  /** The theme on screen changed: the record's theme blocks follow it. */
  themeChanged(): void {
    if (this.loaded) this.record();
  }

  private record(): void {
    const styles = this.loaded!;
    const { tooling } = this.client;
    const sheets = document
      .getElementById("custom-styles")!
      .querySelectorAll("style");
    const ordinary: StyleRecord[] = styles.map((s, i) => ({
      ref: s.ref,
      source: s.code,
      priority: s.priority,
      rules: sheets[i]?.sheet?.cssRules.length ?? 0,
      active: true,
    }));

    const themes = tooling?.themes ?? [];
    const themeRecord = (b: ToolBlock, rules: number, active: boolean) => ({
      ref: b.ref,
      source: b.code,
      priority: b.priority,
      rules,
      theme: b.page,
      themeName:
        themes.find((t) => t.page === b.page)?.displayName ??
        b.page.split("/").pop(),
      active,
    });
    const shown = this.client.spaceTheme.active;
    const all = tooling?.themeStyles ?? [];
    // Without a shown theme nothing is known to apply, so no theme rows yet
    const applied = shown ? themeBlocks(shown, all) : [];
    // One <style> per applied block, in the same order
    const themeSheets = document
      .getElementById(THEME_STYLE_ID)
      ?.querySelectorAll<HTMLStyleElement>("style:not([data-sb-accent])");
    const appliedRecords = applied.map((b, i) =>
      themeRecord(b, themeSheets?.[i]?.sheet?.cssRules.length ?? 0, true),
    );
    const inactive = shown
      ? all
          .filter((b) => !applied.includes(b))
          .map((b) => themeRecord(b, 0, false))
      : [];

    this.lastLoad = {
      styles: [...appliedRecords, ...ordinary, ...inactive],
      loadedAt: Date.now(),
    };
    for (const fn of this.listeners) fn(this.lastLoad);
  }
}

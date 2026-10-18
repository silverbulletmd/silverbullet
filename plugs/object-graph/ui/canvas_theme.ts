/**
 * The graph canvas's colors and font, read from the panel's theme tokens.
 * Canvas takes neither `var()` nor (everywhere) `color-mix()`, so every color
 * is resolved to a plain one, and read again whenever the theme changes.
 */
export type Theme = {
  font: string;
  bg: string;
  nodeDim: string;
  label: string;
  labelDim: string;
  labelHalo: string;
  link: string;
  linkDim: string;
  linkHot: string;
  accent: string;
  accentSoft: string;
};

export class CanvasTheme {
  tokens: Theme = readTheme();
  // Node colors (tag colors, `var()` fallbacks) resolved for the canvas
  private colors = new Map<string, string>();

  constructor(private onChange: () => void) {
    this.refresh = this.refresh.bind(this);
  }

  /** `value` (any CSS color, tokens included) as a plain color */
  color(value: string): string {
    let c = this.colors.get(value);
    if (c === undefined) {
      c = resolveColor(value);
      this.colors.set(value, c);
    }
    return c;
  }

  /** Follows theme changes until the returned stop is called */
  watch(): () => void {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener?.("change", this.refresh);
    // The theme's tokens and font arrive with stylesheets that load after
    // mount, and SilverBullet switches the theme through `data-theme`
    const links = [...document.querySelectorAll("link[rel=stylesheet]")];
    for (const link of links) link.addEventListener("load", this.refresh);
    const observer = new MutationObserver(this.refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    let stopped = false;
    void document.fonts?.ready.then(() => {
      if (!stopped) this.refresh();
    });
    return () => {
      stopped = true;
      mql.removeEventListener?.("change", this.refresh);
      for (const link of links) link.removeEventListener("load", this.refresh);
      observer.disconnect();
    };
  }

  private refresh() {
    this.tokens = readTheme();
    this.colors.clear();
    this.onChange();
  }
}

// Lets the browser resolve a token to a plain color
let probe: HTMLElement | null = null;
function resolveColor(value: string): string {
  if (!probe) {
    probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
  }
  probe.style.color = "";
  probe.style.color = value;
  return getComputedStyle(probe).color || value;
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fallback: string) =>
    resolveColor(cs.getPropertyValue(n).trim() || fallback);
  return {
    bg: v("--gv-bg", "#ffffff"),
    font: cs.getPropertyValue("--ui-font").trim() || "system-ui, sans-serif",
    nodeDim: v("--gv-node-dim", "#9e4705"),
    label: v("--gv-label", "#333"),
    labelDim: v("--gv-label-dim", "#676767"),
    labelHalo: v("--gv-label-halo", "rgba(255,255,255,0.78)"),
    link: v("--gv-link", "#c8c8c8"),
    linkDim: v("--gv-link-dim", "#e6e6e6"),
    linkHot: v("--gv-link-hot", "#464cfc"),
    accent: v("--gv-accent", "#464cfc"),
    accentSoft: v("--gv-accent-soft", "rgba(70,76,252,0.16)"),
  };
}

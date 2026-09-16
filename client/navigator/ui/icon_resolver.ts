import { icon } from "@silverbulletmd/silverbullet/syscalls";
import { createSvgNode, parseIcon } from "../../lib/icon.ts";

export class IconResolver {
  private iconCache = new Map<string, string | undefined>();
  private nodeCache = new Map<string, Element | undefined>();
  private warnedPrefixes = new Set<string>();
  private warnedIconResolveFailure = false;

  iconNode(icon: string | undefined): Element | undefined {
    if (!icon) return undefined;
    const parsed = parseIcon(icon);
    let svg: string | undefined;
    if (parsed.kind === "svg") {
      svg = parsed.markup;
    } else if (parsed.kind === "feather") {
      svg = this.iconCache.get(parsed.name);
    } else if (parsed.kind === "unknown") {
      this.warnUnknownPrefix(parsed.prefix);
    }
    if (!svg) return undefined;
    if (this.nodeCache.has(svg)) return this.nodeCache.get(svg);
    const node = createSvgNode(svg);
    this.nodeCache.set(svg, node);
    return node;
  }

  async resolveIcons(icons: (string | undefined)[]): Promise<void> {
    const missing = [
      ...new Set(
        icons
          .filter((icon): icon is string => !!icon)
          .map((icon) => parseIcon(icon))
          .filter(
            (p): p is { kind: "feather"; name: string } => p.kind === "feather",
          )
          .map((p) => p.name)
          .filter((name) => !this.iconCache.has(name)),
      ),
    ];
    if (missing.length === 0) return;
    if (this.warnedIconResolveFailure) {
      for (const name of missing) this.iconCache.set(name, undefined);
      return;
    }
    try {
      const resolved = await icon.resolveFeather(missing);
      for (const name of missing) this.iconCache.set(name, resolved?.[name]);
    } catch (e) {
      for (const name of missing) this.iconCache.set(name, undefined);
      if (!this.warnedIconResolveFailure) {
        this.warnedIconResolveFailure = true;
        console.warn(
          "navigator: icon resolution failed, rendering without icons",
          e,
        );
      }
    }
  }

  private warnUnknownPrefix(prefix: string): void {
    if (this.warnedPrefixes.has(prefix)) return;
    this.warnedPrefixes.add(prefix);
    console.error(`navigator: unknown icon namespace "${prefix}:"`);
  }
}

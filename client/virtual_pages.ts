import { patternMatch } from "./space_lua/stdlib/pattern.ts";
import type { Client } from "./client.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

type VirtualPageDef = {
  pattern: string;
  run: (...args: any[]) => Promise<string> | string;
};

export type VirtualPageResult = {
  doc: { text: string; meta: PageMeta };
  markerIndex: number;
};

const CURSOR_MARKER = "|^|";

/**
 * Resolve a page name through `config.virtualPages`
 * (populated by `virtualPage.define`)
 */
export async function resolveVirtualPage(
  client: Client,
  pageName: string,
): Promise<VirtualPageResult | null> {
  const defs = client.config.get<Record<string, VirtualPageDef>>(
    "virtualPages",
    {},
  );

  for (const def of Object.values(defs)) {
    const captures = patternMatch(pageName, def.pattern);
    if (!captures) continue;

    const args = captures.map((c) => ("s" in c ? c.s : c.position));
    const text = await def.run(...args);
    if (typeof text !== "string") {
      throw new Error(
        `virtualPage \`${def.pattern}\` returned ${typeof text}, expected string`,
      );
    }

    const idx = text.indexOf(CURSOR_MARKER);
    return {
      doc: {
        text: idx === -1
          ? text
          : text.slice(0, idx) + text.slice(idx + CURSOR_MARKER.length),
        meta: {
          ref: pageName,
          tags: ["page"],
          name: pageName,
          lastModified: "",
          created: "",
          perm: "ro",
        } as PageMeta,
      },
      markerIndex: idx,
    };
  }
  return null;
}

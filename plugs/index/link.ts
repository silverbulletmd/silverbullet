import { encodeRef } from "@silverbulletmd/silverbullet/lib/ref";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";

// The legacy `link` indexer has been retired in favor of `relation`.

// For projection only
export type LinkObject = ObjectValue<{
  page: string;
  pos: number;
  type: "page" | "file" | "url";
  snippet: string;
  alias?: string;
  pageLastModified: string;
  /** Complete ref to the destination, except for URLs (verbatim). */
  destination: string;
  /** Page link. */
  toPage?: string;
  /** File link. */
  toFile?: string;
  /** External URL. */
  toURL?: string;
}>;

/**
 * Project a `relation` record into the legacy `link` shape. Returns
 * `undefined` for relations with no `link` representation (`co-mention`).
 * The link `type` is derived from the target axis (`toTag`), not `kind`.
 */
export function relationToLink(rel: any): LinkObject | undefined {
  if (!rel || typeof rel !== "object") return undefined;
  if (rel.kind === "co-mention") return undefined;

  const type: LinkObject["type"] =
    rel.toTag === "url" ? "url" : rel.toTag === "document" ? "file" : "page";

  const pos: number | undefined = Array.isArray(rel.range)
    ? rel.range[0]
    : undefined;
  if (typeof pos !== "number") return undefined;

  const link: LinkObject = {
    ref: rel.ref,
    tag: "link",
    type,
    page: rel.page,
    pos,
    range: rel.range,
    snippet: rel.snippet ?? "",
    pageLastModified: rel.pageLastModified,
    destination: "",
  };

  if (type === "url") {
    link.toURL = rel.to;
    link.destination = rel.to;
  } else if (type === "file") {
    link.toFile = rel.to;
    link.destination = encodeRef({ path: rel.to });
  } else {
    link.toPage = rel.to;
    link.destination = encodeRef({ path: `${rel.to}.md` });
  }

  if (rel.alias) link.alias = rel.alias;
  if (Array.isArray(rel.itags)) {
    (link as any).itags = [
      ...new Set<string>(
        rel.itags.map((t: string) => (t === "relation" ? "link" : t)),
      ),
    ];
  }
  return link;
}

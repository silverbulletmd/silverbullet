import {
  getNameFromPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";

/** What a wiki link to `target` points at: a page's name, another object's ref, or a string as is */
function linkTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target || undefined;
  if (target && typeof target === "object") {
    const o = target as Record<string, unknown>;
    if (o.tag === "page" && typeof o.name === "string") return o.name;
    if (typeof o.ref === "string") return o.ref;
    if (typeof o.name === "string") return o.name;
  }
  return undefined;
}

/**
 * The text a link to `to` shows without an alias: for a position in a page
 * (`Page@123`, `Page@L4C2`) the page's name, since the number means nothing
 * to a reader; otherwise none, so the target shows as written.
 */
export function cleanLinkLabel(to: string): string | undefined {
  const ref = parseToRef(to);
  if (
    ref?.path &&
    (ref.details?.type === "position" || ref.details?.type === "linecolumn")
  ) {
    return getNameFromPath(ref.path);
  }
  return undefined;
}

/**
 * `[[target]]` or `[[target|alias]]`; undefined when there's nothing to link
 * to. A link to a position in a page shows the page's name unless an alias is
 * given.
 */
export function wikiLink(target: unknown, alias?: string): string | undefined {
  const to = linkTarget(target);
  if (!to) return undefined;
  const label = alias || cleanLinkLabel(to);
  return label ? `[[${to}|${label}]]` : `[[${to}]]`;
}

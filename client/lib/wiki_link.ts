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

/** `[[target]]` or `[[target|alias]]`; undefined when there's nothing to link to */
export function wikiLink(target: unknown, alias?: string): string | undefined {
  const to = linkTarget(target);
  if (!to) return undefined;
  return alias ? `[[${to}|${alias}]]` : `[[${to}]]`;
}

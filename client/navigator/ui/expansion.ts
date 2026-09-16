import type { ViewMeta } from "../types.ts";

/**
 * Where a view's tree state is persisted, or `undefined` for a view whose
 * state is not persisted at all (`expansionScope: "page"` -- see `ViewMeta`).
 *
 * Two keys rather than one, because under `expandAll` the stored set means the
 * opposite thing -- the folders the user *closed* -- and reading one as the
 * other would invert a whole tree the first time a view flipped the flag.
 *
 * The `["navigator", …]` namespace is the navigator's own datastore convention
 * (the same one `activation.ts` uses for the remembered segment), which is
 * why this stays navigator-side rather than in the shared tree model.
 */
export function expansionKey(
  view: string,
  meta: Pick<ViewMeta, "expandAll" | "expansionScope" | "ephemeral">,
): string[] | undefined {
  if (meta.expansionScope === "page") return undefined;
  // A `navigator.pick` view: no key at all, the same "zero persistence" rule
  // the remembered segment follows (see `commands.ts`'s `pickSegment`).
  if (meta.ephemeral) return undefined;
  return ["navigator", view, meta.expandAll ? "collapsed" : "expanded"];
}

export function inlineExpansionKey(
  pageName: string,
  stateKey: string | undefined,
  expandAll: boolean,
): string[] | undefined {
  if (!stateKey) return undefined;
  return [
    "navigator",
    "inline",
    pageName,
    stateKey,
    expandAll ? "collapsed" : "expanded",
  ];
}

export function createInlineExpansion(
  key: string[] | undefined,
  store: {
    get(key: string[]): Promise<unknown>;
    set(key: string[], value: string[]): Promise<unknown>;
  },
  onChange: () => void,
) {
  let live = true;
  let dirty = false;
  let ready = !key;
  let expanded = new Set<string>();
  let writes = Promise.resolve();

  return {
    get ready() {
      return ready;
    },
    get expanded() {
      return expanded;
    },
    async load() {
      if (!key) return;
      try {
        const saved = await store.get(key);
        if (!live || dirty) return;
        expanded = new Set(
          Array.isArray(saved)
            ? saved.filter((path): path is string => typeof path === "string")
            : [],
        );
      } catch (error) {
        if (live)
          console.error("navigator: could not restore inline expansion", error);
      } finally {
        if (live && !ready) {
          ready = true;
          onChange();
        }
      }
    },
    toggle(path: string) {
      if (!live) return;
      dirty = true;
      const next = new Set(expanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      expanded = next;
      onChange();
      if (key) {
        const snapshot = [...next];
        writes = writes
          .then(() => store.set(key, snapshot))
          .then(
            () => {},
            (error) =>
              console.error(
                "navigator: could not persist inline expansion",
                error,
              ),
          );
      }
    },
    flush() {
      return writes;
    },
    dispose() {
      live = false;
    },
  };
}

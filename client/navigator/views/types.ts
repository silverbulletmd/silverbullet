import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { Decoration, Row, ViewMeta } from "../ui/types.ts";

// Re-exported so views importing shapes from "./types.ts" don't also need
// "../ui/types.ts" directly.
export type { Decoration, Row, ViewMeta };

/**
 * Every built-in's row object is genuinely an indexed `ObjectValue` (`ref`
 * and `tag` guaranteed) unless a view says otherwise by supplying its own
 * `T`. `Record<string, any>`, not the bare default, because `ObjectValue`'s
 * own default type parameter is `any` -- and `X & any` collapses to `any`,
 * silently dropping the `ref`/`tag` guarantee this exists to keep. Loosely
 * typed for anything past `ref`/`tag`, same as the `Obj` alias this replaces
 * was for everything.
 */
export type RowSpec<T = ObjectValue<Record<string, any>>> = {
  primary?: (obj: T) => string;
  /** Tree mode: what a row reads as in place of its last path segment. */
  label?: (obj: T) => string | undefined;
  description?: (obj: T) => string | undefined;
  decorations?: (obj: T) => Decoration[] | undefined;
  cssClass?: (obj: T) => string | undefined;
  icon?: (obj: T) => string | undefined;
};

export type Segment<T = ObjectValue<Record<string, any>>> = {
  label: string;
  icon?: string;
  prefix?: string;
  placeholder?: string;
  default?: boolean;
  where?: (obj: T) => boolean;
};

export type ActionSpec<T = ObjectValue<Record<string, any>>> = {
  icon?: string;
  label: string;
  requireMode?: "rw";
  when?: (obj: T) => boolean;
  run: (obj: T) => Promise<any> | any;
};

export type BuiltinView<T = ObjectValue<Record<string, any>>> = {
  meta: Omit<ViewMeta, "segments" | "name"> & { segments?: never };
  segments?: Segment<T>[];
  actions?: ActionSpec<T>[];
  row: RowSpec<T>;
  source: () => Promise<T[]>;
  /** @returns `false` to keep the panel open (see the Lua `onSelect` docs). */
  onSelect: (obj: T, ctx: { from?: string }) => Promise<any>;
  onCreate?: (phrase: string) => Promise<any>;
  /** Keyed by `KeyboardEvent.key`; see `navigator.define`'s `keymap` field. */
  keymap?: Record<string, (obj: T) => Promise<any> | any>;
  onMove?: (obj: T, newName: string) => Promise<any>;
};

/** Re-run the source when the index has something new to say -- what every
 * file-backed built-in (a picker or tree over the space) declares itself,
 * since `baseMeta`'s own default is no events. */
export const INDEX_REFRESH_EVENTS = [
  "file:changed",
  "file:deleted",
  "mq:emptyQueue:indexQueue",
];

/** Everything a view leaves at its defaults, so each one only says what differs. */
export function baseMeta(over: Partial<ViewMeta>): BuiltinView["meta"] {
  return {
    title: over.title ?? "",
    mode: "list",
    dock: "modal",
    hierarchy: { field: "name", separator: "/" },
    foldersFirst: true,
    expandAll: false,
    expansionScope: "view",
    followEditor: false,
    refreshOn: [],
    hasMove: false,
    hasCreate: false,
    refreshOnOpen: false,
    limit: 200,
    search: "client",
    hasRowIcon: true,
    pathCompletion: false,
    hashtagFilter: false,
    ...over,
  } as BuiltinView["meta"];
}

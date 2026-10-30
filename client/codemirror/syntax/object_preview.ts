import { redo, undo } from "@codemirror/commands";
import {
  type EditorState,
  MapMode,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import { cleanupJSON } from "@silverbulletmd/silverbullet/lib/json";
import { patchYaml } from "../../../plugs/index/object_edit.ts";
import {
  yamlTopLevelEntries,
  yamlTopLevelKeys,
} from "../../../plug-api/lib/yaml_source.ts";
import type { Client } from "../../client.ts";
import { callWithTracking } from "../../space_lua/runtime.ts";
import { luaDefinitionRef } from "../../space_lua.ts";
import { decoratorStateField, widgetRenderMode } from "../util.ts";
import { LuaWidget, type LuaWidgetContent } from "../widgets/lua_widget.ts";
import { selectionIntersectsRange } from "./frontmatter_block.ts";

export type YamlType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "null"
  | "array"
  | "object";

/**
 * What kind of object a preview shows. Each kind has its own tag hook
 * (`renderFrontmatter`, `renderDataBlock`) and root tag (`page`, `data`).
 */
export type PreviewKind = "page" | "data";

export type YamlContext = {
  /** Parsed YAML; date-only timestamps as YYYY-MM-DD strings, timestamps with a time as ISO strings, tags not normalized */
  values: Record<string, unknown>;
  /** Taken from the value before cleanupJSON, so a Date is "date" */
  types: Record<string, YamlType>;
  /** Top-level keys in YAML order */
  keys: string[];
};

export type ObjectContext = YamlContext & {
  kind: PreviewKind;
  readOnly: boolean;
  /** Writes one attribute of the object, wherever it is in the page now */
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  /** Moves a top-level key `delta` places (-1 up, 1 down) in the YAML */
  move: (key: string, delta: number) => Promise<void>;
  /** Adds an empty item after this one; only the last, non-empty data item */
  addItem?: () => Promise<void>;
};

export type ObjectRenderer = (
  object: Record<string, unknown>,
  context: ObjectContext,
) => LuaWidgetContent | Promise<LuaWidgetContent>;

/** One object a preview shows, rendered on its own */
export type PreviewObject = {
  /** Which of the host's documents holds it */
  index: number;
  object: Record<string, unknown>;
  context: YamlContext;
};

/** Where one object's YAML is in the current document */
export type LiveDocument = {
  from: number;
  text: string;
  /** An item added with "+ add item": not in the page until its first value */
  added?: boolean;
};

/** Shows an unwritten item in the preview starting here; null hides it */
export const setAddedItem = StateEffect.define<number | null>();

/**
 * Where the preview with an unwritten added item starts, if any. Nothing is
 * written for it until its first value (see `fill`), so an item left empty
 * leaves nothing behind.
 */
export const addedItemField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setAddedItem)) return effect.value;
    }
    // Gone with its block when that is deleted
    return value === null
      ? null
      : tr.changes.mapPos(value, 1, MapMode.TrackDel);
  },
});

/**
 * What a preview's widget needs to know about its kind. Positions shift while
 * a widget is shown, so everything is looked up from the current state and
 * the widget's current position.
 */
export type ObjectPreviewHost = {
  kind: PreviewKind;
  className: string;
  /** Used in "… returned no content" and "Could not render …" */
  label: string;
  /** Shown faintly in the top-right corner while the ⋯ menu is hidden */
  cornerLabel?: string;
  /** The YAML of each shown object, for the widget at `from` */
  documents: (state: EditorState, from: number) => LiveDocument[] | undefined;
  /**
   * Whether "+ add item" applies: the widget holds several items, and lists an
   * added one (`addedItemField`) as its last document
   */
  addsItems?: boolean;
  /**
   * What deleting object `index` of the widget at `from` removes, for kinds
   * that offer it: text, or an object for `object.delete` to remove from its
   * page. Undefined when there's nothing in the page to remove.
   */
  removal?: (
    state: EditorState,
    from: number,
    index: number,
    page: string,
  ) =>
    | { from: number; to: number }
    | { object: Record<string, unknown> }
    | undefined;
  /** The `object.update` target for object `index` of the widget at `from` */
  target: (
    state: EditorState,
    from: number,
    index: number,
    page: string,
  ) => Record<string, unknown> | undefined;
};

export type ObjectPreview = {
  host: ObjectPreviewHost;
  page: string;
  /** The replaced source range */
  from: number;
  to: number;
  source: string;
  objects: PreviewObject[];
  render: ObjectRenderer;
  /** Rebuild the DOM even while focus is inside (after an undo or redo) */
  rebuild?: boolean;
};

/**
 * A decorator field replacing the source of each preview with its widget.
 * After an undo or redo, or showing or hiding an added item, the previews
 * rebuild, even a focused one.
 */
export function objectPreviewField(
  client: Client,
  previewsFor: (state: EditorState) => ObjectPreview[],
) {
  return decoratorStateField((state, tr) => {
    const rebuild =
      !!tr &&
      (tr.isUserEvent("undo") ||
        tr.isUserEvent("redo") ||
        tr.effects.some((effect) => effect.is(setAddedItem)));
    return Decoration.set(
      previewsFor(state).map((preview) =>
        Decoration.replace({
          widget: new ObjectPreviewWidget(client, { ...preview, rebuild }),
          block: true,
        }).range(preview.from, preview.to),
      ),
    );
  });
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");

/** "undo", "redo" or undefined for a keydown (Mod-z, Mod-Shift-z, Ctrl-y) */
export function historyKey(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  mac = isMac,
): "undo" | "redo" | undefined {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  // As in CodeMirror: Mod-y is redo off the Mac only (Cmd-y is the browser's)
  if (key === "y" && !e.shiftKey && !mac) return "redo";
  return;
}

/**
 * Whether a field holds text it hasn't committed yet: then its own text undo
 * applies. `widgets.*Input` inputs keep their committed value in
 * `data-sb-committed`; a field without it has nothing of its own to undo.
 */
export function hasLocalEdits(target: EventTarget | null): boolean {
  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
  ) {
    return false;
  }
  const committed = target.getAttribute("data-sb-committed");
  return committed !== null && target.value !== committed;
}

export type RendererLookup = (tag: string) => ObjectRenderer | undefined;

function yamlType(value: unknown): YamlType {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

export function normalizeTags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/,\s*|\s+/)
      : [];
  return [
    ...new Set(
      values.map((tag) => String(tag).replace(/^#/, "")).filter(Boolean),
    ),
  ];
}

/** The renderer context of a parsed YAML mapping, plus its cleaned values */
export function yamlContext(
  loaded: Record<string, unknown>,
  text?: string,
): {
  context: YamlContext;
  parsed: Record<string, unknown>;
} {
  const keys =
    text === undefined ? Object.keys(loaded) : yamlTopLevelKeys(text);
  for (const key of Object.keys(loaded)) {
    if (!keys.includes(key)) keys.push(key);
  }
  const values: Record<string, unknown> = {};
  const types: Record<string, YamlType> = {};
  for (const key of keys) {
    const value = loaded[key];
    types[key] = yamlType(value);
    // Clean the value only: cleanupJSON on the whole object would expand
    // dotted keys, and keys/types/values must stay aligned
    values[key] = cleanupJSON(value);
  }
  return {
    context: { values, types, keys },
    parsed: cleanupJSON(loaded) as Record<string, unknown>,
  };
}

/** Offset of a top-level value, using its decoded key identity. */
export function yamlValueOffset(yaml: string, key: string): number | undefined {
  const entry = yamlTopLevelEntries(yaml).find((entry) => entry.key === key);
  if (!entry) return undefined;
  const colon = yaml.indexOf(":", entry.keyNode.to) + 1;
  const lineEnd = yaml.indexOf("\n", colon);
  return lineEnd >= 0
    ? Math.min(entry.valueNode.from, lineEnd)
    : entry.valueNode.from;
}

/** The renderer of the first of `tags` that has one, else the root tag's */
export function selectRenderer(
  tags: string[],
  root: string,
  getRenderer: RendererLookup,
): ObjectRenderer | undefined {
  for (const tag of tags) {
    const renderer = getRenderer(tag);
    if (renderer) return renderer;
  }
  return getRenderer(root);
}

/** Each kind's tag hook; the root tag of a kind has the kind's name */
const HOOKS: Record<PreviewKind, string> = {
  page: "renderFrontmatter",
  data: "renderDataBlock",
};

/** The setting that turns a kind's default form (its root tag's renderer) off */
const DEFAULT_FORM_SETTINGS: Record<PreviewKind, string[]> = {
  page: ["liveEdit", "frontmatter"],
  data: ["liveEdit", "dataBlocks"],
};

export function defaultFormEnabled(client: Client, kind: PreviewKind): boolean {
  return (
    client.config.get<unknown>(DEFAULT_FORM_SETTINGS[kind], true) !== false
  );
}

/**
 * Looks up a tag's render hook for `kind`. The root tag's renderer is the
 * default form, which the kind's setting can turn off; a tag's own renderer
 * is an explicit opt-in and always applies.
 */
export function hookLookup(client: Client, kind: PreviewKind): RendererLookup {
  return (tag) => {
    if (tag === kind && !defaultFormEnabled(client, kind)) return undefined;
    return client.config.get<ObjectRenderer | undefined>(
      ["tags", tag, HOOKS[kind]],
      undefined,
    );
  };
}

/** Whether previews may replace source at all right now */
export function previewsEnabled(client: Client): boolean {
  return (
    widgetRenderMode(client) === "ready" &&
    !client.ui.viewState.uiOptions.markdownSyntaxRendering
  );
}

/**
 * Whether the selection keeps `from`–`to` as source. A cursor right after the
 * range counts as inside, so arrowing back into it reveals the source
 * instead of parking beside the widget.
 */
export function selectionShowsSource(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return selectionIntersectsRange(state, from, to + 1);
}

/** Where a document's YAML starts, past the line break after a `---` */
function contentStart(doc: LiveDocument | undefined): number | undefined {
  if (!doc) return;
  return doc.from + (/^(\r?\n)*/.exec(doc.text)?.[0].length ?? 0);
}

function isTouch(pointerType: string): boolean {
  if (pointerType) return pointerType === "touch" || pointerType === "pen";
  return (
    typeof matchMedia === "function" && matchMedia("(hover: none)").matches
  );
}

const INTERACTIVE =
  "a, button, input, select, textarea, [role=button], [contenteditable], .sb-in-linktext";

function dataAttribute(target: EventTarget | null, name: string) {
  return target instanceof Element
    ? (target.closest(`[${name}]`)?.getAttribute(name) ?? undefined)
    : undefined;
}

type Change = {
  patch?: Record<string, unknown>;
  remove?: string[];
  move?: { key: string; delta: number };
};

/**
 * The top-level keys of `yaml` with `move.key` moved `move.delta` places, or
 * undefined when it can't move (unknown key, already at that end).
 */
export function movedKeyOrder(
  yaml: string,
  move: { key: string; delta: number },
): string[] | undefined {
  let keys: string[];
  try {
    keys = yamlTopLevelKeys(yaml);
  } catch {
    return;
  }
  const from = keys.indexOf(move.key);
  const to = from + Math.sign(move.delta) * Math.max(1, Math.abs(move.delta));
  if (from < 0 || to < 0 || to >= keys.length) return;
  keys.splice(to, 0, ...keys.splice(from, 1));
  return keys;
}

/** The range `from`–`to`, with the line break after it when there is one */
export function withLineBreak(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number } {
  return { from, to: state.sliceDoc(to, to + 1) === "\n" ? to + 1 : to };
}

/** A YAML document with nothing in it yet */
export function isBlank(text: string): boolean {
  return text.trim() === "";
}

/**
 * Focuses the first `selector` match in the preview at `from` once it has
 * rendered (asynchronously), giving up after a few seconds.
 */
export function focusWhenShown(
  view: EditorView,
  from: number,
  selector: string,
  deadline = Date.now() + 3000,
): void {
  for (const preview of view.dom.querySelectorAll(".sb-object-preview")) {
    let at: number | undefined;
    try {
      at = view.posAtDOM(preview, 0);
    } catch {}
    const target = at === from && preview.querySelector<HTMLElement>(selector);
    if (target) {
      target.focus();
      return;
    }
  }
  if (Date.now() < deadline) {
    setTimeout(() => focusWhenShown(view, from, selector, deadline), 30);
  }
}

/**
 * Whether a rendered widget asked to keep its DOM though focus left it: it
 * opened a picker (`editor.filterBox`) and will add to its DOM once that
 * returns, which a rebuilt DOM wouldn't show.
 */
function isKept(dom: HTMLElement): boolean {
  return dom.querySelector("[data-sb-keep]") !== null;
}

/** Stops waiting for focus to really leave a preview; see `toDOM` */
const pendingLeaves = new WeakMap<HTMLElement, () => void>();

/** The pending writes of any object preview in an editor; see `write` */
const writeQueues = new WeakMap<EditorView, Promise<unknown>>();

/**
 * What a mounted DOM shows, shared by the widgets that keep it (see
 * updateDOM). `renderedSource` lags the page while the DOM is kept during
 * editing, and is null once the user changed the DOM itself: then it matches
 * no source, not even the one it was first rendered from (after an undo).
 */
type Shown = {
  contents: LuaWidget[];
  pendingWrites: number;
  renderedSource: string | null;
};

const shownByDom = new WeakMap<HTMLElement, Shown>();

let nextMountId = 0;

/**
 * Re-decorates the page. A preview whose DOM no longer matches its source
 * (`renderedSource`) then rebuilds, unless updateDOM keeps it.
 */
function rerender(view: EditorView, effects: StateEffect<unknown>[] = []) {
  view.dispatch({ effects });
}

export class ObjectPreviewWidget extends WidgetType {
  private shown?: Shown;

  constructor(
    private client: Client,
    readonly preview: ObjectPreview,
  ) {
    super();
  }

  private readOnly(view: EditorView): boolean {
    return view.state.readOnly || this.client.isReadOnlyMode();
  }

  /** Where this widget's range starts now; the DOM may outlive its source */
  private livePosition(view: EditorView, dom: HTMLElement): number | undefined {
    if (!dom.isConnected) return;
    try {
      return view.posAtDOM(dom, 0);
    } catch {
      return;
    }
  }

  private liveDocument(
    view: EditorView,
    dom: HTMLElement,
    index: number,
  ): LiveDocument | undefined {
    const from = this.livePosition(view, dom);
    if (from === undefined) return;
    const docs = this.preview.host.documents(view.state, from);
    return docs?.[index];
  }

  // A target identifies the object by its current position and attributes,
  // so it must be computed after the previous write has landed: two quick
  // edits (a blur commit, then a click) would otherwise plan the second
  // against text that is about to change
  private write(
    view: EditorView,
    dom: HTMLElement,
    index: number,
    change: Change,
  ): Promise<void> {
    const shown = shownByDom.get(dom);
    if (shown) {
      // A locally edited DOM must not compare equal to an untouched render
      shown.renderedSource = null;
      shown.pendingWrites++;
    }
    const previous = writeQueues.get(view) ?? Promise.resolve();
    const next = previous
      .then(() => this.writeNow(view, dom, index, change))
      .finally(() => {
        if (!shown) return;
        shown.pendingWrites--;
        if (shown.pendingWrites === 0 && dom.isConnected) rerender(view);
      });
    // Dropped once settled, so an undo with nothing pending runs right away
    const queued: Promise<void> = next
      .catch(() => {})
      .then(() => {
        if (writeQueues.get(view) === queued) writeQueues.delete(view);
      });
    writeQueues.set(view, queued);
    return next;
  }

  private async writeNow(
    view: EditorView,
    dom: HTMLElement,
    index: number,
    change: Change,
  ): Promise<void> {
    const from = this.livePosition(view, dom);
    const doc =
      from === undefined
        ? undefined
        : this.preview.host.documents(view.state, from)?.[index];
    if (doc && isBlank(doc.text)) return this.fill(view, doc, change.patch);
    const target =
      from === undefined
        ? undefined
        : this.preview.host.target(view.state, from, index, this.preview.page);
    if (from === undefined || !target) {
      throw new Error("object moved or was removed, edit the source instead");
    }
    const options: { remove: string[]; order?: string[] } = {
      remove: change.remove ?? [],
    };
    if (change.move) {
      const order = doc && movedKeyOrder(doc.text, change.move);
      if (!order) return;
      options.order = order;
    }
    await this.client.clientSystem.localSyscall("object.update", [
      target,
      change.patch ?? {},
      options,
    ]);
  }

  /**
   * Writes the first attributes of a blank document as text: there is no
   * object yet for `object.update` to find (nor a schema to check against).
   */
  private fill(
    view: EditorView,
    doc: LiveDocument,
    patch: Record<string, unknown> | undefined,
  ) {
    if (!patch || Object.keys(patch).length === 0) return;
    const from = doc.from;
    // An added item goes in with the line that separates it
    const to = doc.from + doc.text.length;
    // The YAML gets lines of its own: a blank item after a `---` starts on
    // that line, and the closing fence must stay on its own line
    const isBreak = (pos: number) =>
      pos < 0 ||
      pos >= view.state.doc.length ||
      view.state.sliceDoc(pos, pos + 1) === "\n";
    view.dispatch({
      changes: {
        from,
        to,
        insert:
          (isBreak(from - 1) ? "" : "\n") +
          (doc.added ? "---\n" : "") +
          patchYaml("", patch, []) +
          (isBreak(to) ? "" : "\n"),
      },
      effects: doc.added ? setAddedItem.of(null) : [],
      userEvent: "object.update",
    });
  }

  /** Shows an empty item and moves focus to its "+ add attribute" */
  private async addItem(view: EditorView, dom: HTMLElement): Promise<void> {
    await writeQueues.get(view);
    if (this.readOnly(view)) return;
    const from = this.livePosition(view, dom);
    if (from === undefined) return;
    const index = this.preview.host.documents(view.state, from)?.length ?? 0;
    view.dispatch({ effects: setAddedItem.of(from) });
    focusWhenShown(
      view,
      from,
      `[data-object-index="${index}"] .sb-fm-add-attr`,
    );
  }

  /**
   * Deletes object `index`, one undo step, once pending writes landed. An
   * unwritten added item has nothing in the page: deleting just drops it.
   */
  private async remove(
    view: EditorView,
    dom: HTMLElement,
    index: number,
  ): Promise<void> {
    await writeQueues.get(view);
    if (this.readOnly(view)) return;
    const from = this.livePosition(view, dom);
    if (from === undefined) return;
    const removal = this.preview.host.removal?.(
      view.state,
      from,
      index,
      this.preview.page,
    );
    const effects =
      view.state.field(addedItemField, false) === from
        ? [setAddedItem.of(null)]
        : [];
    try {
      if (removal && "object" in removal) {
        view.dispatch({ effects });
        await this.client.clientSystem.localSyscall("object.delete", [
          removal.object,
        ]);
      } else {
        view.dispatch({
          changes: removal && { ...removal, insert: "" },
          effects,
          userEvent: "delete",
        });
      }
    } catch (e: any) {
      this.client.ui.flashNotification(e?.message ?? String(e), "error");
    }
    view.focus();
  }

  private reveal(view: EditorView, pos: number | undefined) {
    if (pos === undefined) return;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }

  toDOM(view: EditorView): HTMLElement {
    const { host, render } = this.preview;
    const container = document.createElement("div");
    container.className = `sb-object-preview ${host.className}`;
    if (host.cornerLabel) {
      const label = document.createElement("div");
      label.className = "sb-object-preview-label";
      label.setAttribute("aria-hidden", "true");
      label.textContent = host.cornerLabel;
      container.appendChild(label);
    }
    // Re-render once focus leaves, picking up edits made while it was kept
    const rerenderUnlessFocused = () =>
      setTimeout(() => {
        if (container.contains(document.activeElement)) return;
        // Leaving drops an added item with nothing written yet, unless a
        // picker the form opened has focus
        const dropAdded =
          !isKept(container) &&
          view.state.field(addedItemField, false) ===
            this.livePosition(view, container);
        rerender(view, dropAdded ? [setAddedItem.of(null)] : []);
      });
    container.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && container.contains(next)) return;
      if (next !== null) return rerenderUnlessFocused();
      // Focus went to no element: maybe a native picker (iOS date and
      // select wheels), which a re-render would close. Wait until focus or
      // a pointer lands somewhere else
      if (pendingLeaves.has(container)) return;
      const inside = (target: EventTarget | null) =>
        target instanceof Node && container.contains(target);
      const stop = () => {
        document.removeEventListener("focusin", onFocusIn, true);
        document.removeEventListener("pointerdown", onPointerDown, true);
        pendingLeaves.delete(container);
      };
      const onFocusIn = (e: FocusEvent) => {
        stop();
        if (!inside(e.target)) rerenderUnlessFocused();
      };
      const onPointerDown = (e: PointerEvent) => {
        if (inside(e.target)) return;
        stop();
        rerenderUnlessFocused();
      };
      document.addEventListener("focusin", onFocusIn, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      pendingLeaves.set(container, stop);
    });
    const index = (target: EventTarget | null) =>
      Number(
        dataAttribute(target, "data-object-index") ??
          this.preview.objects[0]?.index ??
          0,
      );
    // On touch, a near miss around a small control lands on empty space;
    // revealing the YAML then is a surprise, so only a mouse does that
    let lastPointer = "";
    container.addEventListener(
      "pointerdown",
      (event) => {
        lastPointer = event.pointerType;
      },
      true,
    );
    container.addEventListener(
      "mousedown",
      (event) => {
        if (isTouch(lastPointer)) return;
        const target = event.target;
        const interactive =
          target instanceof Element ? target.closest(INTERACTIVE) : null;
        if (
          !event.altKey &&
          interactive &&
          interactive !== container &&
          container.contains(interactive)
        ) {
          return;
        }
        if (this.readOnly(view)) return;
        event.preventDefault();
        event.stopPropagation();
        this.reveal(
          view,
          contentStart(this.liveDocument(view, container, index(target))),
        );
      },
      true,
    );
    // Widgets are outside CodeMirror's event handling, so undo and redo from a
    // field, a chip or a button would go to the field or nowhere; route them
    // to the page's history, unless the field has text of its own to undo
    const runHistory = async (which: "undo" | "redo", event: Event) => {
      if (this.readOnly(view)) return;
      event.preventDefault();
      event.stopPropagation();
      // A value committed just before (Enter, then Mod-z) is still on its way
      // to the page; undoing now would undo the change before it
      const pending = writeQueues.get(view);
      if (pending) await pending;
      (which === "undo" ? undo : redo)(view);
      // The rebuild removes the focused control; the editor takes over, so
      // the next undo works the same
      view.focus();
    };
    container.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || hasLocalEdits(event.target)) return;
      const which = historyKey(event);
      if (which) void runHistory(which, event);
    });
    container.addEventListener("beforeinput", (event) => {
      if (hasLocalEdits(event.target)) return;
      if (event.inputType === "historyUndo") void runHistory("undo", event);
      else if (event.inputType === "historyRedo")
        void runHistory("redo", event);
    });
    container.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (this.readOnly(view)) return;
      const doc = this.liveDocument(view, container, index(event.target));
      if (!doc) return;
      const key = dataAttribute(event.target, "data-key");
      const offset = key ? yamlValueOffset(doc.text, key) : undefined;
      event.preventDefault();
      event.stopPropagation();
      this.reveal(
        view,
        offset === undefined ? contentStart(doc) : doc.from + offset,
      );
    });

    const definitionRef = luaDefinitionRef(render);
    const shownState: Shown = {
      contents: [],
      pendingWrites: 0,
      renderedSource: this.preview.source,
    };
    this.shown = shownState;
    shownByDom.set(container, shownState);
    const mountId = nextMountId++;
    for (const shown of this.preview.objects) {
      const i = shown.index;
      const wrapper = document.createElement("div");
      wrapper.className = "sb-object-preview-item";
      wrapper.setAttribute("data-object-index", String(i));
      const cacheKey = `object:${mountId}:${i}`;
      const content = new LuaWidget({
        client: this.client,
        cacheKey,
        expressionText: "",
        callback: async (_body, _page, track) => {
          const context: ObjectContext = {
            ...shown.context,
            kind: host.kind,
            readOnly: this.readOnly(view),
            set: (key, value) => {
              // Lua's nil arrives as undefined; null empties the value
              return this.write(view, container, i, {
                patch: { [key]: value === undefined ? null : value },
              });
            },
            remove: (key) => {
              return this.write(view, container, i, { remove: [key] });
            },
            move: (key, delta) => {
              return this.write(view, container, i, {
                move: { key, delta },
              });
            },
            addItem:
              host.addsItems &&
              shown === this.preview.objects.at(-1) &&
              shown.context.keys.length > 0
                ? () => this.addItem(view, container)
                : undefined,
          };
          try {
            const result = await callWithTracking(
              render,
              track,
              shown.object,
              context,
            );
            return result == null ||
              (typeof result === "string" && !result.trim())
              ? {
                  _isWidget: true,
                  markdown: `**${host.label} returned no content**`,
                  display: "block",
                }
              : result;
          } catch (error) {
            console.error(`Error rendering ${host.label.toLowerCase()}`, error);
            return {
              _isWidget: true,
              markdown: `**Could not render ${host.label.toLowerCase()}**`,
              display: "block",
            };
          }
        },
        host: {
          kind: "object",
          editPos: () => contentStart(this.liveDocument(view, container, i)),
          definitionRef,
          remove: host.removal && (() => this.remove(view, container, i)),
        },
      });
      shownState.contents.push(content);
      wrapper.appendChild(content.toDOM());
      container.appendChild(wrapper);
    }
    return container;
  }

  override destroy(dom: HTMLElement): void {
    pendingLeaves.get(dom)?.();
    // By the DOM: the instance destroyed may not be the one that built it
    const shown = shownByDom.get(dom);
    for (const content of shown?.contents ?? []) content.destroy();
  }

  // Keep focus and in-flight blur commits on their owning DOM until the
  // write has resolved its current source position and landed.
  override updateDOM(dom: HTMLElement, _view: EditorView, from?: WidgetType) {
    if (
      !(from instanceof ObjectPreviewWidget) ||
      from.preview.render !== this.preview.render ||
      from.preview.host !== this.preview.host ||
      this.preview.rebuild ||
      !(
        dom.contains(document.activeElement) ||
        isKept(dom) ||
        (shownByDom.get(dom)?.pendingWrites ?? 0) > 0
      )
    ) {
      return false;
    }
    this.shown = from.shown;
    from.shown = undefined;
    return true;
  }

  /** What this widget's DOM shows: its own source until it's mounted */
  private get rendered(): string | null {
    return this.shown ? this.shown.renderedSource : this.preview.source;
  }

  override eq(other: WidgetType): boolean {
    const same =
      other instanceof ObjectPreviewWidget &&
      other.rendered === this.rendered &&
      other.preview.page === this.preview.page &&
      other.preview.host === this.preview.host &&
      other.preview.render === this.preview.render;
    // When eq holds, CodeMirror moves this DOM to `other` without calling
    // updateDOM, so `other` must learn here what that DOM shows
    if (same && this.shown && !other.shown) other.shown = this.shown;
    return same;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

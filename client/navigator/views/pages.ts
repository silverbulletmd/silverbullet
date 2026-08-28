import {
  editor,
  index,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { isMetaTag } from "@silverbulletmd/silverbullet/lib/tags";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { Decoration } from "../types.ts";
import { baseMeta, type BuiltinView, INDEX_REFRESH_EVENTS } from "./types.ts";

/** A page or document from the index (or its pre-index file-listing
 * fallback), or a synthesized aspiring-page row (see `aspiringRows`) -- both
 * carry `ref`/`tag`, and freely carry whatever else a page/document
 * decoration adds. */
type PageObj = ObjectValue<Record<string, any>>;

/** Also used by `space_tree.ts`'s segments -- a meta page is the same thing
 * whichever view is asking. Takes only what it reads (`tag`/`tags`), not the
 * full `ref`-guaranteed `PageObj`: `space_tree.ts` also calls this with a
 * synthesized tree folder, which has neither `ref` nor (usually) `tag`. */
export function isMetaPage(obj: { tag?: string; tags?: string[] }): boolean {
  if (obj.tag !== "page") return false;
  for (const tag of obj.tags ?? []) {
    if (tag === "template" || isMetaTag(tag)) return true;
  }
  return false;
}

function isHiddenPage(obj: PageObj): boolean {
  return obj.pageDecoration?.hide === true;
}

/**
 * Extensions this client has a document editor for, as of the last source
 * run. A property of the client (which plugs are loaded), not of the object,
 * so no query reaches it -- and read again by the row decorators below, which
 * run per row and must not each cost a syscall.
 */
let viewableExtensions = new Set<string>();

/**
 * Pages and documents, newest first, from the index when there is one and
 * from the space's file listing when there isn't.
 *
 * The fallback is deliberately the same trade the client's own page-list
 * cache makes (`Client.updatePageListCache`): raw file metadata, no tags, no
 * page decorations, no aspiring pages -- but a picker that lists the space
 * rather than an empty one. `refreshOn` picks up the real thing as indexing
 * delivers it, and `refreshOnOpen` guarantees it by the next open.
 *
 * Also `space_tree.ts`'s own source: it wants the identical set, just sorted
 * differently.
 */
export async function spaceContents(): Promise<PageObj[]> {
  if (await index.isAvailable()) {
    const [pages, documents] = await Promise.all([
      index.queryLuaObjects("page", {} as any),
      index.queryLuaObjects("document", {} as any),
    ]);
    return [...pages, ...documents] as PageObj[];
  }
  const [pages, documents] = await Promise.all([
    space.listPages(),
    space.listDocuments(),
  ]);
  return [
    // The same heuristic the client's pre-index fallback uses: without the
    // index there are no tags to sort meta pages by, and everything shipped
    // under Library/ is one.
    ...pages.map((page) => ({
      ...page,
      tag: "page",
      tags: page.name.startsWith("Library/") ? ["meta"] : [],
    })),
    ...documents.map((document) => ({ ...document, tag: "document" })),
  ];
}

/** Linked-to pages that don't exist yet, one row per target rather than per link. */
async function aspiringRows(): Promise<PageObj[]> {
  if (!(await index.isAvailable())) return [];
  const names = await index.queryLuaObjects<string>("aspiring-page", {
    select: { type: "Variable", name: "name", ctx: {} } as any,
    distinct: true,
  } as any);
  // `ref` is otherwise the one thing that would set an aspiring row apart
  // from a real `ObjectValue`: an aspiring page's reference is exactly the
  // name it would be created under, so this is the honest value for it, not
  // a workaround -- `pagePicker`'s own `onSelect` already reads `obj.ref ??
  // obj.name`, so this changes nothing about what it resolves to.
  return names.map((name) => ({
    name,
    ref: name,
    tag: "page",
    isAspiring: true,
  }));
}

function lastModifiedOf(obj: PageObj): string {
  return obj.lastModified ?? "";
}

async function pagePickerSource(): Promise<PageObj[]> {
  const [opened, path, extensions, mode, contents, aspiring] =
    await Promise.all([
      editor.getLastOpenedMap(),
      editor.getCurrentPath(),
      editor.getViewableExtensions(),
      system.getMode(),
      spaceContents(),
      aspiringRows(),
    ]);
  viewableExtensions = new Set(extensions);
  const readOnly =
    mode === "ro" || (await editor.getUiOption("forcedROMode")) === true;

  const recent: PageObj[] = [];
  const rest: PageObj[] = [];
  const current: PageObj[] = [];
  const unopenable: PageObj[] = [];
  for (const obj of contents) {
    const isDocument = obj.tag === "document";
    if (isDocument && !viewableExtensions.has(obj.extension)) {
      // Nothing on this client can render it. Still listed, so it can be
      // renamed or deleted -- but not in read-only mode, where there is
      // nothing left to do with it at all.
      if (!readOnly) unopenable.push(obj);
    } else if (path === (isDocument ? obj.name : `${obj.name}.md`)) {
      // The page you are looking at is the one you are least likely to want.
      current.push(obj);
    } else if (opened[obj.name] !== undefined) {
      recent.push(obj);
    } else {
      rest.push(obj);
    }
  }
  recent.sort((a, b) => opened[b.name] - opened[a.name]);
  rest.sort((a, b) => lastModifiedOf(b).localeCompare(lastModifiedOf(a)));
  return [...recent, ...rest, ...current, ...aspiring, ...unopenable];
}

function hashtagChips(obj: PageObj): Decoration[] {
  const tags: unknown = obj.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => ({
      text: `#${tag}`,
      position: "right" as const,
      cssClass: "sb-hashtag",
    }));
}

function pickerDescription(obj: PageObj): string | undefined {
  const parts: string[] = [];
  const aliases: string[] = [];
  if (obj.displayName) aliases.push(obj.displayName);
  if (Array.isArray(obj.aliases)) aliases.push(...obj.aliases);
  if (aliases.length > 0) parts.push(`(a.k.a. ${aliases.join(", ")})`);
  if (obj.description) parts.push(String(obj.description).slice(0, 200));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function spaceIcon(obj: PageObj): string {
  if (obj.isAspiring) return "file-plus";
  if (obj.tag === "document") {
    return String(obj.contentType ?? "").startsWith("image/")
      ? "image"
      : "file";
  }
  return "file-text";
}

export const pagePicker: BuiltinView<PageObj> = {
  meta: baseMeta({
    title: "Pages",
    label: "Open",
    supportedDocks: ["modal", "lhs", "rhs"],
    hasCreate: true,
    // The create row makes a page, and says so before it says the name.
    createIcon: "file-text",
    refreshOn: INDEX_REFRESH_EVENTS,
    refreshOnOpen: true,
    pathCompletion: true,
    hashtagFilter: true,
    prefixViews: { $: "std.anchors", "#": "std.tags" },
    // Ranked against the raw name, not the drawn one: a page decorated with
    // an emoji prefix shouldn't have to be found by typing the emoji.
    filterFields: {
      name: { weight: 1.0, segments: true },
      description: 0.5,
    },
  }),
  segments: [
    {
      label: "Pages",
      icon: "file-text",
      placeholder: "Page",
      default: true,
      where: (obj) =>
        obj.tag === "page" && !isMetaPage(obj) && !isHiddenPage(obj),
    },
    {
      label: "Meta",
      icon: "settings",
      placeholder: "Meta page",
      prefix: "^",
      where: (obj) => isMetaPage(obj) && !isHiddenPage(obj),
    },
    {
      label: "Documents",
      icon: "file",
      placeholder: "Document",
      where: (obj) => obj.tag === "document",
    },
    // The one segment that keeps hidden pages.
    { label: "All", icon: "layers", placeholder: "Page or document" },
  ],
  row: {
    primary: (obj) =>
      obj.pageDecoration?.prefix
        ? `${obj.pageDecoration.prefix}${obj.name}`
        : obj.name,
    description: pickerDescription,
    decorations: (obj) => {
      if (obj.isAspiring) {
        return [
          { text: "Create", position: "right", cssClass: "sb-nav-chip-hint" },
        ];
      }
      const chips = hashtagChips(obj);
      if (obj.tag === "document" && obj.extension) {
        chips.push({
          text: String(obj.extension).toUpperCase(),
          position: "right",
          // Greyed out when this client has no editor for it: the row is still
          // selectable, it just isn't an offer.
          cssClass: viewableExtensions.has(obj.extension)
            ? undefined
            : "sb-nav-chip-inactive",
        });
      }
      return chips.length > 0 ? chips : undefined;
    },
    cssClass: (obj) => {
      if (obj.isAspiring) return "sb-nav-aspiring";
      const classes = obj.pageDecoration?.cssClasses;
      if (!Array.isArray(classes)) return undefined;
      // This ends up in a class attribute.
      return classes.join(" ").replaceAll(/[^a-zA-Z0-9-_ ]/g, "");
    },
    icon: spaceIcon,
  },
  source: pagePickerSource,
  // `open`, not the default `navigate`: picking a page you were just on puts
  // you back where you left it. A create is a fresh page and has nothing to
  // restore.
  onSelect: (obj) => editor.open(obj.ref ?? obj.name),
  onCreate: (phrase) => editor.navigate(phrase),
};

import { isMetaTag } from "@silverbulletmd/silverbullet/lib/tags";
import {
  isMarkdownPath,
  isValidName,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  editor,
  index,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { DocumentCapability } from "@silverbulletmd/silverbullet/type/client";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { parsePageMetaLastModified } from "../../lib/page_meta.ts";
import type { Decoration } from "../types.ts";
import { type BuiltinView, baseMeta, INDEX_REFRESH_EVENTS } from "./types.ts";

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

/** Also used by `space_tree.ts`: a page hidden from navigation is hidden
 * there too. Loosely typed for the same reason `isMetaPage` is --
 * `space_tree.ts` calls it with a synthesized tree folder as well. */
export function isHiddenPage(obj: Record<string, any>): boolean {
  return obj.pageDecoration?.hide === true;
}

let documentCapabilities = new Map<string, DocumentCapability>();

function canViewDocument(name: string): boolean {
  const capability = documentCapabilities.get(name);
  return capability !== undefined && capability.kind !== "external";
}

/**
 * Pages and documents from the index when there is one and from the space's
 * file listing when there isn't.
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
  // Aspiring pages use the reference they would be created under.
  return names.map((name) => ({
    name,
    ref: name,
    tag: "page",
    isAspiring: true,
  }));
}

function lastActivityOf(obj: PageObj, opened: Record<string, number>): number {
  const modified =
    typeof obj.lastModified === "string"
      ? parsePageMetaLastModified(obj.lastModified)
      : undefined;
  return Math.max(opened[obj.name] ?? 0, modified ?? 0);
}

async function pagePickerSource(): Promise<PageObj[]> {
  const [opened, path, mode, contents, aspiring] = await Promise.all([
    editor.getLastOpenedMap(),
    editor.getCurrentPath(),
    system.getMode(),
    spaceContents(),
    aspiringRows(),
  ]);
  const documents = contents.filter((obj) => obj.tag === "document");
  const capabilities = await editor.getDocumentCapabilities(
    documents.map(({ name, extension, contentType, size }) => ({
      name,
      extension,
      contentType,
      size,
    })),
  );
  documentCapabilities = new Map(
    documents.map((document, index) => [
      document.name,
      capabilities[index] ?? { kind: "external", reason: "unavailable" },
    ]),
  );
  const readOnly =
    mode === "ro" || (await editor.getUiOption("forcedROMode")) === true;

  const active: PageObj[] = [];
  const current: PageObj[] = [];
  const unopenable: PageObj[] = [];
  for (const obj of contents) {
    const isDocument = obj.tag === "document";
    if (isDocument && !canViewDocument(obj.name)) {
      // Nothing on this client can render it. Still listed, so it can be
      // renamed or deleted -- but not in read-only mode, where there is
      // nothing left to do with it at all.
      if (!readOnly) unopenable.push(obj);
    } else if (path === (isDocument ? obj.name : `${obj.name}.md`)) {
      // The page you are looking at is the one you are least likely to want.
      current.push(obj);
    } else {
      active.push(obj);
    }
  }
  active.sort((a, b) => lastActivityOf(b, opened) - lastActivityOf(a, opened));
  return [...active, ...current, ...aspiring, ...unopenable];
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
  const decorated = obj.pageDecoration?.icon;
  if (typeof decorated === "string" && decorated !== "") return decorated;
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
    helpText: "Press Shift-Enter to create a new page with this exact name.",
    supportedDocks: ["modal", "lhs", "rhs", "bhs"],
    hasCreate: true,
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
      helpText:
        "Press Shift-Enter to create a new meta page with this exact name.",
      prefix: "^",
      where: (obj) => isMetaPage(obj) && !isHiddenPage(obj),
    },
    {
      label: "Documents",
      icon: "file",
      placeholder: "Document",
      helpText:
        "Press Shift-Enter to create a new document with this exact name.",
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
          cssClass: canViewDocument(obj.name)
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
      return classes.join(" ").replaceAll(/[^a-zA-Z0-9-_ ]/g, "");
    },
    icon: spaceIcon,
  },
  source: pagePickerSource,
  // `open`, not the default `navigate`: picking a page you were just on puts
  // you back where you left it. A create is a fresh page and has nothing to
  // restore.
  onSelect: (obj) => editor.open(obj.ref ?? obj.name),
  onCreate: async (phrase) => {
    if (isValidName(phrase)) {
      const path = parseToRef(phrase)!.path;
      if (!isMarkdownPath(path) && !(await space.fileExists(path))) {
        await space.writeDocument(path, new Uint8Array());
      }
    }
    await editor.navigate(phrase);
  },
};

import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { Client } from "../client.ts";
import {
  fileName,
  isBuiltinPath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  encodePageURI,
  encodeRef,
  getNameFromPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { isCursorInRange, LinkWidget } from "./util.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

// Building a `path -> PageMeta` lookup requires calling `parseToRef` (two
// regexes) on every page in the space. Doing that per rendered wiki link, on
// every editor update, is O(links * pages) and makes typing on link-heavy
// pages in large spaces painfully slow. Memoize the map and only rebuild it
// when the `allPages` array identity changes (i.e. when the page list is
// actually replaced).
let pageByPathCache: { pages: PageMeta[]; map: Map<string, PageMeta> } | null =
  null;

function pageByPath(allPages: PageMeta[]): Map<string, PageMeta> {
  if (pageByPathCache?.pages === allPages) {
    return pageByPathCache.map;
  }
  const map = new Map<string, PageMeta>();
  for (const p of allPages) {
    const path = parseToRef(p.ref)?.path;
    if (path !== undefined && !map.has(path)) {
      map.set(path, p);
    }
  }
  pageByPathCache = { pages: allPages, map };
  return map;
}

export interface WikiLinkMatch {
  leadingTrivia: string;
  stringRef: string;
  alias?: string;
  trailingTrivia: string;
}

export interface WikiLinkProcessorOptions {
  from: number;
  to: number;
  match: WikiLinkMatch;
  matchFrom: number;
  matchTo: number;
  client: Client;
  state: EditorState;
  shortWikiLinks: boolean;
  callback: (e: MouseEvent, ref: any) => void;
}

export function processWikiLink(options: WikiLinkProcessorOptions): any[] {
  const { from, to, match, matchFrom, matchTo, client, state, callback } =
    options;
  const widgets: any[] = [];

  const { leadingTrivia, stringRef, alias, trailingTrivia } = match;
  const ref = parseToRef(stringRef);

  let linkStatus: "file-missing" | "default" | "invalid" = "default";

  if (!ref) {
    linkStatus = "invalid";
  } else if (ref.path === "" || isBuiltinPath(ref.path)) {
    linkStatus = "default";
  } else if (client.clientSystem.allKnownFiles.has(ref.path)) {
    linkStatus = "default";
  } else if (client.fullSyncCompleted || client.clientSystem.knownFilesLoaded) {
    linkStatus = "file-missing";
  }

  let css = {
    "file-missing": "sb-wiki-link-missing",
    invalid: "sb-wiki-link-invalid",
    default: "",
  }[linkStatus];

  const renderingSyntax = client.ui.viewState.uiOptions.markdownSyntaxRendering;

  if (isCursorInRange(state, [from, to]) || renderingSyntax) {
    // Only attach a CSS class, then get out
    if (linkStatus !== "default") {
      widgets.push(
        Decoration.mark({
          class: css,
        }).range(from + leadingTrivia.length, to - trailingTrivia.length),
      );
    }
    return widgets;
  }

  const cleanedPath = ref ? getNameFromPath(ref.path) : stringRef;
  const helpText = {
    default: `Navigate to ${cleanedPath}`,
    "file-missing": `Create ${cleanedPath}`,
    invalid: `Cannot create invalid file ${cleanedPath}`,
  }[linkStatus];

  let linkText = alias || stringRef;

  // The `&& ref` is only there to make typescript happy
  if (linkStatus === "default" && ref) {
    const meta = pageByPath(client.ui.viewState.allPages).get(ref.path);

    const renderedRef = structuredClone(ref);

    // We don't want to render the meta
    renderedRef.meta = false;
    // We also don't want to rendered the prefix of the path
    renderedRef.path = options.shortWikiLinks
      ? fileName(renderedRef.path)
      : renderedRef.path;

    const prefix =
      ref.details?.type === "position" || ref.details?.type === "linecolumn"
        ? ""
        : (meta?.pageDecoration?.prefix ?? "");

    linkText = alias || prefix + encodeRef(renderedRef);

    if (meta?.pageDecoration?.cssClasses) {
      css +=
        " sb-decorated-object " +
        meta.pageDecoration.cssClasses
          .join(" ")
          .replaceAll(/[^a-zA-Z0-9-_ ]/g, "");
    }
  }

  widgets.push(
    Decoration.replace({
      widget: new LinkWidget({
        text: linkText,
        title: helpText,
        href: ref ? encodePageURI(encodeRef(ref)) : undefined,
        cssClass: `sb-wiki-link ${css}`,
        from: matchFrom,
        callback: (e) => callback(e, ref),
      }),
    }).range(matchFrom, matchTo),
  );

  return widgets;
}

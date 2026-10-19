import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import {
  encodePageURI,
  encodeRef,
  getNameFromPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  fileName,
  isBuiltinPath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  type ResolveResult,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import type { Client } from "../../client.ts";
import { pageByPath } from "../../lib/page_meta.ts";
import { liveContextForClient } from "../../markdown_renderer/compose_client.ts";
import { renderMarkdownInto } from "../../markdown_renderer/render_into.ts";
import { isCursorInRange, LinkWidget } from "../util.ts";

export type WikiLinkMatch = {
  leadingTrivia: string;
  stringRef: string;
  alias?: string;
  trailingTrivia: string;
};

export type WikiLinkProcessorOptions = {
  from: number;
  to: number;
  match: WikiLinkMatch;
  matchFrom: number;
  matchTo: number;
  client: Client;
  state: EditorState;
  shortWikiLinks: boolean;
  callback: (e: MouseEvent, ref: any) => void;
};

export function processWikiLink(options: WikiLinkProcessorOptions): any[] {
  const { from, to, match, matchFrom, matchTo, client, state, callback } =
    options;
  const widgets: any[] = [];

  const { leadingTrivia, stringRef, alias, trailingTrivia } = match;
  const ref = parseToRef(stringRef);

  let linkStatus: "file-missing" | "default" | "invalid" | "ambiguous" =
    "default";
  let resolution: ResolveResult | undefined;

  if (!ref) {
    linkStatus = "invalid";
  } else if (ref.path === "" || isBuiltinPath(ref.path)) {
    linkStatus = "default";
  } else {
    resolution = resolvePath(
      ref.path,
      client.currentPath(),
      client.clientSystem.allKnownFiles,
    );
    if (resolution.ambiguous) {
      linkStatus = "ambiguous";
    } else if (resolution.exists) {
      linkStatus = "default";
    } else if (
      client.fullSyncCompleted ||
      client.clientSystem.knownFilesLoaded
    ) {
      linkStatus = "file-missing";
    }
  }

  let css = {
    "file-missing": "sb-wiki-link-missing",
    invalid: "sb-wiki-link-invalid",
    ambiguous: "sb-wiki-link-ambiguous",
    default: "",
  }[linkStatus];

  const renderingSyntax = client.ui.viewState.uiOptions.markdownSyntaxRendering;

  if (isCursorInRange(state, [from, to]) || renderingSyntax) {
    if (linkStatus !== "default") {
      widgets.push(
        Decoration.mark({
          class: css,
        }).range(from + leadingTrivia.length, to - trailingTrivia.length),
      );
    }
    return widgets;
  }

  // Built per rendered link on every editor update: compute only the branch
  // that is actually shown.
  const cleanedPath = ref ? getNameFromPath(ref.path) : stringRef;
  let helpText: string;
  switch (linkStatus) {
    case "file-missing":
      helpText = `Create ${cleanedPath}`;
      break;
    case "invalid":
      helpText = `Cannot create invalid file ${cleanedPath}`;
      break;
    case "ambiguous":
      helpText = `Ambiguous — ${
        resolution?.candidates?.length ?? 0
      } candidates, resolving to ${
        resolution ? getNameFromPath(resolution.path) : cleanedPath
      }`;
      break;
    default:
      helpText = `Navigate to ${cleanedPath}`;
  }

  let linkText = alias || stringRef;
  let icon: string | undefined;

  if ((linkStatus === "default" || linkStatus === "ambiguous") && ref) {
    const meta = pageByPath(client.ui.viewState.allPages).get(
      resolution?.path ?? ref.path,
    );

    const renderedRef = structuredClone(ref);

    renderedRef.meta = false;
    renderedRef.path = options.shortWikiLinks
      ? fileName(renderedRef.path)
      : renderedRef.path;

    const prefix =
      ref.details?.type === "position" || ref.details?.type === "linecolumn"
        ? ""
        : (meta?.pageDecoration?.prefix ?? "");

    icon =
      ref.details?.type === "position" || ref.details?.type === "linecolumn"
        ? undefined
        : meta?.pageDecoration?.icon;

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
        icon,
        title: helpText,
        href: ref ? encodePageURI(encodeRef(ref)) : undefined,
        cssClass: `sb-wiki-link ${css}`,
        from: matchFrom,
        callback: (e) => callback(e, ref),
        content: alias?.includes("${")
          ? (label) =>
              renderMarkdownInto(label, alias, liveContextForClient(client), {
                inline: true,
              })
          : undefined,
      }),
    }).range(matchFrom, matchTo),
  );

  return widgets;
}

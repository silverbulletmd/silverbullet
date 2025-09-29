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
  } else if (
    Array.from(client.clientSystem.allKnownFiles).some((file) =>
      file === ref.path
    )
  ) {
    linkStatus = "default";
  } else if (client.fullSyncCompleted || client.clientSystem.knownFilesLoaded) {
    linkStatus = "file-missing";
  }

  let css = {
    "file-missing": "sb-wiki-link-missing",
    "invalid": "sb-wiki-link-invalid",
    "default": "",
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
    "default": `Navigate to ${cleanedPath}`,
    "file-missing": `Create ${cleanedPath}`,
    "invalid": `Cannot create invalid file ${cleanedPath}`,
  }[linkStatus];

  let linkText = alias || stringRef;

  // The `&& ref` is only there to make typescript happy
  if (linkStatus === "default" && ref) {
    const meta = client.ui.viewState.allPages.find((p) =>
      parseToRef(p.ref)?.path === ref.path
    );

    const renderedRef = structuredClone(ref);

    // We don't want to render the meta
    renderedRef.meta = false;
    // We also don't want to rendered the prefix of the path
    renderedRef.path = fileName(renderedRef.path);

    const prefix = (ref.details?.type === "position" ||
        ref.details?.type === "linecolumn")
      ? ""
      : (meta?.pageDecoration?.prefix ?? "");

    linkText = alias || (prefix + encodeRef(renderedRef));

    if (meta?.pageDecoration?.cssClasses) {
      css += " sb-decorated-object " +
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
        cssClass: "sb-wiki-link " + css,
        from: matchFrom,
        callback: (e) => callback(e, ref),
      }),
    }).range(matchFrom, matchTo),
  );

  return widgets;
}

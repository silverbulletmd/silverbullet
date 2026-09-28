import {
  ensureSyntaxTree,
  foldEffect,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import YAML from "js-yaml";
import type { Client } from "../client.ts";
import { tagPrefix } from "../../plugs/index/constants.ts";
import {
  encodePageURI,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { parse } from "../markdown_parser/parse_tree.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";
import { attachWidgetEventHandlers } from "./widget_util.ts";

export type FrontmatterFoldByDefault = "never" | "long" | "always";
export type FrontmatterPreviewType = "text" | "markdown" | "tags" | "date";

export type FrontmatterPreviewConfig = {
  field: string;
  type: FrontmatterPreviewType;
  template: string;
  separator: string;
};

export type FrontmatterFoldingConfig = {
  foldByDefault: FrontmatterFoldByDefault;
  foldByDefaultLines: number;
  preview: FrontmatterPreviewConfig[];
};

export const defaultFrontmatterPreviewConfig: FrontmatterPreviewConfig[] = [
  {
    field: "tags",
    type: "tags",
    template: "${value}",
    separator: " ",
  },
];

export const defaultFrontmatterFoldingConfig: FrontmatterFoldingConfig = {
  foldByDefault: "long",
  foldByDefaultLines: 5,
  preview: defaultFrontmatterPreviewConfig,
};

export type FrontmatterBlock = {
  from: number;
  to: number;
  lines: number;
};

type FoldRange = {
  from: number;
  to: number;
};

export type FrontmatterPreviewValue = {
  config: FrontmatterPreviewConfig;
  value: unknown;
};

export type FrontmatterFoldPlaceholder =
  | {
      type: "frontmatter";
      from: number;
      to: number;
      editPos: number;
      lines: number;
      preview: FrontmatterPreviewValue[];
    }
  | { type: "generic" };

function frontmatterParseUpto(state: EditorState): number {
  const firstLine = state.doc.line(1);
  if (firstLine.text.trimEnd() !== "---") {
    return firstLine.to;
  }

  for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);
    if (line.text.trimEnd() === "---") {
      return line.to;
    }
  }

  return state.doc.length;
}

function isFrontmatterFoldByDefault(
  value: unknown,
): value is FrontmatterFoldByDefault {
  return value === "never" || value === "long" || value === "always";
}

function isFrontmatterPreviewType(
  value: unknown,
): value is FrontmatterPreviewType {
  return (
    value === "text" ||
    value === "markdown" ||
    value === "tags" ||
    value === "date"
  );
}

function cloneDefaultPreview(): FrontmatterPreviewConfig[] {
  return defaultFrontmatterPreviewConfig.map((item) => ({ ...item }));
}

function normalizeFrontmatterPreviewConfig(
  value: unknown,
): FrontmatterPreviewConfig[] {
  if (!Array.isArray(value)) {
    return cloneDefaultPreview();
  }

  const result: FrontmatterPreviewConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const raw = item as Record<string, unknown>;
    if (typeof raw.field !== "string" || raw.field.trim().length === 0) {
      continue;
    }

    const type = isFrontmatterPreviewType(raw.type) ? raw.type : "text";

    result.push({
      field: raw.field.trim(),
      type,
      template: typeof raw.template === "string" ? raw.template : "${value}",
      separator:
        typeof raw.separator === "string"
          ? raw.separator
          : type === "tags"
            ? " "
            : ", ",
    });
  }

  return result;
}

export function normalizeFrontmatterFoldingConfig(
  value: unknown,
): FrontmatterFoldingConfig {
  if (!value || typeof value !== "object") {
    return {
      ...defaultFrontmatterFoldingConfig,
      preview: cloneDefaultPreview(),
    };
  }

  const config = value as Record<string, unknown>;
  return {
    foldByDefault: isFrontmatterFoldByDefault(config.foldByDefault)
      ? config.foldByDefault
      : defaultFrontmatterFoldingConfig.foldByDefault,
    foldByDefaultLines:
      typeof config.foldByDefaultLines === "number" &&
      Number.isInteger(config.foldByDefaultLines) &&
      config.foldByDefaultLines > 0
        ? config.foldByDefaultLines
        : defaultFrontmatterFoldingConfig.foldByDefaultLines,
    preview: normalizeFrontmatterPreviewConfig(config.preview),
  };
}

export function findFrontmatterBlock(
  state: EditorState,
): FrontmatterBlock | undefined {
  let block: FrontmatterBlock | undefined;

  const tree =
    ensureSyntaxTree(state, frontmatterParseUpto(state)) ?? syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.name !== "FrontMatter") {
        return;
      }

      const startLine = state.doc.lineAt(node.from);
      const endLine = state.doc.lineAt(Math.max(node.from, node.to - 1));
      block = {
        from: node.from,
        to: node.to,
        lines: endLine.number - startLine.number + 1,
      };
      return false;
    },
  });

  return block;
}

export function selectionIntersectsRange(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from < to;
    }
    return range.from < to && range.to > from;
  });
}

export function shouldAutoFoldFrontmatter(args: {
  config: FrontmatterFoldingConfig;
  lines: number;
  selectionInside: boolean;
}): boolean {
  if (args.selectionInside) {
    return false;
  }

  switch (args.config.foldByDefault) {
    case "always":
      return true;
    case "long":
      return args.lines > args.config.foldByDefaultLines;
    case "never":
      return false;
  }
}

export function parseFoldedFrontmatter(
  frontmatterText: string,
): Record<string, unknown> {
  const yamlText = frontmatterText
    .replace(/^---[ \t]*(?:\r?\n|$)/, "")
    .replace(/(?:\r?\n)?---[ \t]*$/, "");

  try {
    const parsed = YAML.load(yamlText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function hasRenderableFrontmatterValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasRenderableFrontmatterValue);
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return (
    value instanceof Date ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function prepareFrontmatterFoldPlaceholder(
  state: EditorState,
  range: FoldRange,
  config: FrontmatterFoldingConfig = defaultFrontmatterFoldingConfig,
): FrontmatterFoldPlaceholder {
  const block = findFrontmatterBlock(state);
  if (block && block.from === range.from && block.to === range.to) {
    const frontmatter = parseFoldedFrontmatter(
      state.sliceDoc(block.from, block.to),
    );

    return {
      type: "frontmatter",
      from: block.from,
      to: block.to,
      editPos: state.doc.lineAt(block.from).to + 1,
      lines: block.lines,
      preview: config.preview
        .filter((item) =>
          hasRenderableFrontmatterValue(frontmatter[item.field]),
        )
        .map((item) => ({
          config: item,
          value: frontmatter[item.field],
        })),
    };
  }
  return { type: "generic" };
}

function normalizeFoldTag(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const tag = value.trim().replace(/^#/, "");
  return tag.length > 0 ? tag : undefined;
}

function normalizeFoldTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(normalizeFoldTag).filter((tag) => tag !== undefined);
  }
  if (typeof value === "string") {
    return value
      .split(/\s+/)
      .map(normalizeFoldTag)
      .filter((tag) => tag !== undefined);
  }
  return [];
}

export function frontmatterFoldTags(frontmatterText: string): string[] {
  return normalizeFoldTags(parseFoldedFrontmatter(frontmatterText).tags);
}

function frontmatterPreviewStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(frontmatterPreviewStrings);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const text = String(value).trim();
    return text ? [text] : [];
  }

  return [];
}

export function formatFrontmatterDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    const year = String(value.getUTCFullYear()).padStart(4, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${day}.${month}.${year}`;
  }

  if (typeof value !== "string") {
    return;
  }

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return;
  }

  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

function applyFrontmatterPreviewTemplate(
  template: string,
  value: string,
): string {
  return template.replaceAll("${value}", value);
}

export function frontmatterFoldPlaceholderText(
  prepared: FrontmatterFoldPlaceholder,
): string {
  if (prepared.type === "frontmatter") {
    return "";
  }
  return "…";
}

export function frontmatterFoldTagTarget(
  client: Client | undefined,
  tag: string,
): string {
  return (
    client?.config.get<string | null>(["tags", tag, "tagPage"], null) ??
    `${tagPrefix}${tag}`
  );
}

function appendFoldedFrontmatterTags(
  element: HTMLElement,
  client: Client | undefined,
  value: unknown,
): void {
  const tags = normalizeFoldTags(value);
  for (const tag of tags) {
    const target = frontmatterFoldTagTarget(client, tag);
    const tagElement = document.createElement("a");
    tagElement.className = "sb-hashtag";
    tagElement.dataset.tagName = tag;
    tagElement.href = `/${encodePageURI(target)}`;
    tagElement.rel = "tag";
    tagElement.textContent = `#${tag}`;
    tagElement.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ref = parseToRef(target);
      if (client && ref) {
        void client.navigate(ref, false, event.ctrlKey || event.metaKey);
      }
    });
    element.appendChild(tagElement);
    element.append(" ");
  }
  element.lastChild?.remove();
}

function parseFrontmatterPreviewHtml(html: string): HTMLElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const wrapper = document.createElement("span");
  wrapper.className = "wrapper";
  while (doc.body.firstChild) {
    wrapper.appendChild(doc.body.firstChild);
  }
  return wrapper;
}

function normalizePreviewMarkdownBlocks(element: HTMLElement): void {
  for (let level = 1; level <= 6; level++) {
    for (const heading of Array.from(element.querySelectorAll(`h${level}`))) {
      const replacement = document.createElement("span");
      replacement.className = `cm-frontmatterPreviewHeading cm-frontmatterPreviewHeading-${level}`;
      replacement.replaceChildren(...Array.from(heading.childNodes));
      heading.replaceWith(replacement);
    }
  }
}

function renderFrontmatterMarkdown(
  client: Client,
  markdown: string,
): HTMLElement {
  const syntaxExtensions = client.config.get("syntaxExtensions", {});
  const tree = parse(buildExtendedMarkdownLanguage(syntaxExtensions), markdown);
  const rendered = parseFrontmatterPreviewHtml(
    renderMarkdownToHtml(
      tree,
      {
        shortWikiLinks: client.config.get("shortWikiLinks", true),
      },
      client.ui.viewState.allPages,
    ),
  );

  normalizePreviewMarkdownBlocks(rendered);
  attachWidgetEventHandlers(rendered, client);
  return rendered;
}

function appendFrontmatterPreview(
  element: HTMLElement,
  item: FrontmatterPreviewValue,
  client?: Client,
): void {
  const row = document.createElement("span");
  row.className = `cm-frontmatterPreview cm-frontmatterPreview-${item.config.type}`;

  if (item.config.type === "tags") {
    appendFoldedFrontmatterTags(row, client, item.value);
    if (row.childNodes.length > 0) {
      element.appendChild(row);
    }
    return;
  }

  if (item.config.type === "date") {
    const values = (Array.isArray(item.value) ? item.value : [item.value])
      .map(formatFrontmatterDate)
      .filter((value): value is string => value !== undefined);

    if (values.length === 0) {
      return;
    }

    row.textContent = applyFrontmatterPreviewTemplate(
      item.config.template,
      values.join(item.config.separator),
    );
    element.appendChild(row);
    return;
  }

  const values = frontmatterPreviewStrings(item.value);
  if (values.length === 0) {
    return;
  }

  const text = applyFrontmatterPreviewTemplate(
    item.config.template,
    values.join(item.config.separator),
  );

  if (item.config.type === "markdown" && client) {
    row.appendChild(renderFrontmatterMarkdown(client, text));
  } else {
    row.textContent = text;
  }

  element.appendChild(row);
}

export function frontmatterFoldPlaceholderDOM(
  view: EditorView,
  onclick: (event: Event) => void,
  prepared: FrontmatterFoldPlaceholder,
  client?: Client,
): HTMLElement {
  const element = document.createElement("span");
  element.className = "cm-foldPlaceholder";
  element.onclick = onclick;
  element.setAttribute("aria-label", view.state.phrase("folded code"));
  element.title = view.state.phrase("unfold");

  if (prepared.type === "frontmatter") {
    element.classList.add("cm-frontmatterFoldPlaceholder");
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    element.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        effects: unfoldEffect.of({ from: prepared.from, to: prepared.to }),
        selection: { anchor: prepared.editPos },
      });
      view.focus();
    };

    for (const item of prepared.preview) {
      appendFrontmatterPreview(element, item, client);
    }

    const status = document.createElement("span");
    status.className = "cm-frontmatterFoldStatus";
    status.textContent = `${prepared.lines} frontmatter lines hidden`;
    element.appendChild(status);
    element.title = `${prepared.lines} folded frontmatter lines`;
    element.setAttribute(
      "aria-label",
      `${prepared.lines} folded frontmatter lines`,
    );
    return element;
  }

  element.textContent = frontmatterFoldPlaceholderText(prepared);
  return element;
}

export function clientFrontmatterFoldingConfig(
  client: Client,
): FrontmatterFoldingConfig {
  return normalizeFrontmatterFoldingConfig(
    client.config.get("frontmatterFolding", defaultFrontmatterFoldingConfig),
  );
}

export function frontmatterFoldingExtension(client: Client): Extension {
  return ViewPlugin.fromClass(
    class {
      private destroyed = false;

      constructor(private view: EditorView) {
        queueMicrotask(() => {
          if (this.destroyed) {
            return;
          }
          this.foldInitialFrontmatter();
        });
      }

      update(_update: ViewUpdate): void {}

      destroy(): void {
        this.destroyed = true;
      }

      private foldInitialFrontmatter(): void {
        if (this.destroyed) {
          return;
        }

        const block = findFrontmatterBlock(this.view.state);
        if (!block) {
          return;
        }

        const config = clientFrontmatterFoldingConfig(client);
        if (
          shouldAutoFoldFrontmatter({
            config,
            lines: block.lines,
            selectionInside: selectionIntersectsRange(
              this.view.state,
              block.from,
              block.to,
            ),
          })
        ) {
          this.view.dispatch({
            effects: foldEffect.of({ from: block.from, to: block.to }),
          });
        }
      }
    },
  );
}

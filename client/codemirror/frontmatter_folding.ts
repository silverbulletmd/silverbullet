import { ensureSyntaxTree, foldEffect, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Client } from "../client.ts";

export type FrontmatterFoldByDefault = "never" | "long" | "always";

export type FrontmatterFoldingConfig = {
  foldByDefault: FrontmatterFoldByDefault;
  foldByDefaultLines: number;
};

export const defaultFrontmatterFoldingConfig: FrontmatterFoldingConfig = {
  foldByDefault: "long",
  foldByDefaultLines: 5,
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

export type FrontmatterFoldPlaceholder =
  | { type: "frontmatter"; lines: number }
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

export function normalizeFrontmatterFoldingConfig(
  value: unknown,
): FrontmatterFoldingConfig {
  if (!value || typeof value !== "object") {
    return { ...defaultFrontmatterFoldingConfig };
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
  };
}

export function findFrontmatterBlock(
  state: EditorState,
): FrontmatterBlock | undefined {
  let block: FrontmatterBlock | undefined;

  const tree = ensureSyntaxTree(state, frontmatterParseUpto(state)) ??
    syntaxTree(state);

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

export function prepareFrontmatterFoldPlaceholder(
  state: EditorState,
  range: FoldRange,
): FrontmatterFoldPlaceholder {
  const block = findFrontmatterBlock(state);
  if (block && block.from === range.from && block.to === range.to) {
    return { type: "frontmatter", lines: block.lines };
  }
  return { type: "generic" };
}

export function frontmatterFoldPlaceholderText(
  prepared: FrontmatterFoldPlaceholder,
): string {
  if (prepared.type === "frontmatter") {
    return "";
  }
  return "…";
}

export function frontmatterFoldPlaceholderDOM(
  view: EditorView,
  onclick: (event: Event) => void,
  prepared: FrontmatterFoldPlaceholder,
): HTMLElement {
  const element = document.createElement("span");
  element.className = "cm-foldPlaceholder";
  element.onclick = onclick;
  element.setAttribute("aria-label", view.state.phrase("folded code"));
  element.title = view.state.phrase("unfold");

  if (prepared.type === "frontmatter") {
    element.classList.add("cm-frontmatterFoldPlaceholder");
    element.textContent = frontmatterFoldPlaceholderText(prepared);
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

function clientFrontmatterFoldingConfig(client: Client): FrontmatterFoldingConfig {
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

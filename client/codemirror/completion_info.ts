import {
  type Completion,
  snippet as applySnippet,
} from "@codemirror/autocomplete";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";

export type DocumentedCompletion = Completion & {
  documentation?: string;
  snippet?: string;
};

export function renderCompletionDocumentation(markdown: string): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "sb-completion-documentation";
  dom.innerHTML = renderMarkdownToHtml(parseMarkdown(markdown));
  return dom;
}

export function withCompletionInfo(
  completion: DocumentedCompletion,
): Completion {
  const {
    documentation,
    snippet: snippetTemplate,
    ...codeMirrorCompletion
  } = completion;
  let adaptedCompletion = codeMirrorCompletion;
  if (snippetTemplate && typeof adaptedCompletion.apply !== "function") {
    adaptedCompletion = {
      ...adaptedCompletion,
      apply: applySnippet(snippetTemplate),
    };
  }
  if (!documentation || adaptedCompletion.info) {
    return adaptedCompletion;
  }
  return {
    ...adaptedCompletion,
    info: () => renderCompletionDocumentation(documentation),
  };
}

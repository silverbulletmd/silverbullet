// Keeps multi-line selection backgrounds aligned with the text column.
//
// CodeMirror's drawSelection finds the left and right edges of full-width
// selection rows from `.cm-content`'s border box plus the padding of the
// first `.cm-line` it finds (`contentDOM.querySelector(".cm-line")`). That
// fails in two ways here: `.cm-content` has its own horizontal padding (the
// line handle gutter), which it ignores, and lines differ in padding (fenced
// code sits inset in a card), so the edges move with whichever line happens to
// be rendered first. Answer that one lookup with a hidden probe line padded
// like the content box instead.
import { ViewPlugin } from "@codemirror/view";

export const selectionEdges = ViewPlugin.define((view) => {
  const content = view.contentDOM;
  const probe = document.createElement("div");
  probe.className = "cm-line sb-selection-probe";
  probe.style.display = "none";
  // Outside contentDOM, so CodeMirror never treats it as document content
  view.dom.appendChild(probe);

  const original = content.querySelector;
  content.querySelector = function (this: HTMLElement, selector: string) {
    if (selector !== ".cm-line") {
      return original.call(this, selector);
    }
    const style = getComputedStyle(content);
    probe.style.paddingLeft = style.paddingLeft;
    probe.style.paddingRight = style.paddingRight;
    return probe;
  } as typeof content.querySelector;

  return {
    destroy() {
      delete (content as { querySelector?: unknown }).querySelector;
      probe.remove();
    },
  };
});

// A filled disclosure/dropdown triangle, as SVG rather than a ▸/▾ glyph: a
// glyph sits on the text baseline wherever its font puts it, so it never
// centers reliably against icons or a row's middle.

const VIEW_BOX = "0 0 10 10";
const PATH = "M3 1.5 L7.5 5 L3 8.5 Z";

export type CaretProps = {
  /** Points down (expanded, or a dropdown) instead of right. */
  down?: boolean;
};

export function Caret({ down }: CaretProps) {
  return (
    <svg
      viewBox={VIEW_BOX}
      aria-hidden="true"
      class={down ? "sb-caret sb-caret-down" : "sb-caret"}
    >
      <path d={PATH} fill="currentColor" />
    </svg>
  );
}

/** The same caret as a DOM node, for non-Preact widgets (CodeMirror). */
export function caretElement(down = false): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", VIEW_BOX);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", down ? "sb-caret sb-caret-down" : "sb-caret");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", PATH);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

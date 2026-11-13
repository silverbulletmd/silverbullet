// Hover-revealed ⋯ controls of widgets: only the innermost widget under the
// mouse shows its own, so a nested widget's ⋯ shows apart from its parent's.

/** Elements whose ⋯ controls are hover-revealed (see `installHoverReveal`):
 * widgets, queries, page widgets and widget inputs' row menus */
export const HOVER_REVEAL_HOSTS =
  ".sb-lua-directive-block, .sb-lua-directive-inline, .sb-page-widget-minimal, .sb-in-menu-owner";
/** The controls themselves */
export const HOVER_REVEAL_CONTROLS =
  ".sb-widget-menu-bar, .sb-page-widget-hoverbar, .sb-in-menu-root";
/** Set on the host whose controls show; styles key off it, not `:hover` */
export const HOVER_REVEALED_CLASS = "sb-hover-revealed";

/** The controls of `host` itself, not a nested host's */
function ownControls(host: Element): Element[] {
  return [...host.querySelectorAll(HOVER_REVEAL_CONTROLS)].filter(
    (control) => control.closest(HOVER_REVEAL_HOSTS) === host,
  );
}

type Candidate = { host: Element; controls: Element[] };

/** The hosts around `el` that have controls, innermost first; a bare one (a
 * form's input widget, say) doesn't hide the ⋯ of the widget it sits in */
function candidatesOf(el: Element): Candidate[] {
  const out: Candidate[] = [];
  for (
    let host = el.closest(HOVER_REVEAL_HOSTS);
    host;
    host = host.parentElement?.closest(HOVER_REVEAL_HOSTS) ?? null
  ) {
    const controls = ownControls(host);
    if (controls.length) out.push({ host, controls });
  }
  return out;
}

/** The innermost candidate, unless the pointer is where an outer one's
 * (still hidden, so click-through) control sits: a widget's ⋯ overlapping
 * a form row must be reachable by moving onto it */
function pick(
  candidates: Candidate[],
  x: number,
  y: number,
): Element | undefined {
  if (candidates.length > 1) {
    for (const { host, controls } of candidates) {
      for (const control of controls) {
        const r = control.getBoundingClientRect();
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
          return host;
        }
      }
    }
  }
  return candidates[0]?.host;
}

/**
 * Marks the innermost host with a control under the mouse with
 * `HOVER_REVEALED_CLASS`, as it moves. Keyboard focus and open menus reveal in
 * CSS on their own, and touch screens show the controls always. Returns the
 * uninstaller.
 */
export function installHoverReveal(doc: Document = document): () => void {
  let marked: Element | undefined;
  // Moving within one element needn't look its hosts up again
  let lastTarget: Element | undefined;
  let candidates: Candidate[] = [];
  const mark = (next: Element | undefined) => {
    if (next === marked) return;
    marked?.classList.remove(HOVER_REVEALED_CLASS);
    next?.classList.add(HOVER_REVEALED_CLASS);
    marked = next;
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const target = e.target instanceof Element ? e.target : undefined;
    if (target !== lastTarget) {
      lastTarget = target;
      candidates = target ? candidatesOf(target) : [];
    }
    mark(pick(candidates, e.clientX, e.clientY));
  };
  // Off the window altogether
  const onOut = (e: PointerEvent) => {
    if (e.relatedTarget === null) mark(undefined);
  };
  doc.addEventListener("pointermove", onMove, true);
  // Also when a host comes under a still pointer, e.g. as a menu closes
  doc.addEventListener("pointerover", onMove, true);
  doc.addEventListener("pointerout", onOut, true);
  return () => {
    mark(undefined);
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerover", onMove, true);
    doc.removeEventListener("pointerout", onOut, true);
  };
}

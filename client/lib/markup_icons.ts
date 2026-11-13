import { h, render, type VNode } from "preact";
import { resolveButtonIcon } from "./feather_icons.ts";
import { parseIcon, resolveIconMarkup } from "./icon.ts";

/**
 * A markup button's icon at `size` px, on every markup surface: inline
 * `<svg>` markup, or a Feather or `md-*` icon name (unknown names: a "?")
 */
export function MarkupIcon({
  icon,
  size = 20,
}: {
  icon: string;
  size?: number;
}): VNode<any> | null {
  const parsed = parseIcon(icon);
  if (parsed.kind === "svg") {
    const markup = resolveIconMarkup(icon);
    return markup
      ? h("span", {
          className: "sb-markup-icon",
          style: { width: `${size}px`, height: `${size}px` },
          "aria-hidden": "true",
          dangerouslySetInnerHTML: { __html: markup },
        })
      : null;
  }
  const Icon = resolveButtonIcon(
    parsed.kind === "feather" ? parsed.name : icon,
  );
  return h(Icon, { size });
}

/**
 * `MarkupIcon` as a DOM element, for surfaces outside Preact (the slash
 * menu's completion rows); undefined when there's no icon
 */
export function createMarkupIconElement(
  icon: unknown,
  className: string,
  size = 16,
): HTMLElement | undefined {
  if (typeof icon !== "string" || icon === "") return undefined;
  const wrapper = document.createElement("span");
  wrapper.className = className;
  wrapper.setAttribute("aria-hidden", "true");
  render(h(MarkupIcon, { icon, size }), wrapper);
  return wrapper;
}

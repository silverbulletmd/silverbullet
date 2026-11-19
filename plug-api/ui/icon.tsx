import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { iconSvg, iconsLoaded, onIconsLoaded } from "./icons/registry.ts";

export type IconProps = {
  /** A Lucide icon name */
  name?: string | null;
  class?: string;
  size?: number;
  title?: string;
  /** A pre-built icon node (the navigator caches parsed rows); takes precedence over `name` */
  node?: Element;
};

export function Icon({ name, class: extra, size, title, node }: IconProps) {
  const [, setGeneration] = useState(0);
  useEffect(() => {
    if (iconsLoaded()) return;
    const off = onIconsLoaded(() => setGeneration((n) => n + 1));
    // The set may have finished loading between render and this effect
    if (iconsLoaded()) setGeneration((n) => n + 1);
    return off;
  }, [name]);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (node) ref.current?.replaceChildren(node.cloneNode(true));
  }, [node]);
  if (node) {
    return <span class={extra} ref={ref} aria-hidden="true" />;
  }
  const svg = iconSvg(name, { size });
  if (!svg) return null;
  return (
    <span
      class={extra ? `sb-icon-wrap ${extra}` : "sb-icon-wrap"}
      title={title}
      aria-hidden={title ? undefined : "true"}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

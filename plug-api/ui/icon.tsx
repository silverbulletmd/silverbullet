import { useLayoutEffect, useRef } from "preact/hooks";

export type IconProps = {
  /** A pre-parsed icon node (e.g. from resolved Feather markup or raw SVG); cloned per render rather than re-parsed. */
  node: Element;
  class?: string;
};

export function Icon({ node, class: extra }: IconProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(node.cloneNode(true));
  }, [node]);
  return <span class={extra} ref={ref} />;
}

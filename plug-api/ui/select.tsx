import type { ComponentChildren, JSX } from "preact";
import { cx } from "./cx.ts";

export type SelectProps =
  & Omit<JSX.IntrinsicElements["select"], "class">
  & { class?: string; children?: ComponentChildren };

export function Select({ class: extra, children, ...rest }: SelectProps) {
  return <select class={cx("sb-select", extra)} {...rest}>{children}</select>;
}

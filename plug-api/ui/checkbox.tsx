import type { JSX } from "preact";
import { cx } from "./cx.ts";

export type CheckboxProps =
  & Omit<JSX.IntrinsicElements["input"], "class" | "type">
  & { class?: string };

export function Checkbox({ class: extra, ...rest }: CheckboxProps) {
  return <input type="checkbox" class={cx("sb-checkbox", extra)} {...rest} />;
}

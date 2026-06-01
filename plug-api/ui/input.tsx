import type { JSX } from "preact";
import { cx } from "./cx.ts";

export type InputProps =
  & Omit<JSX.IntrinsicElements["input"], "class">
  & { class?: string };

export function Input({ class: extra, type, ...rest }: InputProps) {
  return <input type={type ?? "text"} class={cx("sb-input", extra)} {...rest} />;
}

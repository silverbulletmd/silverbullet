import type { JSX, Ref } from "preact";
import { cx } from "./cx.ts";

export type InputProps =
  & Omit<JSX.IntrinsicElements["input"], "class" | "ref">
  & {
    class?: string;
    /** Ref to the underlying <input> (Preact function components don't forward `ref`). */
    inputRef?: Ref<HTMLInputElement>;
  };

export function Input({ class: extra, type, inputRef, ...rest }: InputProps) {
  return (
    <input
      ref={inputRef}
      type={type ?? "text"}
      class={cx("sb-input", extra)}
      {...rest}
    />
  );
}

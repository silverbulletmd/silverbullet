import type { JSX, Ref } from "preact";
import { cx } from "./cx.ts";

export type InputProps = Omit<
  JSX.IntrinsicElements["input"],
  "class" | "ref"
> & {
  class?: string;
  /** Ref to the underlying <input> (Preact function components don't forward `ref`). */
  inputRef?: Ref<HTMLInputElement>;
  /** Called with the current value when Enter is pressed in the field. */
  onConfirm?: (value: string) => void;
  /** Called with the current value when Escape is pressed in the field. */
  onExit?: (value: string) => void;
};

export function Input({
  class: extra,
  type,
  inputRef,
  onConfirm,
  onExit,
  onKeyDown,
  ...rest
}: InputProps) {
  return (
    <input
      ref={inputRef}
      type={type ?? "text"}
      class={cx("sb-input", extra)}
      onKeyDown={
        onConfirm || onExit || onKeyDown
          ? (e) => {
              // Run any caller-supplied handler first; it may call preventDefault().
              onKeyDown?.(e);
              // Ignore Enter/Escape that are part of an IME composition (e.g. CJK
              // candidate confirmation), so they don't submit a half-composed value.
              if (e.defaultPrevented || e.isComposing) {
                return;
              }
              if (onConfirm && e.key === "Enter") {
                e.preventDefault();
                onConfirm(e.currentTarget.value);
              } else if (onExit && e.key === "Escape") {
                e.preventDefault();
                onExit(e.currentTarget.value);
              }
            }
          : undefined
      }
      {...rest}
    />
  );
}

import type { ComponentChildren, JSX, Ref } from "preact";
import { cx } from "./cx.ts";

export type ButtonVariant = "default" | "primary" | "danger" | "icon";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: "sb-button",
  primary: "sb-button sb-button-primary",
  danger: "sb-button sb-button-danger",
  icon: "sb-button-icon",
};

export type ButtonProps =
  & Omit<JSX.IntrinsicElements["button"], "class" | "ref">
  & {
    variant?: ButtonVariant;
    class?: string;
    /** Ref to the underlying <button> (Preact function components don't forward `ref`). */
    buttonRef?: Ref<HTMLButtonElement>;
    children?: ComponentChildren;
  };

export function Button(
  { variant = "default", class: extra, type, buttonRef, children, ...rest }:
    ButtonProps,
) {
  return (
    <button
      ref={buttonRef}
      type={type ?? "button"}
      class={cx(VARIANT_CLASS[variant], extra)}
      {...rest}
    >
      {children}
    </button>
  );
}

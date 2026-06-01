import type { ComponentChildren, JSX } from "preact";
import { cx } from "./cx.ts";

export type ButtonVariant = "default" | "primary" | "danger" | "icon";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: "sb-button",
  primary: "sb-button sb-button-primary",
  danger: "sb-button sb-button-danger",
  icon: "sb-button-icon",
};

export type ButtonProps =
  & Omit<JSX.IntrinsicElements["button"], "class">
  & { variant?: ButtonVariant; class?: string; children?: ComponentChildren };

export function Button(
  { variant = "default", class: extra, type, children, ...rest }: ButtonProps,
) {
  return (
    <button type={type ?? "button"} class={cx(VARIANT_CLASS[variant], extra)} {...rest}>
      {children}
    </button>
  );
}

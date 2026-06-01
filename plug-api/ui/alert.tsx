import type { ComponentChildren } from "preact";
import { cx } from "./cx.ts";

export type AlertVariant = "error" | "warning" | "info";

export type AlertProps = {
  variant: AlertVariant;
  class?: string;
  children?: ComponentChildren;
};

export function Alert({ variant, class: extra, children }: AlertProps) {
  return (
    <div class={cx("sb-alert", `sb-alert-${variant}`, extra)}>{children}</div>
  );
}

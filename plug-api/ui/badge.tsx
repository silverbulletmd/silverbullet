import type { ComponentChildren } from "preact";
import { cx } from "./cx.ts";

export type BadgeProps = { class?: string; children?: ComponentChildren };

export function Badge({ class: extra, children }: BadgeProps) {
  return <span class={cx("sb-badge", extra)}>{children}</span>;
}

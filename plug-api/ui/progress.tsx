import { cx } from "./cx.ts";

export type ProgressProps = {
  /** 0..1 */
  value: number;
  class?: string;
};

export function Progress({ value, class: extra }: ProgressProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div class={cx("sb-progress", extra)} role="progressbar">
      <div class="sb-progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

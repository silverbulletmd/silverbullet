import { cx } from "./cx.ts";

export type TabItem = {
  label: string;
  active?: boolean;
  onSelect: () => void;
};

export type TabsProps = {
  items: TabItem[];
  class?: string;
};

export function Tabs({ items, class: extra }: TabsProps) {
  return (
    <div class={cx("sb-tabs", extra)} role="tablist">
      {items.map((t) => (
        <button
          key={t.label}
          type="button"
          role="tab"
          aria-selected={!!t.active}
          class={cx("sb-tab", t.active && "sb-active")}
          onClick={t.onSelect}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

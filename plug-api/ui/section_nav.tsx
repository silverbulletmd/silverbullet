import { Icon } from "./icon.tsx";
import { useId } from "preact/hooks";
import { cx } from "./cx.ts";
import { Select } from "./select.tsx";
import { Tabs } from "./tabs.tsx";

export type SectionItem = {
  id: string;
  label: string;
  href?: string;
  disabled?: boolean;
  dirty?: boolean;
};
export type SectionNavProps = {
  items: SectionItem[];
  active: string;
  label: string;
  onSelect: (id: string) => void;
  horizontal?: boolean;
  collapse?: boolean;
  class?: string;
  navClass?: string;
  itemClass?: string;
};

export function SectionNav({
  items,
  active,
  label,
  onSelect,
  horizontal,
  collapse = true,
  class: extra,
  navClass,
  itemClass,
}: SectionNavProps) {
  const id = useId();
  return (
    <div
      class={cx(
        "sb-section-nav",
        collapse && "sb-section-nav-responsive",
        extra,
      )}
    >
      {horizontal ? (
        <Tabs
          class={cx("sb-section-nav-desktop", navClass)}
          label={label}
          items={items.map((item) => ({
            ...item,
            active: item.id === active,
            onSelect: () => onSelect(item.id),
          }))}
        />
      ) : (
        <nav
          class={cx("sb-section-nav-desktop", "sb-section-links", navClass)}
          aria-label={label}
        >
          {items.map((item) => {
            const props = {
              class: cx("sb-section-link", itemClass),
              "aria-current":
                item.id === active ? ("page" as const) : undefined,
              "data-dirty": item.dirty || undefined,
            };
            return item.href !== undefined ? (
              <a
                key={item.id}
                {...props}
                href={item.disabled ? undefined : item.href}
                aria-disabled={item.disabled || undefined}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.id}
                {...props}
                type="button"
                disabled={item.disabled}
                onClick={() => onSelect(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      )}
      {collapse && (
        <div class="sb-section-nav-mobile">
          <label for={id}>Settings section</label>
          <div class="sb-section-select">
            <Select
              id={id}
              value={active}
              onChange={(event) => onSelect(event.currentTarget.value)}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id} disabled={item.disabled}>
                  {item.label}
                  {item.dirty ? " •" : ""}
                </option>
              ))}
            </Select>
            <Icon name="chevron-down" size={16} />
          </div>
        </div>
      )}
    </div>
  );
}

import { Select } from "@silverbulletmd/silverbullet/ui";
import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

export type SidebarEntry = { key: string; label: string; count?: number };

export type SidebarItem<K extends string> = SidebarEntry & {
  key: K;
  children?: SidebarEntry[];
};

// Keep in step with `MOBILE_MEDIA_QUERY` in `client/lib/mobile.ts`
const NARROW_WIDTH = 600;

/**
 * Whether `ref`'s element is too narrow for a sidebar. Measured on the
 * element, not the window: a side dock is narrow on any screen.
 */
export function useNarrow(ref: RefObject<HTMLElement>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      // A hidden tab measures 0: keep the last layout rather than flip
      const width = entry.contentRect.width;
      if (width > 0) setNarrow(width < NARROW_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}

/**
 * A tab's list of sections, each optionally with entries to jump to. When
 * `compact`, it is a single select of the sections instead.
 */
export function SectionSidebar<K extends string>(props: {
  label: string;
  items: SidebarItem<K>[];
  active: K;
  compact: boolean;
  onSelect: (key: K) => void;
  onSelectChild?: (key: string) => void;
}) {
  const { label, items, active, onSelect, onSelectChild } = props;
  if (props.compact) {
    return (
      <div className="sb-wb-sidebar-compact">
        <Select
          aria-label={label}
          value={active}
          onChange={(e) => onSelect(e.currentTarget.value as K)}
        >
          {items.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </Select>
      </div>
    );
  }
  return (
    <nav className="sb-wb-sidebar" aria-label={label}>
      {items.map((item) => (
        <div key={item.key} className="sb-wb-sidebar-group">
          <button
            type="button"
            className="sb-wb-sidebar-item"
            aria-current={item.key === active ? "page" : undefined}
            onClick={() => onSelect(item.key)}
          >
            <span>{item.label}</span>
            <Count value={item.count} />
          </button>
          {item.key === active &&
            item.children?.map((child) => (
              <button
                key={child.key}
                type="button"
                className="sb-wb-sidebar-child"
                onClick={() => onSelectChild?.(child.key)}
              >
                <span>{child.label}</span>
                <Count value={child.count} />
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}

function Count({ value }: { value?: number }) {
  if (value === undefined) return null;
  return <span className="sb-wb-sidebar-count">{value.toLocaleString()}</span>;
}

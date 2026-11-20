import type { ComponentChildren } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { Icon } from "./icon.tsx";
import {
  iconKeywords,
  iconNames,
  iconsLoaded,
  loadIcons,
  onIconsLoaded,
  resolveIconName,
} from "./icons/registry.ts";
import type { IconKeywords } from "./icons/types.ts";

// Rendering every one of ~2,000 icons costs more than it helps: search narrows it
const MAX_SHOWN = 300;

/** What the picker offers before anything is typed: everyday subjects, roughly grouped. */
const SUGGESTED = [
  // Writing and knowledge
  "file-text",
  "notebook",
  "book-open",
  "bookmark",
  "newspaper",
  "quote",
  "pen-line",
  "lightbulb",
  "brain",
  "graduation-cap",
  // Marking things
  "star",
  "heart",
  "flag",
  "tag",
  "pin",
  "sparkles",
  "rocket",
  "target",
  "trophy",
  "puzzle",
  // Time and tasks
  "calendar",
  "clock",
  "alarm-clock",
  "hourglass",
  "circle-check-big",
  "list-todo",
  "inbox",
  "archive",
  // Places and people
  "house",
  "building",
  "briefcase",
  "map-pin",
  "globe",
  "plane",
  "car",
  "user",
  "users",
  "contact",
  // Communication and media
  "mail",
  "message-square",
  "phone",
  "camera",
  "image",
  "headphones",
  "film",
  "palette",
  "link",
  // Tech
  "code",
  "terminal",
  "bug",
  "database",
  "server",
  "cpu",
  "wrench",
  "settings",
  "key",
  "lock",
  "shield",
  // Life
  "wallet",
  "credit-card",
  "shopping-cart",
  "gift",
  "package",
  "chart-line",
  "coffee",
  "utensils",
  "chef-hat",
  "dumbbell",
  // Nature
  "leaf",
  "sun",
  "moon",
  "cloud",
  "flame",
  "zap",
];

export type IconPickerProps = {
  /** The current icon, pinned first and marked; any spelling the resolver accepts */
  value: string | null;
  /** A Lucide name, or null for "no icon" */
  onPick: (name: string | null) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Shown before the search field, as in the page picker */
  title?: string;
  /** Ends the header row, as the page picker's close button does */
  headerEnd?: ComponentChildren;
};

/** A searchable grid of Lucide icons, styled after the page picker. */
export function IconPicker({
  value,
  onPick,
  onCancel,
  autoFocus,
  title,
  headerEnd,
}: IconPickerProps) {
  const [phrase, setPhrase] = useState("");
  const [names, setNames] = useState(() => iconNames());
  const [keywords, setKeywords] = useState<IconKeywords>({});
  const [active, setActive] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const current = value ? resolveIconName(value) : undefined;

  useEffect(() => {
    let live = true;
    const refresh = () => live && setNames(iconNames());
    const off = iconsLoaded() ? () => {} : onIconsLoaded(refresh);
    void loadIcons().then(refresh);
    void iconKeywords().then((k) => live && setKeywords(k));
    return () => {
      live = false;
      off();
    };
  }, []);

  const p = phrase.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!p) {
      const available = new Set(names);
      const suggested = SUGGESTED.filter(
        (name) => available.has(name) && name !== current,
      );
      return current ? [current, ...suggested] : suggested;
    }
    // Exact name, then names starting with it, then containing it, then keyword-only matches
    const rank = (name: string) =>
      name === p ? 0 : name.startsWith(p) ? 1 : 2;
    const byName = names
      .filter((name) => name.includes(p))
      .sort((a, b) => rank(a) - rank(b));
    const byKeyword = names.filter(
      (name) => !name.includes(p) && keywords[name]?.some((k) => k.includes(p)),
    );
    return [...byName, ...byKeyword];
  }, [p, names, keywords, current]);
  const shown = matches.slice(0, MAX_SHOWN);
  const activeIndex = Math.min(active, shown.length - 1);
  const activeName = shown[activeIndex];

  useEffect(() => setActive(0), [p]);
  useLayoutEffect(() => {
    gridRef.current
      ?.querySelector(".sb-icon-picker-active")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, p]);

  const columns = () => {
    const cells =
      gridRef.current?.querySelectorAll<HTMLElement>("[data-icon-name]");
    if (!cells?.length) return 1;
    const top = cells[0].offsetTop;
    let n = 0;
    while (n < cells.length && cells[n].offsetTop === top) n++;
    return Math.max(1, n);
  };
  const move = (delta: number) =>
    setActive((i) => Math.max(0, Math.min(shown.length - 1, i + delta)));

  const status = activeName ?? (p ? "No icons match" : "");
  const count = !p
    ? `Type to search ${names.length.toLocaleString("en-US")} icons`
    : matches.length > shown.length
      ? `${shown.length} of ${matches.length}, keep typing`
      : `${matches.length} found`;

  return (
    <div className="sb-icon-picker">
      <div className="sb-nav-header">
        <div className="sb-nav-header-row">
          {title ? <label className="sb-nav-title">{title}</label> : null}
          <input
            className="sb-nav-input"
            type="text"
            placeholder="Search icons"
            aria-label="Search icons"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={phrase}
            ref={(el) => {
              if (autoFocus && el && document.activeElement !== el) el.focus();
            }}
            onInput={(e) => setPhrase(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.isComposing) return;
              const step: Record<string, () => number> = {
                ArrowLeft: () => -1,
                ArrowRight: () => 1,
                ArrowUp: () => -columns(),
                ArrowDown: () => columns(),
              };
              if (e.key in step) {
                e.preventDefault();
                move(step[e.key]());
              } else if (e.key === "Enter" && activeName) {
                e.preventDefault();
                onPick(activeName);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancel?.();
              }
            }}
          />
          {headerEnd}
        </div>
      </div>
      <div className="sb-nav-help sb-icon-picker-status">
        <span className="sb-icon-picker-name">{status}</span>
        <span className="sb-icon-picker-count">{count}</span>
        {current ? (
          <button
            type="button"
            className="sb-icon-picker-remove"
            onClick={() => onPick(null)}
          >
            Remove icon
          </button>
        ) : null}
      </div>
      <div className="sb-icon-picker-grid" ref={gridRef} role="listbox">
        {shown.map((name, i) => (
          <button
            key={name}
            type="button"
            tabIndex={-1}
            role="option"
            data-icon-name={name}
            title={name}
            aria-label={name}
            aria-selected={i === activeIndex}
            className={[
              i === activeIndex ? "sb-icon-picker-active" : "",
              name === current ? "sb-icon-picker-current" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(name)}
          >
            <Icon name={name} size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}

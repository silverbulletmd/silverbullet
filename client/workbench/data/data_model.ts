/**
 * The Data tab's state, kept for the whole session so switching tabs or
 * closing the Workbench keeps the selected tag and view.
 */
import { ReloadingStore } from "../shared/reloading_store.ts";
import { allEntries, type TagListSections } from "./tag_list.ts";

export type DataViewKind = "objects" | "schema";
export type DataSection = "defined" | "noSchema" | "builtIn";

export type DataDeps = {
  /** null while the space isn't ready to list tags (index or scripts still loading) */
  loadTags: () => Promise<TagListSections | null>;
  subscribeReload: (changed: () => void) => () => void;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
};

const COLLAPSED_KEY = "sb.workbench.data.collapsed";
/** The two draggable widths: the tag list, and the query editor beside the results */
const WIDTHS = {
  list: {
    key: "sb.workbench.data.listWidth",
    initial: 168,
    min: 120,
    max: 480,
  },
  clauses: {
    key: "sb.workbench.data.clausesWidth",
    initial: 380,
    min: 240,
    max: 900,
  },
} as const;
export type WidthKind = keyof typeof WIDTHS;
/** How soon to look again while the space isn't ready to list tags */
const RETRY_MS = 500;
const DEFAULT_COLLAPSED: Record<DataSection, boolean> = {
  defined: false,
  noSchema: false,
  builtIn: true,
};

export class DataModel extends ReloadingStore<TagListSections | null> {
  /** null while the first load is under way */
  tags: TagListSections | null = null;
  selected = "page";
  view: DataViewKind = "objects";
  private collapsed: Record<DataSection, boolean>;
  /** Widths in pixels, dragged by the viewer */
  private widths: Record<WidthKind, number> = {
    list: WIDTHS.list.initial,
    clauses: WIDTHS.clauses.initial,
  };
  private retry?: ReturnType<typeof setTimeout>;

  constructor(private deps: DataDeps) {
    super({
      load: () => deps.loadTags(),
      subscribeReload: deps.subscribeReload,
    });
    this.collapsed = { ...DEFAULT_COLLAPSED, ...this.readCollapsed() };
    for (const kind of Object.keys(WIDTHS) as WidthKind[]) {
      try {
        const width = Number(this.deps.storage?.getItem(WIDTHS[kind].key));
        if (width) this.widths[kind] = clampWidth(kind, width);
      } catch {
        // Blocked storage: the default width
      }
    }
  }

  get listWidth(): number {
    return this.widths.list;
  }

  get clausesWidth(): number {
    return this.widths.clauses;
  }

  /** Remembers the width once `commit` says the drag is over */
  setWidth(kind: WidthKind, width: number, commit: boolean): void {
    this.widths[kind] = clampWidth(kind, width);
    if (commit) {
      try {
        this.deps.storage?.setItem(WIDTHS[kind].key, String(this.widths[kind]));
      } catch {
        // Blocked storage only costs remembering the width
      }
    }
    this.emit();
  }

  resetWidth(kind: WidthKind): void {
    this.setWidth(kind, WIDTHS[kind].initial, true);
  }

  protected override stopped(): void {
    clearTimeout(this.retry);
  }

  select(tag: string): void {
    this.selected = tag;
    const entry = this.tags
      ? allEntries(this.tags).find((e) => e.name === tag)
      : undefined;
    if (entry?.count === 0) this.view = "schema";
    this.emit();
  }

  showView(view: DataViewKind): void {
    this.view = view;
    this.emit();
  }

  isCollapsed(section: DataSection): boolean {
    return this.collapsed[section];
  }

  toggleSection(section: DataSection): void {
    this.collapsed = { ...this.collapsed, [section]: !this.collapsed[section] };
    try {
      this.deps.storage?.setItem(COLLAPSED_KEY, JSON.stringify(this.collapsed));
    } catch {
      // Blocked storage only costs remembering the choice
    }
    this.emit();
  }

  setInvalid(tag: string, count: number): void {
    if (!this.tags) return;
    const mark = (list: TagListSections[keyof TagListSections]) =>
      list.map((e) => (e.name === tag ? { ...e, invalid: count } : e));
    this.tags = {
      pinned: mark(this.tags.pinned),
      defined: mark(this.tags.defined),
      noSchema: mark(this.tags.noSchema),
      builtIn: mark(this.tags.builtIn),
    };
    this.emit();
  }

  private readCollapsed(): Partial<Record<DataSection, boolean>> {
    try {
      const raw = this.deps.storage?.getItem(COLLAPSED_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  protected loaded(tags: TagListSections | null): void {
    // Not ready yet: keep showing whatever there is (or loading), and look
    // again soon, since readiness can arrive without a reload event
    if (tags) this.tags = tags;
    else if (this.subscribed) {
      clearTimeout(this.retry);
      this.retry = setTimeout(() => void this.load(), RETRY_MS);
    }
    this.emit();
  }
}

function clampWidth(kind: WidthKind, width: number): number {
  const { min, max } = WIDTHS[kind];
  return Math.round(Math.min(max, Math.max(min, width)));
}

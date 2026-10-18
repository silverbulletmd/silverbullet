import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { Button, Input } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ChevronRight } from "preact-feather";
import {
  defaultForceSettings,
  type Edge,
  type Filters,
  type ForceSettings,
  type GraphUniverse,
  type ObjectNode,
} from "../../src/model.ts";
import { colorForTag } from "../colors.ts";
import { openInEditor } from "../host.ts";

type Props = {
  // Currently-visible nodes (used to compute counts for present-only filter UX).
  nodes: ObjectNode[];
  edges: Edge[];
  // Full set; used so the filter list still shows recently-hidden entries.
  allNodes: ObjectNode[];
  allEdges: Edge[];
  // Full option lists derived from the entire space.
  universe: GraphUniverse;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  forces: ForceSettings;
  onForcesChange: (f: ForceSettings) => void;
  // Selected node; rendered as an object-detail section below the filters.
  selected: ObjectNode | null;
};

const LONG_LIST_THRESHOLD = 10;
const MAX_VISIBLE = 50;

type Counted = { key: string; count: number };

export function Sidebar(props: Props) {
  return (
    <aside class="gv-sidebar" aria-label="Filters">
      <div class="gv-sidebar-scroll">
        <TagsSection {...props} />
        <LabelsSection {...props} />
        <ForcesSection
          forces={props.forces}
          onForcesChange={props.onForcesChange}
        />
      </div>
      <Inspector selected={props.selected} />
    </aside>
  );
}

function ForcesSection({
  forces,
  onForcesChange,
}: {
  forces: ForceSettings;
  onForcesChange: (f: ForceSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const update = (patch: Partial<ForceSettings>) =>
    onForcesChange({ ...forces, ...patch });
  const sliders: {
    label: string;
    key: keyof ForceSettings;
    min: number;
    max: number;
    step: number;
  }[] = [
    {
      label: "Center pull",
      key: "centerStrength",
      min: 0,
      max: 0.3,
      step: 0.005,
    },
    {
      label: "Repulsion",
      key: "chargeStrength",
      min: -800,
      max: 0,
      step: 10,
    },
    { label: "Link distance", key: "linkDistance", min: 10, max: 600, step: 1 },
    {
      label: "Link strength",
      key: "linkStrength",
      min: 0.01,
      max: 1,
      step: 0.01,
    },
  ];
  return (
    <div class="gv-section">
      <SectionHeader title="Layout" open={open} onToggle={() => setOpen(!open)}>
        <button
          type="button"
          class="gv-link-button"
          onClick={() => onForcesChange(defaultForceSettings)}
        >
          Reset
        </button>
      </SectionHeader>
      {open && (
        <div class="gv-section-body gv-forces-body">
          {sliders.map((s) => (
            <label class="gv-force-row" key={s.key}>
              <div class="gv-force-label">
                <span>{s.label}</span>
                <span class="gv-force-value">
                  {forces[s.key].toFixed(s.step < 0.1 ? 3 : 0)}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={forces[s.key]}
                onInput={(e) =>
                  update({
                    [s.key]: Number((e.target as HTMLInputElement).value),
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Index bookkeeping every object has; shown after the object's own fields
const SYSTEM_KEYS = new Set([
  "tag",
  "tags",
  "itags",
  "ref",
  "range",
  "page",
  "pos",
  "perm",
  "size",
  "contentType",
  "created",
  "lastModified",
  "name",
]);

function Inspector({ selected }: { selected: ObjectNode | null }) {
  if (!selected) {
    return (
      <section class="gv-inspector gv-inspector-empty" aria-label="Selected">
        Click an object to see its fields.
      </section>
    );
  }
  // Lead with the object's `tag`: stub nodes (dangling refs, URL/file
  // targets) carry none in their attributes, so fall back to its kind.
  const attrs: Record<string, unknown> = {
    tag: selected.rootTag ?? selected.kind,
    ...selected.attributes,
  };
  const own = Object.keys(attrs).filter((k) => !SYSTEM_KEYS.has(k));
  const system = Object.keys(attrs).filter((k) => SYSTEM_KEYS.has(k));
  const open = async () => {
    try {
      await openInEditor(selected.ref);
    } catch (err) {
      console.error("object-graph: object navigation failed", err);
    }
  };
  return (
    <section class="gv-inspector" aria-label="Selected">
      <header class="gv-inspector-header">
        <span
          class="gv-swatch"
          style={{ background: colorForTag(selected.primaryTag) }}
        />
        <span class="gv-inspector-title" title={selected.title}>
          {selected.title}
        </span>
        <Button onClick={open} title={`Open ${selected.title}`}>
          Open
        </Button>
      </header>
      <dl class="gv-attrs">
        {own.map((k) => (
          <Attr key={k} name={k} value={attrs[k]} />
        ))}
        {system.map((k) => (
          <Attr key={k} name={k} value={attrs[k]} system />
        ))}
      </dl>
    </section>
  );
}

function Attr({
  name,
  value,
  system,
}: {
  name: string;
  value: unknown;
  system?: boolean;
}) {
  return (
    <>
      <dt class={system ? "gv-attr-system" : undefined}>{name}</dt>
      <dd class={system ? "gv-attr-system" : undefined}>
        <AttrValue value={value} />
      </dd>
    </>
  );
}

function AttrValue({ value }: { value: unknown }) {
  const [text, setText] = useState<string | null>(null);
  const nested = value !== null && typeof value === "object";
  const flatList =
    Array.isArray(value) && value.every((v) => typeof v !== "object");
  useEffect(() => {
    if (!nested || flatList) return;
    let cancelled = false;
    void syscall("yaml.stringify", value).then((t: string) => {
      if (!cancelled) setText(t.trimEnd());
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (flatList) return <>{(value as unknown[]).join(", ")}</>;
  if (nested) return <pre>{text ?? ""}</pre>;
  return <>{String(value)}</>;
}

function SectionHeader({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children?: preact.ComponentChildren;
}) {
  return (
    <header class="gv-section-header">
      <button
        type="button"
        class="gv-section-title"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronRight size={12} class={`gv-twisty${open ? " open" : ""}`} />
        {title}
      </button>
      <span class="gv-section-actions">{children}</span>
    </header>
  );
}

function Section({
  title,
  rows,
  hidden,
  onToggle,
  onAll,
  onNone,
  renderRow,
}: {
  title: string;
  rows: Counted[];
  hidden: string[];
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
  renderRow: (r: Counted) => preact.ComponentChildren;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const filtered = query
    ? rows.filter((r) => r.key.toLowerCase().includes(query.toLowerCase()))
    : rows;
  const display = showAll ? filtered : filtered.slice(0, MAX_VISIBLE);
  const overflow = filtered.length - display.length;

  return (
    <div class="gv-section">
      <SectionHeader title={title} open={open} onToggle={() => setOpen(!open)}>
        <button type="button" class="gv-link-button" onClick={onAll}>
          All
        </button>
        <button type="button" class="gv-link-button" onClick={onNone}>
          None
        </button>
      </SectionHeader>
      {open && (
        <div class="gv-section-body">
          {rows.length > LONG_LIST_THRESHOLD && (
            <Input
              type="text"
              class="gv-section-search"
              placeholder={`Filter ${title.toLowerCase()}…`}
              value={query}
              onInput={(e) =>
                setQuery((e.currentTarget as HTMLInputElement).value)
              }
            />
          )}
          {display.map((r) => {
            const shown = !hidden.includes(r.key);
            return (
              <button
                type="button"
                class="gv-row"
                key={r.key}
                aria-pressed={shown}
                title={shown ? `Hide ${r.key}` : `Show ${r.key}`}
                onClick={() => onToggle(r.key)}
              >
                {renderRow(r)}
                <span class="gv-count">{r.count}</span>
              </button>
            );
          })}
          {overflow > 0 && (
            <button
              type="button"
              class="gv-link-button gv-more"
              onClick={() => setShowAll(true)}
            >
              Show {overflow} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Build a `Counted[]` whose key set is exactly `keys`, with counts pulled
 * from the explored-graph tally (defaulting to 0). Sorted: present-in-graph
 * entries first (by count desc), then absent entries alphabetically.
 */
function universeRows(keys: string[], counts: Map<string, number>): Counted[] {
  const rows: Counted[] = keys.map((key) => ({
    key,
    count: counts.get(key) ?? 0,
  }));
  rows.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });
  return rows;
}

function TagsSection({ allNodes, universe, filters, onFiltersChange }: Props) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of allNodes) {
      if (n.tags.length === 0) {
        counts.set("(untagged)", (counts.get("(untagged)") ?? 0) + 1);
        continue;
      }
      for (const t of n.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    // "(untagged)" is always presented at the bottom of the universe list
    // — it's a bucket, not a real tag.
    return universeRows([...universe.tags, "(untagged)"], counts);
  }, [allNodes, universe.tags]);
  const toggle = (key: string) =>
    onFiltersChange({
      ...filters,
      hiddenTags: filters.hiddenTags.includes(key)
        ? filters.hiddenTags.filter((x) => x !== key)
        : [...filters.hiddenTags, key],
    });
  return (
    <Section
      title="Tags"
      rows={rows}
      hidden={filters.hiddenTags}
      onToggle={toggle}
      onAll={() => onFiltersChange({ ...filters, hiddenTags: [] })}
      onNone={() =>
        onFiltersChange({
          ...filters,
          hiddenTags: rows.map((r) => r.key),
        })
      }
      renderRow={(r) => (
        <span class="gv-row-label">
          <span
            class="gv-swatch"
            style={{
              "--gv-swatch": colorForTag(r.key === "(untagged)" ? null : r.key),
            }}
          />
          <span class="gv-row-name">{r.key}</span>
        </span>
      )}
    />
  );
}

function LabelsSection({
  allEdges,
  universe,
  filters,
  onFiltersChange,
}: Props) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of allEdges)
      counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
    return universeRows(universe.labels, counts);
  }, [allEdges, universe.labels]);
  const toggle = (key: string) =>
    onFiltersChange({
      ...filters,
      hiddenLabels: filters.hiddenLabels.includes(key)
        ? filters.hiddenLabels.filter((x) => x !== key)
        : [...filters.hiddenLabels, key],
    });
  return (
    <Section
      title="Relations"
      rows={rows}
      hidden={filters.hiddenLabels}
      onToggle={toggle}
      onAll={() => onFiltersChange({ ...filters, hiddenLabels: [] })}
      onNone={() =>
        onFiltersChange({
          ...filters,
          hiddenLabels: rows.map((r) => r.key),
        })
      }
      renderRow={(r) => (
        <span class="gv-row-label">
          <span class="gv-edge-glyph" />
          <span class="gv-row-name">{r.key}</span>
        </span>
      )}
    />
  );
}

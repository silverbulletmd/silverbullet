import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { Checkbox, Input } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  defaultForceSettings,
  type Edge,
  type Filters,
  type ForceSettings,
  type GraphUniverse,
  type ObjectNode,
} from "../../src/model.ts";
import { colorForTag } from "../colors.ts";

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
    <aside class="gv-sidebar">
      <TagsSection {...props} />
      <LabelsSection {...props} />
      <ForcesSection
        forces={props.forces}
        onForcesChange={props.onForcesChange}
      />
      <ObjectSection selected={props.selected} />
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
      <header class="gv-section-header" onClick={() => setOpen(!open)}>
        <span class="gv-section-title">
          <span class={`gv-twisty ${open ? "open" : "closed"}`}>▸</span>
          Forces
        </span>
        <span class="gv-section-actions" onClick={(e) => e.stopPropagation()}>
          <a onClick={() => onForcesChange(defaultForceSettings)}>reset</a>
        </span>
      </header>
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

function ObjectSection({ selected }: { selected: ObjectNode | null }) {
  const [yamlText, setYamlText] = useState<string>("");
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // Always lead with the object's `tag`. Real page/item/block objects
    // carry it in their indexed attributes; stub nodes (dangling refs,
    // URL/file targets) don't, so fall back to the node's structural tag
    // (or kind). Spreading `attributes` last keeps the real value when set.
    const display = {
      tag: selected.rootTag ?? selected.kind,
      ...selected.attributes,
    };
    void syscall("yaml.stringify", display).then((text: string) => {
      if (!cancelled) setYamlText(text);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);
  if (!selected) return null;
  const swatch = colorForTag(selected.primaryTag);
  const navigate = async () => {
    try {
      await editor.navigate(selected.ref);
      await editor.hidePanel("modal");
    } catch (err) {
      console.error("object-graph: object navigation failed", err);
    }
  };

  return (
    <div class="gv-object-section">
      <header class="gv-object-header">
        <a
          class="gv-object-title gv-object-title-link"
          title={`Open ${selected.title}`}
          onClick={navigate}
        >
          <span class="gv-swatch" style={{ background: swatch }} />
          {selected.title}
        </a>
      </header>
      <pre class="gv-object-body">{yamlText}</pre>
    </div>
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
      <header class="gv-section-header" onClick={() => setOpen(!open)}>
        <span class="gv-section-title">
          <span class={`gv-twisty ${open ? "open" : "closed"}`}>▸</span>
          {title}
        </span>
        <span class="gv-section-actions" onClick={(e) => e.stopPropagation()}>
          <a onClick={onAll}>all</a>
          {" · "}
          <a onClick={onNone}>none</a>
        </span>
      </header>
      {open && (
        <div class="gv-section-body">
          {rows.length > LONG_LIST_THRESHOLD && (
            <Input
              type="text"
              class="gv-section-search"
              placeholder="Filter…"
              value={query}
              onInput={(e) =>
                setQuery((e.currentTarget as HTMLInputElement).value)
              }
            />
          )}
          {display.map((r) => (
            <label class="gv-row" key={r.key}>
              <Checkbox
                checked={!hidden.includes(r.key)}
                onChange={() => onToggle(r.key)}
              />
              {renderRow(r)}
              <span class="gv-count">{r.count}</span>
            </label>
          ))}
          {overflow > 0 && (
            <a class="gv-more" onClick={() => setShowAll(true)}>
              show {overflow} more
            </a>
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
        <span class="gv-tag-row">
          <span
            class="gv-swatch"
            style={{
              background: colorForTag(r.key === "(untagged)" ? null : r.key),
            }}
          />
          {r.key}
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
      title="Kind"
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
      renderRow={(r) => <span>{r.key}</span>}
    />
  );
}

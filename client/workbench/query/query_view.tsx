import { builtinTagKind } from "@silverbulletmd/silverbullet/lib/tags";
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import type { TabProps } from "../tab.ts";
import { QueryBar } from "./query_bar.tsx";
import {
  GroupByRow,
  LimitRow,
  OrderByRow,
  WhereRow,
} from "./query_clauses.tsx";
import { FieldsPanel } from "./query_fields_panel.tsx";
import {
  canNarrow,
  dataRootSource,
  listedSource,
  type PageScope,
  type QuerySource,
  sameSource,
  tagSource,
} from "./query_from.ts";
import { QueryPreview } from "./query_preview.tsx";
import { SelectRow } from "./query_select.tsx";
import {
  filterTags,
  listRelationKinds,
  listTags,
  loadFields,
  NO_TAGS,
  SAMPLE_LIMIT,
  START_SOURCE,
  TAG_KIND_GROUPS,
  type TagLists,
  tagsUsedOn,
} from "./query_source.ts";
import { useBuilder } from "./use_builder.ts";

/** A source in the tag list, and how the list and the From row show it */
type Entry = { key: string; label: string; source: QuerySource };

const rootEntry = (root: string): Entry => ({
  key: `root:${root}`,
  label: root,
  source: listedSource(root),
});
const dataRootEntry = (name: string): Entry => ({
  key: `data:${name}`,
  label: name,
  source: dataRootSource(name),
});
const tagEntry = (tag: string): Entry => ({
  key: `tag:${tag}`,
  label: `#${tag}`,
  source: tagSource(tag),
});

/** The tag-list entry a source was picked from; the From row narrows the rest */
function pickedEntry(s: QuerySource, tags: TagLists): Entry {
  if (s.by === "tag" && s.tag !== null) return tagEntry(s.tag);
  if (s.root === "data" && s.tag !== null && tags.dataRoots.includes(s.tag)) {
    return dataRootEntry(s.tag);
  }
  return rootEntry(s.root ?? "");
}

const sourceKey = (s: QuerySource) =>
  `${s.root ?? ""}|${s.tag ?? ""}|${s.scope ?? ""}`;

/**
 * The Query tab: pick a tag and look through its objects, shaped by the
 * query editor beside them (one row per clause; it can be closed). The generated text stays in the bar at
 * the bottom.
 */
export function QueryView({ client, session, builder, focusTarget }: TabProps) {
  useBuilder(builder);
  const [tags, setTags] = useState<TagLists>(NO_TAGS);
  const [kinds, setKinds] = useState<string[]>([]);
  const [sampled, setSampled] = useState<Record<string, number>>({});
  const [showFields, setShowFields] = useState(false);
  const [phrase, setPhrase] = useState("");
  const tagFilter = useRef<HTMLInputElement>(null);
  const m = builder.model;

  async function pick(source: QuerySource) {
    const old = builder.model?.source;
    if (old && sameSource(source, old)) return;
    const { fields, sampled: n } = await loadFields(client, source);
    setSampled((s) => ({ ...s, [sourceKey(source)]: n }));
    if (builder.pickSource(source, fields) && old) {
      const label = pickedEntry(old, tags).label;
      client.ui.flashNotification(`Cleared the query for ${label}`, "info", {
        actions: [{ name: "Undo", run: () => void builder.undo() }],
      });
    }
  }

  /** Narrows the picked root tag to a user tag (or kind), or a user tag to a root tag */
  async function narrow(source: QuerySource) {
    const { fields, sampled: n } = await loadFields(client, source);
    setSampled((s) => ({ ...s, [sourceKey(source)]: n }));
    builder.narrow(source, fields);
  }

  useEffect(() => {
    void listTags(client).then(setTags);
    if (!builder.model) void pick(START_SOURCE);
    // Opened early, the space's scripts or index may not be there yet; when
    // they arrive the tags, fields and results follow, keeping the query
    const refresh = async () => {
      setTags(await listTags(client));
      const source = builder.model?.source;
      if (!source) return;
      const { fields, sampled: n } = await loadFields(client, source);
      // Another tag picked meanwhile brought its own fields
      if (builder.model?.source !== source) return;
      setSampled((s) => ({ ...s, [sourceKey(source)]: n }));
      builder.refreshData(fields);
    };
    const onRefresh = () => void refresh();
    const offLoad = client.clientSystem.spaceLuaEnv.onLoad(onRefresh);
    client.eventHook.addLocalListener("editor:reloadState", onRefresh);
    return () => {
      offLoad();
      client.eventHook.removeLocalListener("editor:reloadState", onRefresh);
    };
  }, [client]);

  useEffect(
    () => (tagFilter.current ? focusTarget(tagFilter.current) : undefined),
    [focusTarget],
  );

  const relationPicked =
    m?.source.root === "relation" && m.source.by === "root";
  useEffect(() => {
    if (relationPicked) void listRelationKinds(client).then(setKinds);
  }, [client, relationPicked]);

  const count = (s: QuerySource) => {
    const n = sampled[sourceKey(s)];
    if (n === undefined) return null;
    return n >= SAMPLE_LIMIT ? `${SAMPLE_LIMIT}+` : String(n);
  };
  const picked = m ? pickedEntry(m.source, tags) : null;
  const entryButton = (e: Entry) => {
    const on = picked?.key === e.key;
    return (
      <button
        key={e.key}
        type="button"
        className={`sb-wbq-tag${on ? " sb-wbq-tag-on" : ""}`}
        aria-pressed={on}
        onClick={() => void pick(e.source)}
      >
        <span>{e.label}</span>
        {on && m ? (
          <span className="sb-wbq-count">{count(m.source)}</span>
        ) : null}
      </button>
    );
  };

  const shown = filterTags(tags, phrase);
  const groups = TAG_KIND_GROUPS.map(({ kind, label }) => ({
    kind,
    label,
    entries: [
      ...shown.builtIn.filter((t) => builtinTagKind(t) === kind).map(rootEntry),
      ...(kind === "root" ? shown.dataRoots.map(dataRootEntry) : []),
    ],
  }));
  const userEntries = shown.user.map(tagEntry);
  const allEntries = [
    ...tags.builtIn.map(rootEntry),
    ...tags.dataRoots.map(dataRootEntry),
    ...tags.user.map(tagEntry),
  ];
  const firstShown =
    groups.flatMap((g) => g.entries)[0] ?? userEntries[0] ?? null;

  return (
    <div className="sb-workbench sb-wbq-root">
      <div className="sb-wb-query">
        <nav className="sb-wbq-tags" aria-label="Tags">
          <input
            ref={tagFilter}
            type="search"
            className="sb-wbq-tagfilter"
            aria-label="Filter tags"
            placeholder="Filter tags"
            value={phrase}
            onInput={(e) => setPhrase(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (firstShown) void pick(firstShown.source);
              } else if (e.key === "Escape" && phrase) {
                // Clears the filter; a second Escape is the panel's
                e.preventDefault();
                e.stopPropagation();
                setPhrase("");
              }
            }}
          />
          {groups.map(({ kind, label, entries }) =>
            entries.length ? (
              <Fragment key={kind}>
                <div className="sb-wbq-group">{label}</div>
                {entries.map(entryButton)}
              </Fragment>
            ) : null,
          )}
          {userEntries.length ? (
            <div className="sb-wbq-group">User tags</div>
          ) : null}
          {userEntries.map(entryButton)}
          {!firstShown ? (
            <div className="sb-wbq-note sb-wbq-nomatch">No tags match</div>
          ) : null}
        </nav>
        <div
          className={`sb-wbq-main${builder.editing ? "" : " sb-wbq-browse"}`}
        >
          <label className="sb-wbq-tagpick">
            <span>From</span>
            <select
              className="sb-select"
              value={picked?.key}
              onChange={(e) => {
                const key = e.currentTarget.value;
                const entry = allEntries.find((x) => x.key === key);
                if (entry) void pick(entry.source);
              }}
            >
              {allEntries.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          {/* A replaced model (new tag, Undo) starts the inputs over */}
          <div className="sb-wbq-clauses" key={builder.resets}>
            {m ? (
              <>
                <span className="sb-wbq-label">From</span>
                <div className="sb-wbq-row">
                  <span className="sb-wbq-chip">{picked?.label}</span>
                  <PageScopeControl
                    source={m.source}
                    onNarrow={(s) => void narrow(s)}
                  />
                  <NarrowSelect
                    source={m.source}
                    picked={picked}
                    tags={tags}
                    kinds={kinds}
                    onNarrow={(s) => void narrow(s)}
                  />
                  <button
                    type="button"
                    className="sb-wbq-link"
                    aria-expanded={showFields}
                    onClick={() => setShowFields(!showFields)}
                  >
                    Schema
                  </button>
                  <span className="sb-wbq-spacer" />
                  <button
                    type="button"
                    className="sb-wbq-x"
                    aria-label="Close query editor"
                    title="Close query editor"
                    onClick={() => builder.setEditing(false)}
                  >
                    ✕
                  </button>
                </div>
                {showFields ? (
                  <FieldsPanel
                    client={client}
                    builder={builder}
                    onClose={() => setShowFields(false)}
                  />
                ) : null}
                <WhereRow client={client} builder={builder} model={m} />
                <GroupByRow client={client} builder={builder} model={m} />
                <OrderByRow client={client} builder={builder} model={m} />
                <SelectRow client={client} builder={builder} model={m} />
                <LimitRow client={client} builder={builder} model={m} />
              </>
            ) : null}
          </div>
          <QueryPreview client={client} builder={builder} />
          <QueryBar client={client} session={session} builder={builder} />
        </div>
      </div>
    </div>
  );
}

const PAGE_SCOPES: {
  scope: PageScope | undefined;
  label: string;
  tooltip: string;
}[] = [
  { scope: undefined, label: "All", tooltip: "Every page" },
  { scope: "content", label: "Content", tooltip: "Pages not tagged #meta" },
  { scope: "meta", label: "Meta", tooltip: "Pages tagged #meta or #meta/…" },
];

/** Narrows pages to content pages or meta pages; absent for other objects */
function PageScopeControl({
  source,
  onNarrow,
}: {
  source: QuerySource;
  onNarrow: (s: QuerySource) => void;
}) {
  if (source.root !== "page") return null;
  return (
    <SegmentedControl
      items={PAGE_SCOPES}
      activeIndex={PAGE_SCOPES.findIndex((p) => p.scope === source.scope)}
      onPick={(i) => {
        const { scope: _, ...rest } = source;
        const scope = PAGE_SCOPES[i].scope;
        onNarrow(scope ? { ...rest, scope } : rest);
      }}
      ariaLabel="Which pages"
    />
  );
}

/**
 * Narrows the picked source: a root tag's objects to those carrying a user
 * tag (a relation kind, for relations), or a user tag's objects to one root
 * tag. Absent when the source can't be narrowed.
 */
function NarrowSelect({
  source,
  picked,
  tags,
  kinds,
  onNarrow,
}: {
  source: QuerySource;
  picked: Entry | null;
  tags: TagLists;
  kinds: string[];
  onNarrow: (s: QuerySource) => void;
}) {
  if (source.by === "tag" && source.tag !== null) {
    const roots = tags.usedOn[source.tag] ?? [];
    if (!roots.length) return null;
    const tag = source.tag;
    return (
      <label className="sb-wbq-narrow">
        <span>on</span>
        <select
          className="sb-select"
          value={source.root ?? ""}
          onChange={(e) => {
            const root = e.currentTarget.value || null;
            onNarrow({ root, tag, by: "tag" });
          }}
        >
          <option value="">any</option>
          {roots.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const root = source.root;
  // A data block's root tag is narrowed already: index.data takes one tag
  if (root === null || !canNarrow(root) || picked?.key.startsWith("data:")) {
    return null;
  }
  const relation = root === "relation";
  const options = relation ? kinds : tagsUsedOn(tags, root);
  if (!options.length) return null;
  return (
    <label className="sb-wbq-narrow">
      <span>{relation ? "kind" : "tagged"}</span>
      <select
        className="sb-select"
        value={source.tag ?? ""}
        onChange={(e) => {
          const tag = e.currentTarget.value || null;
          onNarrow({ ...source, tag });
        }}
      >
        <option value="">any</option>
        {options.map((t) => (
          <option key={t} value={t}>
            {relation || root === "data" ? t : `#${t}`}
          </option>
        ))}
      </select>
    </label>
  );
}

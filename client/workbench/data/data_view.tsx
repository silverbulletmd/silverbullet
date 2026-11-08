import { useEffect, useRef, useState } from "preact/hooks";
import { ResizeHandle } from "../../../plug-api/ui/resize_handle.tsx";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import { QueryPane } from "../query/query_pane.tsx";
import { pickSource, START_SOURCE } from "../query/query_source.ts";
import { useModel } from "../shared/use_model.ts";
import type { TabProps } from "../tab.ts";
import { useWorkbenchTarget } from "../workbench_target.ts";
import type { DataViewKind } from "./data_model.ts";
import { pinnedTags, savePins, togglePin } from "./pins.ts";
import { SchemaView } from "./schema/schema_view.tsx";
import { sourceForEntry, tagOfSource } from "./sources.ts";
import { allEntries, type TagListEntry } from "./tag_list.ts";
import { TagIcon, TagListView } from "./tag_list_view.tsx";

const VIEWS: { view: DataViewKind; label: string; tooltip: string }[] = [
  { view: "objects", label: "Objects", tooltip: "Browse and query objects" },
  { view: "schema", label: "Schema", tooltip: "The tag's attributes" },
];

/**
 * The Data tab: the tag list, and for the selected tag its objects (the
 * query builder) or its schema. It follows the models for the whole tab, so
 * the views inside re-render with it.
 */
export function DataView({
  client,
  session,
  builder,
  data,
  schemas,
  focusTarget,
}: TabProps) {
  useModel(data);
  useModel(builder);
  // Loaded while the tab is, so Declare works from the Objects view too
  useModel(schemas);
  const [phrase, setPhrase] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const entries = data.tags ? allEntries(data.tags) : [];
  const entry = entries.find((e) => e.name === data.selected);
  const m = builder.model;
  const writable =
    !client.bootConfig.readOnly && client.bootConfig.canBuild !== false;

  useEffect(
    () => (filterRef.current ? focusTarget(filterRef.current) : undefined),
    [focusTarget],
  );

  useWorkbenchTarget("Data", (t) => data.showView(t.view));

  useEffect(() => {
    if (!builder.model) void pickSource(client, builder, START_SOURCE);
  }, [client]);

  // The list follows the builder's source…
  const sourceTag = m ? tagOfSource(m.source) : null;
  useEffect(() => {
    if (sourceTag && sourceTag !== data.selected) data.select(sourceTag);
  }, [sourceTag]);

  // …and in the Objects view, the builder follows the list
  useEffect(() => {
    // Read live: the effect above may have just selected the source's tag,
    // as when a query opens while the Schema view shows
    const selected = entries.find((e) => e.name === data.selected);
    if (data.view !== "objects" || !selected || sourceTag === selected.name) {
      return;
    }
    void pickSource(client, builder, sourceForEntry(selected));
  }, [data.selected, data.view, entry?.name]);

  const pick = (e: TagListEntry) => data.select(e.name);
  const togglePinned = (name: string) => {
    savePins(togglePin(pinnedTags(client.config), name)).catch((e) =>
      client.ui.flashNotification(
        `Couldn't pin ${name}: ${e.message}`,
        "error",
      ),
    );
  };

  const label = !entry
    ? data.selected
    : entry.builtIn || entry.data
      ? entry.name
      : `#${entry.name}`;
  const state = !entry
    ? ""
    : entry.builtIn
      ? "built-in schema"
      : entry.defined
        ? "schema defined"
        : "no schema";

  return (
    <div className="sb-workbench sb-wbq-root">
      <div
        className="sb-wb-query"
        style={{
          "--sb-wbd-list-width": `${data.listWidth}px`,
          "--sb-wbd-clauses-width": `${data.clausesWidth}px`,
        }}
      >
        <TagListView
          data={data}
          phrase={phrase}
          setPhrase={setPhrase}
          filterRef={filterRef}
          onPick={pick}
          onTogglePin={togglePinned}
          pinned={pinnedTags(client.config)}
          writable={writable}
        />
        <div className="sb-wbd-main">
          <ResizeHandle
            label="Resize the tag list"
            className="sb-wbd-resize-list"
            size={() => data.listWidth}
            onResize={(w, commit) => data.setWidth("list", w, commit)}
            onReset={() => data.resetWidth("list")}
          />
          <div className="sb-wbd-header">
            <TagIcon icon={entry?.icon ?? "tag"} />
            <span className="sb-wbd-title">{label}</span>
            {entry ? (
              <span className="sb-wbd-meta">
                {entry.count} {entry.count === 1 ? "object" : "objects"} ·{" "}
                <button
                  type="button"
                  className="sb-wbq-link"
                  title="Show the tag's schema"
                  onClick={() => data.showView("schema")}
                >
                  {state}
                </button>
              </span>
            ) : null}
            <span className="sb-wbq-spacer" />
            <SegmentedControl
              items={VIEWS}
              activeIndex={VIEWS.findIndex((v) => v.view === data.view)}
              onPick={(i) => data.showView(VIEWS[i].view)}
              ariaLabel="View"
            />
          </div>
          <label className="sb-wbq-tagpick">
            <span>Tag</span>
            <select
              className="sb-select"
              value={data.selected}
              onChange={(e) => data.select(e.currentTarget.value)}
            >
              {entries.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          {data.view === "objects" ? (
            <QueryPane
              client={client}
              session={session}
              builder={builder}
              entries={entries}
              label={label}
              onOpenTag={(tag) => data.select(tag)}
              clausesHandle={
                <ResizeHandle
                  label="Resize the query editor"
                  className="sb-wbd-resize-clauses"
                  size={() => data.clausesWidth}
                  onResize={(w, commit) => data.setWidth("clauses", w, commit)}
                  onReset={() => data.resetWidth("clauses")}
                />
              }
            />
          ) : (
            <SchemaView
              client={client}
              data={data}
              schemas={schemas}
              builder={builder}
              entry={entry}
              showObjects={async () => {
                if (entry)
                  await pickSource(client, builder, sourceForEntry(entry));
                data.showView("objects");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "preact/hooks";
import {
  filterTags,
  listTags,
  loadFields,
  SAMPLE_LIMIT,
  START_TAG,
} from "../query_source.ts";
import { QueryBar } from "./query_bar.tsx";
import {
  GroupByRow,
  LimitRow,
  OrderByRow,
  WhereRow,
} from "./query_clauses.tsx";
import { FieldsPanel } from "./query_fields_panel.tsx";
import { QueryPreview } from "./query_preview.tsx";
import { SelectRow } from "./query_select.tsx";
import type { TabProps } from "./tab.ts";
import { useBuilder } from "./use_builder.ts";

type Tags = { custom: string[]; builtIn: string[] };

/**
 * The Query tab: pick a tag and look through its objects, shaped by the
 * query editor beside them (one row per clause; it can be closed). The generated text stays in the bar at
 * the bottom.
 */
export function QueryView({ client, session, builder, focusTarget }: TabProps) {
  useBuilder(builder);
  const [tags, setTags] = useState<Tags>({ custom: [], builtIn: [] });
  const [sampled, setSampled] = useState<Record<string, number>>({});
  const [showFields, setShowFields] = useState(false);
  const [phrase, setPhrase] = useState("");
  const tagFilter = useRef<HTMLInputElement>(null);
  const m = builder.model;

  async function pick(tag: string) {
    const old = builder.model?.tag;
    if (tag === old) return;
    const { fields, sampled: n } = await loadFields(client, tag);
    setSampled((s) => ({ ...s, [tag]: n }));
    if (builder.pickTag(tag, fields)) {
      client.ui.flashNotification(`Cleared the query for ${old}`, "info", {
        actions: [{ name: "Undo", run: () => void builder.undo() }],
      });
    }
  }

  useEffect(() => {
    void listTags(client).then(setTags);
    if (!builder.model) void pick(START_TAG);
    // Opened early, the space's scripts or index may not be there yet; when
    // they arrive the tags, fields and results follow, keeping the query
    const refresh = async () => {
      setTags(await listTags(client));
      const tag = builder.model?.tag;
      if (!tag) return;
      const { fields, sampled: n } = await loadFields(client, tag);
      // Another tag picked meanwhile brought its own fields
      if (builder.model?.tag !== tag) return;
      setSampled((s) => ({ ...s, [tag]: n }));
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

  const count = (tag: string) => {
    const n = sampled[tag];
    if (n === undefined) return null;
    return n >= SAMPLE_LIMIT ? `${SAMPLE_LIMIT}+` : String(n);
  };
  const tagButton = (tag: string, custom: boolean) => (
    <button
      key={tag}
      type="button"
      className={`sb-wbq-tag${m?.tag === tag ? " sb-wbq-tag-on" : ""}`}
      aria-pressed={m?.tag === tag}
      onClick={() => void pick(tag)}
    >
      <span>
        {custom ? "#" : ""}
        {tag}
      </span>
      {m?.tag === tag ? (
        <span className="sb-wbq-count">{count(tag)}</span>
      ) : null}
    </button>
  );

  const shown = filterTags(tags, phrase);

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
                const first = shown.builtIn[0] ?? shown.custom[0];
                if (first) void pick(first);
              } else if (e.key === "Escape" && phrase) {
                // Clears the filter; a second Escape is the panel's
                e.preventDefault();
                e.stopPropagation();
                setPhrase("");
              }
            }}
          />
          {shown.builtIn.length ? (
            <div className="sb-wbq-group">Built-in</div>
          ) : null}
          {shown.builtIn.map((t) => tagButton(t, false))}
          {shown.custom.length ? (
            <div className="sb-wbq-group">Custom</div>
          ) : null}
          {shown.custom.map((t) => tagButton(t, true))}
          {!shown.custom.length && !shown.builtIn.length ? (
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
              value={m?.tag}
              onChange={(e) => void pick(e.currentTarget.value)}
            >
              {[...tags.builtIn, ...tags.custom].map((t) => (
                <option key={t} value={t}>
                  {tags.custom.includes(t) ? "#" : ""}
                  {t}
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
                  <span className="sb-wbq-chip">
                    {tags.custom.includes(m.tag) ? "#" : ""}
                    {m.tag}
                  </span>
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

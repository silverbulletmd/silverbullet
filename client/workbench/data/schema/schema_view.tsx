import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import { Button } from "@silverbulletmd/silverbullet/ui";
import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Client } from "../../../client.ts";
import {
  invalidManagedBlockMessage,
  SCHEMAS_BLOCK,
} from "../../../config_management/config_block.ts";
import { CONFIG_PAGE } from "../../../config_management/config_page.ts";
import {
  defineStatement,
  type JsonSchema,
} from "../../../config_management/schema_lua.ts";
import type { AttributeInfo } from "../../query/query_attributes.ts";
import type { QueryBuilder } from "../../query/query_builder.ts";
import { objectVar } from "../../query/query_model.ts";
import { loadAttributes, SAMPLE_LIMIT } from "../../query/query_source.ts";
import { copyText, openRef } from "../../shared/action.ts";
import { BlockNote } from "../../shared/block_ui.tsx";
import type { DataModel } from "../data_model.ts";
import { IconPicker } from "../icon_picker.tsx";
import { sourceForEntry } from "../sources.ts";
import { type TagListEntry, tagIcon } from "../tag_list.ts";
import { AddAttributeRow, AttributeRowView } from "./attribute_row.tsx";
import type { SaveResult, SchemaDrafts } from "./schema_drafts.ts";
import { objectsFilter, type SchemaLink } from "./schema_links.ts";
import {
  buildRows,
  type DraftRow,
  schemaFor,
  withDraft,
} from "./schema_rows.ts";

type Loaded = {
  tag: string;
  attributes: AttributeInfo[];
  samples: Record<string, unknown>[];
  root: string | null;
};

const READ_ONLY_NOTE =
  "This space is read-only: schemas can be inspected here, but not changed.";

/**
 * The Data tab's Schema view: the selected tag's attributes, editable in
 * place. It re-renders with `DataView`, which follows `data` and `schemas`.
 */
export function SchemaView({
  client,
  data,
  schemas,
  builder,
  entry,
  showObjects,
}: {
  client: Client;
  data: DataModel;
  schemas: SchemaDrafts;
  builder: QueryBuilder;
  entry: TagListEntry | undefined;
  showObjects: () => Promise<void>;
}) {
  const tag = data.selected;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<SaveResult | null>(null);

  useEffect(() => {
    if (!entry) return;
    let current = true;
    void (async () => {
      const { attributes, samples, root } = await loadAttributes(
        client,
        sourceForEntry(entry),
      );
      if (current) setLoaded({ tag: entry.name, attributes, samples, root });
    })();
    return () => {
      current = false;
    };
    // Reload on every config reload too, which `schemas` notifies about
  }, [entry?.name, entry?.count, schemas.ready && schemas.blockError]);

  useEffect(() => setResult(null), [tag]);

  const writable = schemas.writable && !schemas.blockError;
  const effective: JsonSchema | null = client.config.get(
    ["tags", tag, "schema"],
    null,
  );
  const rows: DraftRow[] =
    loaded && loaded.tag === tag
      ? withDraft(
          buildRows({
            effective,
            rootSchema: loaded.root
              ? client.config.get(["tags", loaded.root, "schema"], null)
              : null,
            localPaths: schemas.localPaths(tag),
            inferred: loaded.attributes,
            samples: loaded.samples,
          }),
          schemas.draft(tag),
        )
      : [];
  const invalid = rows.reduce((n, r) => n + r.invalid, 0);
  useEffect(() => {
    if (loaded?.tag === tag && entry?.invalid !== invalid) {
      data.setInvalid(tag, invalid);
    }
  }, [loaded, invalid]);

  const ownership = schemas.ownership(tag);
  const creating = ownership === "none" && !entry?.builtIn;
  const draft = schemas.draft(tag);
  const conflict = schemas.conflict(tag);
  const definitions = schemas.definitions(tag);
  const sampled = loaded?.samples.length ?? 0;
  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  async function link(l: SchemaLink) {
    await showObjects();
    const m = builder.model;
    if (!m) return;
    const filter = objectsFilter(l, objectVar(m));
    builder.update((model) => ({
      ...model,
      filters: [...model.filters, filter],
    }));
  }

  async function save() {
    setResult(await schemas.save(tag));
  }

  async function create() {
    schemas.declare(
      tag,
      schemaFor(
        rows,
        (row) => row.origin === "inferred" && keep[row.name] !== false,
      ),
    );
    await save();
  }

  // A draft's null is "no icon", shown as the plain tag glyph the list falls back to
  const iconNow =
    (draft?.icon === null ? "tag" : draft?.icon) ??
    tagIcon(client.config.get(["tags"], {}), tag);

  return (
    <div
      className="sb-wbd-schema"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s" && draft) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="sb-wb-toolbar">
        <IconPicker
          icon={iconNow}
          disabled={!writable}
          onPick={(name) => schemas.setIcon(tag, name)}
        />
        <span className="sb-wbd-meta">
          {ownership === "owned" ? (
            "Defined in the Workbench"
          ) : ownership === "external" ? (
            <>
              Defined in{" "}
              {definitions.length
                ? definitions.map((d, i) => (
                    <Fragment key={d.ref}>
                      {i > 0 ? ", " : ""}
                      <a
                        href="#"
                        title="Open the definition"
                        onClick={(e) => {
                          e.preventDefault();
                          const ref = parseToRef(d.ref);
                          if (ref) void openRef(client, ref);
                        }}
                      >
                        {d.page}
                      </a>
                    </Fragment>
                  ))
                : "a script"}
              ; your changes are kept separately in CONFIG
            </>
          ) : (
            "No schema yet"
          )}
        </span>
        <span className="sb-wbq-spacer" />
        {!creating || draft ? (
          <button
            type="button"
            className="sb-wbq-link"
            onClick={() =>
              void copyText(client, defineStatement(tag, schemaFor(rows)))
            }
          >
            Copy as tag.define
          </button>
        ) : null}
        {draft && writable ? (
          <>
            <Button
              disabled={schemas.saving}
              onClick={() => {
                schemas.discard(tag);
                setResult(null);
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              disabled={schemas.saving}
              onClick={() => void save()}
            >
              {schemas.saving ? "Saving…" : "Save and apply"}
            </Button>
          </>
        ) : null}
        {creating && !draft && writable && loaded?.tag === tag ? (
          <Button
            variant="primary"
            disabled={schemas.saving}
            onClick={() => void create()}
          >
            Create schema
          </Button>
        ) : null}
      </div>
      {!schemas.writable && schemas.ready ? (
        <BlockNote>
          {client.bootConfig.canBuild === false
            ? "Builder access is required to change schemas. You can still inspect schemas and build queries."
            : READ_ONLY_NOTE}
        </BlockNote>
      ) : null}
      {schemas.loadError ? (
        <div className="sb-wb-cfg-error">{schemas.loadError}</div>
      ) : null}
      {schemas.blockError ? (
        <div className="sb-wb-cfg-error">
          {invalidManagedBlockMessage(schemas.blockError, SCHEMAS_BLOCK)}{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void openRef(client, { path: `${CONFIG_PAGE}.md` });
            }}
          >
            Open CONFIG
          </a>
        </div>
      ) : null}
      {conflict.length ? (
        <BlockNote>
          #{tag} also gets a schema from{" "}
          {conflict.map((c) => c.page).join(", ")}. The Workbench's definition
          runs later and replaces it.
        </BlockNote>
      ) : null}
      {result && !result.ok ? (
        <div className="sb-wb-cfg-error">
          {result.savedButNotApplied ? "Saved, but not applied: " : ""}
          {result.error}
        </div>
      ) : null}
      {result?.ok && result.shadowed.length ? (
        <BlockNote>
          Saved, but a later script overrides {result.shadowed.join(", ")}, so
          that part doesn't take effect.
        </BlockNote>
      ) : null}
      {creating && !draft ? (
        <BlockNote>
          Found in this tag's objects. Pick the attributes to declare, then
          create the schema. Nothing is required until you say so.
        </BlockNote>
      ) : null}
      <div className="sb-workbench-body">
        {!loaded || loaded.tag !== tag ? (
          <BlockNote>Loading…</BlockNote>
        ) : (
          <table className="sb-wbd-attrs">
            <thead>
              <tr>
                {creating && !draft ? <th aria-label="Declare" /> : null}
                <th>Attribute</th>
                <th>Type</th>
                <th>Description</th>
                <th>Required</th>
                <th>Present</th>
                <th>Origin</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AttributeRowView
                  key={row.renamedFrom ?? row.name}
                  row={row}
                  creating={creating && !draft}
                  kept={keep[row.name] !== false}
                  onKeep={(k) => setKeep({ ...keep, [row.name]: k })}
                  writable={writable}
                  error={fieldErrors[row.name]}
                  schemas={schemas}
                  tag={tag}
                  link={(l) => void link(l)}
                />
              ))}
              {writable && !(creating && !draft) ? (
                <AddAttributeRow
                  onAdd={(name) =>
                    schemas.setRule(tag, name, { type: "string" })
                  }
                />
              ) : null}
            </tbody>
          </table>
        )}
      </div>
      <div className="sb-wb-footer">
        <span>{rows.length.toLocaleString()} attributes</span>
        <span>
          {sampled >= SAMPLE_LIMIT
            ? `Present counts come from a sample of ${SAMPLE_LIMIT} objects`
            : `Present counts come from ${sampled.toLocaleString()} objects`}
        </span>
        <span className="sb-wb-cfg-saved-to">
          Saved to{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void openRef(client, { path: `${CONFIG_PAGE}.md` });
            }}
          >
            CONFIG
          </a>
        </span>
      </div>
    </div>
  );
}

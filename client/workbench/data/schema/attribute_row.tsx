import { useState } from "preact/hooks";
import { ActionMenu } from "../../shared/action_menu.tsx";
import type { SchemaDrafts } from "./schema_drafts.ts";
import type { SchemaLink } from "./schema_links.ts";
import type { DraftRow } from "./schema_rows.ts";
import { typeLabel } from "./schema_type.ts";
import { LuaSchemaEditor, TypeEditor } from "./type_editor.tsx";

/** One attribute of the Schema view, edited in place */
export function AttributeRowView({
  row,
  creating,
  kept,
  onKeep,
  writable,
  error,
  schemas,
  tag,
  link,
}: {
  row: DraftRow;
  creating: boolean;
  kept: boolean;
  onKeep: (keep: boolean) => void;
  writable: boolean;
  error?: string;
  schemas: SchemaDrafts;
  tag: string;
  link: (l: SchemaLink) => void;
}) {
  const editable = writable && !creating && !row.removed;
  const [luaOpen, setLuaOpen] = useState(false);
  const schema = row.schema ?? row.suggested;
  const original = row.renamedFrom ?? row.name;
  const partial = row.sampled > 0 && row.present < row.sampled;
  return (
    <tr
      className={[
        row.removed ? "sb-wbd-removed" : "",
        row.edited || row.added || row.renamedFrom ? "sb-wbd-edited" : "",
        row.origin === "inferred" ? "sb-wbd-inferred" : "",
      ].join(" ")}
    >
      {creating ? (
        <td>
          {row.origin === "inferred" ? (
            <input
              type="checkbox"
              aria-label={`Declare ${row.name}`}
              checked={kept}
              onChange={(e) => onKeep(e.currentTarget.checked)}
            />
          ) : null}
        </td>
      ) : null}
      <td>
        <input
          className="sb-wbd-input sb-wbd-name-input"
          aria-label="Attribute name"
          value={row.name}
          disabled={!editable || row.origin === "inherited"}
          onChange={(e) => {
            const to = e.currentTarget.value.trim();
            if (to && to !== row.name) schemas.rename(tag, original, to);
          }}
        />
        {row.invalid > 0 ? (
          <button
            type="button"
            className="sb-wbq-link sb-wbd-invalid"
            onClick={() =>
              row.schema &&
              link({ kind: "invalid", attribute: row.name, schema: row.schema })
            }
          >
            ⚠ {row.invalid} invalid
          </button>
        ) : null}
        {error ? <div className="sb-wbd-error">{error}</div> : null}
      </td>
      <td>
        {row.schema ? (
          luaOpen ? (
            <LuaSchemaEditor
              schema={row.schema}
              onApply={(s) => {
                schemas.setRule(tag, row.name, s);
                setLuaOpen(false);
              }}
              onCancel={() => setLuaOpen(false)}
            />
          ) : (
            <TypeEditor
              schema={row.schema}
              disabled={!editable}
              onChange={(s) => schemas.setRule(tag, row.name, s)}
              onValue={(value) =>
                link({ kind: "value", attribute: row.name, value })
              }
              onEditLua={() => setLuaOpen(true)}
            />
          )
        ) : schema ? (
          // Found in the objects but not in the schema: the type it would get
          <span className="sb-wbd-type">
            <span
              className="sb-wbd-suggested"
              title="Not in the schema: the type its values suggest"
            >
              {typeLabel(schema)}
            </span>
            {!creating && editable ? (
              <button
                type="button"
                className="sb-wbq-link"
                title="Add this attribute to the schema with this type"
                onClick={() => schemas.setRule(tag, row.name, schema)}
              >
                Add to schema
              </button>
            ) : null}
          </span>
        ) : null}
      </td>
      <td>
        <input
          className="sb-wbd-input"
          aria-label="Description"
          value={row.schema?.description ?? ""}
          disabled={!editable || !row.schema}
          onChange={(e) => {
            const description = e.currentTarget.value;
            const { description: _, ...rest } = row.schema ?? {};
            schemas.setRule(
              tag,
              row.name,
              description ? { ...rest, description } : rest,
            );
          }}
        />
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={`${row.name} is required`}
          checked={row.required}
          disabled={!editable}
          onChange={(e) =>
            schemas.setRequired(tag, row.name, e.currentTarget.checked)
          }
        />
      </td>
      <td>
        {row.sampled === 0 ? (
          "–"
        ) : partial ? (
          <button
            type="button"
            className="sb-wbq-link"
            title="Show the objects without it"
            onClick={() => link({ kind: "missing", attribute: row.name })}
          >
            {row.present} / {row.sampled}
          </button>
        ) : (
          `${row.present} / ${row.sampled}`
        )}
      </td>
      <td className="sb-wbd-origin">{row.removed ? "removed" : row.origin}</td>
      <td>
        {editable || (writable && row.removed) ? (
          <ActionMenu
            actions={[
              ...(schema && editable
                ? [
                    {
                      label: "Edit as Lua",
                      icon: "edit" as const,
                      run: async () => setLuaOpen(true),
                    },
                  ]
                : []),
              {
                label: "Reset",
                icon: "revert" as const,
                run: async () => schemas.reset(tag, original),
              },
              ...(row.removed
                ? []
                : [
                    {
                      label: "Remove rule",
                      icon: "remove" as const,
                      run: async () => schemas.removeRule(tag, row.name),
                    },
                  ]),
            ]}
            deps={undefined}
          />
        ) : null}
      </td>
    </tr>
  );
}

export function AddAttributeRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <tr className="sb-wbd-add">
      <td colSpan={8}>
        <input
          className="sb-wbd-input"
          aria-label="New attribute"
          placeholder="Add attribute"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              onAdd(name.trim());
              setName("");
            }
          }}
        />
      </td>
    </tr>
  );
}

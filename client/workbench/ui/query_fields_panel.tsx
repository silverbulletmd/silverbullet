import type { Client } from "../../client.ts";
import { copyText } from "../action.ts";
import type { QueryBuilder } from "../query_builder.ts";
import {
  type Dropped,
  droppedMessage,
  dropSystemFieldUses,
  setFieldType,
} from "../query_edits.ts";
import {
  type FieldInfo,
  type FieldType,
  tagDefineSnippet,
} from "../query_fields.ts";
import { schemaTag } from "../query_from.ts";
import type { QueryModel } from "../query_model.ts";
import { TYPE_LABEL } from "./query_filter_editor.tsx";

const TYPES: Exclude<FieldType, "mixed">[] = [
  "text",
  "enum",
  "number",
  "boolean",
  "date",
  "datetime",
  "list",
  "pagelink",
  "url",
  "record",
];

const SEEN = 4;

function seen(f: FieldInfo, type: FieldType): string {
  if (type === "number" && f.range) return `${f.range[0]}–${f.range[1]}`;
  return f.values
    .slice(0, SEEN)
    .map(([v, n]) => (n > 1 ? `${v} ×${n}` : v))
    .join(", ");
}

function mixedText(f: FieldInfo): string {
  return Object.entries(f.mixed ?? {})
    .map(([t, n]) => `${n} ${TYPE_LABEL[t as FieldType] ?? t}`)
    .join(", ");
}

/**
 * Applies an edit that may drop parts of the query, undoably, and flashes
 * what it dropped with Undo
 */
function applyDropping(
  client: Client,
  builder: QueryBuilder,
  what: string,
  edit: (m: QueryModel) => { model: QueryModel; dropped: Dropped },
) {
  if (!builder.model) return;
  const { model, dropped } = edit(builder.model);
  builder.update(() => model, { undoable: true });
  const message = droppedMessage(what, dropped);
  if (!message) return;
  client.ui.flashNotification(message, "info", {
    actions: [{ name: "Undo", run: () => void builder.undo() }],
  });
}

/**
 * Every field of the tag: its type (changeable for the session), where it
 * came from, how many objects have it, and values seen.
 */
export function FieldsPanel({
  client,
  builder,
  onClose,
}: {
  client: Client;
  builder: QueryBuilder;
  onClose: () => void;
}) {
  const m = builder.model;
  if (!m) return null;
  const fields = builder.offeredFields();

  const setType = (f: FieldInfo, type: FieldType) =>
    applyDropping(client, builder, f.name, (x) => setFieldType(x, f, type));

  const setShowSystem = (show: boolean) => {
    builder.setShowSystem(show);
    if (!show) {
      applyDropping(client, builder, "system fields", (x) =>
        dropSystemFieldUses(x, builder.fields),
      );
    }
  };

  return (
    <div className="sb-wbq-fields">
      <div className="sb-wbq-fields-scroll">
        <table aria-label="Fields">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Source</th>
              <th>Present</th>
              <th>Seen values</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const override = m.overrides[f.name];
              const type = override ?? f.type;
              const options =
                f.type === "mixed" && !override ? ["mixed", ...TYPES] : TYPES;
              return (
                <tr key={f.name} aria-label={f.name}>
                  <td className="sb-wbq-field">{f.name}</td>
                  <td>
                    <select
                      className="sb-select"
                      aria-label={`Type of ${f.name}`}
                      value={type}
                      onChange={(e) =>
                        setType(f, e.currentTarget.value as FieldType)
                      }
                    >
                      {options.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t as FieldType]}
                          {t === "enum" && f.enumValues
                            ? ` (${f.enumValues.length})`
                            : ""}
                        </option>
                      ))}
                    </select>
                    {f.mixed ? (
                      <div className="sb-wbq-warn">
                        {override ? "changed from mixed" : "mixed"}:{" "}
                        {mixedText(f)}
                      </div>
                    ) : override ? (
                      <div className="sb-wbq-warn">
                        changed from {TYPE_LABEL[f.type]}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className={`sb-wbq-badge sb-wbq-badge-${f.source}`}>
                      {f.source}
                    </span>
                  </td>
                  <td className="sb-wbq-num">
                    {f.present}/{f.total}
                  </td>
                  <td className="sb-wbq-seen" title={seen(f, type)}>
                    {seen(f, type)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sb-wbq-fields-foot">
        <label>
          <input
            type="checkbox"
            checked={builder.showSystem}
            onChange={(e) => setShowSystem(e.currentTarget.checked)}
          />{" "}
          System fields
        </label>
        <span className="sb-wbq-note">
          Changing a type only changes the filters offered.
        </span>
        <span className="sb-wbq-spacer" />
        {fields.some((f) => f.source === "inferred") ? (
          <button
            type="button"
            className="sb-wbq-link"
            onClick={() =>
              void copyText(
                client,
                tagDefineSnippet(
                  schemaTag(m.source),
                  builder.fields,
                  m.overrides,
                ),
              )
            }
          >
            Copy as tag.define
          </button>
        ) : null}
        <button
          type="button"
          className="sb-wbq-x"
          aria-label="Close schema"
          title="Close schema"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

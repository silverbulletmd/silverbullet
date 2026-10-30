import type { Client } from "../../client.ts";
import { copyText } from "../shared/action.ts";
import {
  type AttributeInfo,
  type AttributeType,
  tagDefineSnippet,
} from "./query_attributes.ts";
import type { QueryBuilder } from "./query_builder.ts";
import {
  type Dropped,
  droppedMessage,
  dropSystemAttributeUses,
  setAttributeType,
} from "./query_edits.ts";
import { TYPE_LABEL } from "./query_filter_editor.tsx";
import { schemaTag } from "./query_from.ts";
import type { QueryModel } from "./query_model.ts";

const TYPES: Exclude<AttributeType, "mixed">[] = [
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

function seen(f: AttributeInfo, type: AttributeType): string {
  if (type === "number" && f.range) return `${f.range[0]}–${f.range[1]}`;
  return f.values
    .slice(0, SEEN)
    .map(([v, n]) => (n > 1 ? `${v} ×${n}` : v))
    .join(", ");
}

function mixedText(f: AttributeInfo): string {
  return Object.entries(f.mixed ?? {})
    .map(([t, n]) => `${n} ${TYPE_LABEL[t as AttributeType] ?? t}`)
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
 * Every attribute of the tag: its type (changeable for the session), where it
 * came from, how many objects have it, and values seen.
 */
export function AttributesPanel({
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
  const attributes = builder.offeredAttributes();

  const setType = (f: AttributeInfo, type: AttributeType) =>
    applyDropping(client, builder, f.name, (x) => setAttributeType(x, f, type));

  const setShowSystem = (show: boolean) => {
    builder.setShowSystem(show);
    if (!show) {
      applyDropping(client, builder, "system attributes", (x) =>
        dropSystemAttributeUses(x, builder.attributes),
      );
    }
  };

  return (
    <div className="sb-wbq-attributes">
      <div className="sb-wbq-attributes-scroll">
        <table aria-label="Attributes">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Type</th>
              <th>Source</th>
              <th>Present</th>
              <th>Seen values</th>
            </tr>
          </thead>
          <tbody>
            {attributes.map((f) => {
              const override = m.overrides[f.name];
              const type = override ?? f.type;
              const options =
                f.type === "mixed" && !override ? ["mixed", ...TYPES] : TYPES;
              return (
                <tr key={f.name} aria-label={f.name}>
                  <td className="sb-wbq-attribute">{f.name}</td>
                  <td>
                    <select
                      className="sb-select"
                      aria-label={`Type of ${f.name}`}
                      value={type}
                      onChange={(e) =>
                        setType(f, e.currentTarget.value as AttributeType)
                      }
                    >
                      {options.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t as AttributeType]}
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
      <div className="sb-wbq-attributes-foot">
        <label>
          <input
            type="checkbox"
            checked={builder.showSystem}
            onChange={(e) => setShowSystem(e.currentTarget.checked)}
          />{" "}
          System attributes
        </label>
        <span className="sb-wbq-note">
          Changing a type only changes the filters offered.
        </span>
        <span className="sb-wbq-spacer" />
        {attributes.some((f) => f.source === "inferred") ? (
          <button
            type="button"
            className="sb-wbq-link"
            onClick={() =>
              void copyText(
                client,
                tagDefineSnippet(
                  schemaTag(m.source),
                  builder.attributes,
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

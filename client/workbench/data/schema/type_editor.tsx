import { useState } from "preact/hooks";
import {
  type JsonSchema,
  schemaFromLuaText,
  schemaToLua,
} from "../../../config_management/schema_lua.ts";
import {
  applyTypeChoice,
  choiceFor,
  readTypeChoice,
  TYPE_KINDS,
  type TypeChoice,
  type TypeKind,
  typeKindOf,
  typeLabel,
} from "./schema_type.ts";

const FORMATS = ["", "date", "date-time", "uri", "email"];

/** The type menu's way into the Lua editor, for any schema the controls don't cover */
const CUSTOM = "custom";

export /** Type, format, enum values, ref target and nullability of one rule */
function TypeEditor({
  schema,
  disabled,
  onChange,
  onValue,
  onEditLua,
}: {
  schema: JsonSchema;
  disabled: boolean;
  onChange: (schema: JsonSchema) => void;
  onValue: (value: string) => void;
  onEditLua: () => void;
}) {
  const choice = readTypeChoice(schema);
  const kind = typeKindOf(choice);
  if (choice.kind === "advanced" || !kind) {
    return (
      <span className="sb-wbd-type">
        <span title="No simple controls for this rule">
          {typeLabel(schema)}
        </span>
        {disabled ? null : (
          <button type="button" className="sb-wbq-link" onClick={onEditLua}>
            Edit as Lua
          </button>
        )}
      </span>
    );
  }
  const set = (c: TypeChoice) => onChange(applyTypeChoice(schema, c));
  return (
    <span className="sb-wbd-type">
      <select
        className="sb-select"
        aria-label="Type"
        value={kind}
        disabled={disabled}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (value === CUSTOM) {
            // The select keeps showing the current type until Lua replaces it
            e.currentTarget.value = kind;
            onEditLua();
            return;
          }
          set(choiceFor(value as TypeKind, choice.nullable, choice));
        }}
      >
        {TYPE_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
        <option value={CUSTOM}>custom (Lua)…</option>
      </select>
      {choice.kind === "type" && choice.type === "string" && !choice.enum ? (
        <select
          className="sb-select"
          aria-label="Format"
          value={choice.format ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const format = e.currentTarget.value;
            const { format: _, ...rest } = choice;
            set(format ? { ...rest, format } : rest);
          }}
        >
          {[...new Set([...FORMATS, choice.format ?? ""])].map((f) => (
            <option key={f} value={f}>
              {f || "any text"}
            </option>
          ))}
        </select>
      ) : null}
      {choice.kind === "type" && choice.enum ? (
        <>
          <input
            className="sb-wbd-input"
            aria-label="Allowed values"
            placeholder="planned, active, done"
            disabled={disabled}
            value={choice.enum.join(", ")}
            onChange={(e) =>
              set({
                ...choice,
                enum: e.currentTarget.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
          {choice.enum.map((v) => (
            <button
              key={v}
              type="button"
              className="sb-wbq-link"
              title={`Show objects with ${v}`}
              onClick={() => onValue(v)}
            >
              {v}
            </button>
          ))}
        </>
      ) : null}
      {choice.kind === "ref" ? (
        <input
          className="sb-wbd-input"
          aria-label="Target tag"
          placeholder="any tag"
          disabled={disabled}
          value={choice.tag ?? ""}
          onChange={(e) => {
            const tag = e.currentTarget.value.trim().replace(/^#/, "");
            set(
              tag
                ? { ...choice, tag }
                : { kind: "ref", nullable: choice.nullable },
            );
          }}
        />
      ) : null}
      <label
        className="sb-wbd-nullable"
        title="Also accept the attribute left empty, like `due:` with nothing after it (a null value)"
      >
        <input
          type="checkbox"
          checked={choice.nullable}
          disabled={disabled}
          onChange={(e) =>
            set({ ...choice, nullable: e.currentTarget.checked })
          }
        />
        allow empty
      </label>
    </span>
  );
}

export /** A rule as Lua, for shapes the type controls can't show */
function LuaSchemaEditor({
  schema,
  onApply,
  onCancel,
}: {
  schema: JsonSchema;
  onApply: (schema: JsonSchema) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() => schemaToLua(schema));
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const result = schemaFromLuaText(text);
    if ("error" in result) setError(result.error);
    else onApply(result.schema);
  };
  return (
    <span className="sb-wbd-lua">
      <textarea
        className="sb-wbd-input"
        aria-label="Rule as Lua"
        spellcheck={false}
        rows={Math.min(10, text.split("\n").length + 1)}
        value={text}
        ref={(el) => el?.focus()}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {error ? <span className="sb-wbd-error">{error}</span> : null}
      <span>
        <button type="button" className="sb-wbq-link" onClick={apply}>
          Apply
        </button>{" "}
        <button type="button" className="sb-wbq-link" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </span>
  );
}

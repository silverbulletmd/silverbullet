import { Button } from "@silverbulletmd/silverbullet/ui";
import type { Client } from "../../client.ts";
import { LuaLineInput } from "../shared/lua_line_input.tsx";
import type { QueryBuilder } from "./query_builder.ts";
import { changeOperator, newFieldFilter } from "./query_edits.ts";
import type { FieldType } from "./query_fields.ts";
import { fieldChoices } from "./query_model.ts";
import {
  type Filter,
  filterValid,
  operatorOf,
  operatorsFor,
} from "./query_ops.ts";

export const TYPE_LABEL: Record<FieldType, string> = {
  text: "text",
  enum: "one of",
  number: "number",
  boolean: "true/false",
  date: "date",
  datetime: "date-time",
  list: "list",
  pagelink: "page link",
  url: "URL",
  record: "record",
  mixed: "mixed",
};

const MULTI_CHOICES = 12;
const SUGGESTIONS = 20;

export function FieldSelect({
  builder,
  value,
  label = "Field",
  withTypes = true,
  onChange,
}: {
  builder: QueryBuilder;
  value: string;
  label?: string;
  withTypes?: boolean;
  onChange: (name: string) => void;
}) {
  return (
    <select
      className="sb-select"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    >
      {builder.offeredFields().map((f) => (
        <option key={f.name} value={f.name}>
          {f.name}
          {withTypes ? ` · ${TYPE_LABEL[builder.typeOf(f.name)]}` : ""}
        </option>
      ))}
    </select>
  );
}

/** Closes an editor without applying it, from its top-right corner */
export function EditorClose({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sb-wbq-x sb-wbq-editor-close"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      ✕
    </button>
  );
}

export function FilterEditor({
  client,
  builder,
  draft,
  isNew,
  onChange,
  onApply,
  onCancel,
}: {
  client: Client;
  builder: QueryBuilder;
  draft: Filter;
  isNew: boolean;
  onChange: (f: Filter) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const valid =
    draft.kind === "expr"
      ? draft.expr.trim() !== ""
      : filterValid(draft, builder.typeOf(draft.field));
  const apply = () => {
    if (valid) onApply();
  };
  const buttons = (
    <>
      <EditorClose
        label={isNew ? "Discard filter" : "Discard changes"}
        onClick={onCancel}
      />
      <span className="sb-wbq-spacer" />
      <Button variant="primary" disabled={!valid} onClick={apply}>
        {isNew ? "Add filter" : "Update"}
      </Button>
    </>
  );

  if (draft.kind === "expr") {
    return (
      <div className="sb-wbq-editor">
        <LuaLineInput
          client={client}
          label="Expression"
          initial={draft.expr}
          placeholder='t.name:startsWith("Work/")'
          autoFocus
          onChange={(expr) => onChange({ kind: "expr", expr })}
          onEnter={apply}
        />
        {buttons}
      </div>
    );
  }

  const m = builder.model!;
  const type = builder.typeOf(draft.field);
  const op = operatorOf(type, draft.op);
  const choices = fieldChoices(builder.fields, draft.field);
  const setValue = (i: number, v: string) => {
    const values = [...draft.values];
    values[i] = v;
    onChange({ ...draft, values: Array.from(values, (x) => x ?? "") });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    }
  };
  const listId = `sb-wbq-seen-${draft.field}`;
  const suggestions =
    type === "pagelink"
      ? client.ui.viewState.allPages.map((p) => p.name)
      : choices.map(([v]) => v);
  const valueInput = (i: number) => (
    <input
      className="sb-wbq-input"
      aria-label={i === 0 ? "Value" : "Second value"}
      type={op.input === "text" ? undefined : op.input}
      list={op.input === "text" ? listId : undefined}
      value={draft.values[i] ?? ""}
      onInput={(e) => setValue(i, e.currentTarget.value)}
      onKeyDown={onKey}
    />
  );

  let input = null;
  switch (op.input) {
    case "text":
      input = (
        <>
          {valueInput(0)}
          <datalist id={listId}>
            {suggestions.slice(0, SUGGESTIONS).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
      );
      break;
    case "number":
    case "date":
      input =
        op.arity === 2 ? (
          <>
            {valueInput(0)}
            <span className="sb-wbq-note">and</span>
            {valueInput(1)}
          </>
        ) : (
          valueInput(0)
        );
      break;
    case "enum":
      input = (
        <select
          className="sb-select"
          aria-label="Value"
          value={draft.values[0] ?? ""}
          onChange={(e) => setValue(0, e.currentTarget.value)}
        >
          {choices.map(([v, n]) => (
            <option key={v} value={v}>
              {v} ({n})
            </option>
          ))}
        </select>
      );
      break;
    case "multi":
      input = (
        <fieldset className="sb-wbq-multi" aria-label="Values">
          {choices.slice(0, MULTI_CHOICES).map(([v, n]) => (
            <label key={v}>
              <input
                type="checkbox"
                checked={draft.values.includes(v)}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    values: e.currentTarget.checked
                      ? [...draft.values, v]
                      : draft.values.filter((x) => x !== v),
                  })
                }
              />
              {v} <span className="sb-wbq-note">{n}</span>
            </label>
          ))}
        </fieldset>
      );
      break;
  }

  return (
    <div className="sb-wbq-editor">
      <FieldSelect
        builder={builder}
        value={draft.field}
        onChange={(name) => onChange(newFieldFilter(m, builder.fields, name))}
      />
      <select
        className="sb-select"
        aria-label="Operator"
        value={op.id}
        onChange={(e) =>
          onChange(
            changeOperator(
              m,
              builder.fields,
              draft.field,
              e.currentTarget.value,
            ),
          )
        }
      >
        {operatorsFor(type).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {input}
      {buttons}
    </div>
  );
}

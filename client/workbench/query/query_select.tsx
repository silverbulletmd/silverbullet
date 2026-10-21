import { openRef } from "../shared/action.ts";
import { LuaLineInput } from "../shared/lua_line_input.tsx";
import { AddButton, Clause, type RowProps } from "./query_clauses.tsx";
import {
  changeColumnKind,
  changeGroupColumn,
  changeSelectMode,
  GROUP_KEY_CHOICE,
  isGrouped,
  removeGroupColumn,
} from "./query_edits.ts";
import { FieldSelect } from "./query_filter_editor.tsx";
import { sourceType } from "./query_from.ts";
import {
  fieldColumn,
  type GroupColumn,
  newId,
  objectVar,
  type TableColumn,
  tableColumns,
} from "./query_model.ts";
import { aggregateChoices } from "./query_source.ts";
import { loadTemplates, templatesFor } from "./query_templates.ts";

function replaceAt<T>(items: T[], i: number, item: T): T[] {
  return items.map((x, j) => (j === i ? item : x));
}

function moveBy<T>(items: T[], i: number, d: number): T[] {
  const next = [...items];
  const [x] = next.splice(i, 1);
  next.splice(i + d, 0, x);
  return next;
}

function TableColumns({ client, builder, model }: RowProps) {
  if (model.select.mode !== "table") return null;
  const columns = model.select.columns;
  const setColumns = (next: TableColumn[]) =>
    builder.update((m) => ({ ...m, select: { mode: "table", columns: next } }));
  const patch = (i: number, c: TableColumn) =>
    setColumns(replaceAt(columns, i, c));
  const v = objectVar(model);

  return (
    <div className="sb-wbq-columns">
      {columns.map((c, i) => (
        <div
          key={c.id}
          className="sb-wbq-column sb-wbq-tablecol"
          role="group"
          aria-label={`Column ${c.kind === "expr" ? c.header : c.value}`}
        >
          <input
            className="sb-wbq-input sb-wbq-header"
            aria-label="Header"
            value={c.header}
            onInput={(e) => patch(i, { ...c, header: e.currentTarget.value })}
          />
          <select
            className="sb-select"
            aria-label={`Kind of column ${c.kind === "expr" ? c.header : c.value}`}
            value={c.kind}
            onChange={(e) =>
              patch(
                i,
                changeColumnKind(
                  c,
                  e.currentTarget.value as TableColumn["kind"],
                  v,
                  builder.firstField(),
                ),
              )
            }
          >
            <option value="field">Field</option>
            <option value="link">Page link</option>
            <option value="expr">Expression</option>
          </select>
          {c.kind === "expr" ? (
            <LuaLineInput
              client={client}
              label="Column expression"
              initial={c.value}
              onChange={(value) => patch(i, { ...c, value })}
            />
          ) : (
            <FieldSelect
              builder={builder}
              value={c.value}
              withTypes={false}
              onChange={(value) =>
                patch(i, {
                  ...c,
                  value,
                  header: !c.header || c.header === c.value ? value : c.header,
                })
              }
            />
          )}
          <button
            type="button"
            className="sb-wbq-x"
            aria-label="Move column up"
            disabled={i === 0}
            onClick={() => setColumns(moveBy(columns, i, -1))}
          >
            ↑
          </button>
          <button
            type="button"
            className="sb-wbq-x"
            aria-label="Move column down"
            disabled={i === columns.length - 1}
            onClick={() => setColumns(moveBy(columns, i, 1))}
          >
            ↓
          </button>
          <button
            type="button"
            className="sb-wbq-x"
            aria-label="Remove column"
            onClick={() => setColumns(columns.filter((x) => x.id !== c.id))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="sb-wbq-row">
        <AddButton
          onClick={() =>
            setColumns([...columns, fieldColumn(builder.firstField())])
          }
        >
          + Column
        </AddButton>
        <AddButton
          onClick={() =>
            setColumns([
              ...columns,
              ...tableColumns(builder.fields).filter(
                (n) =>
                  !columns.some(
                    (c) => c.kind !== "expr" && c.value === n.value,
                  ),
              ),
            ])
          }
        >
          + All schema fields
        </AddButton>
        {columns.length ? (
          <>
            <span className="sb-wbq-spacer" />
            <button
              type="button"
              className="sb-wbq-link"
              onClick={() => {
                builder.update(
                  (m) => ({ ...m, select: { mode: "table", columns: [] } }),
                  { undoable: true },
                );
                client.ui.flashNotification("Cleared the columns", "info", {
                  actions: [{ name: "Undo", run: () => void builder.undo() }],
                });
              }}
            >
              Clear all
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ListTemplate({ client, builder, model }: RowProps) {
  if (model.select.mode !== "list") return null;
  const list = model.select.list;
  const custom = "custom" in list;
  const templates = templatesFor(
    loadTemplates(client),
    sourceType(model.source),
  );
  // A template the query names that the space doesn't define (any more)
  const chosen = custom
    ? undefined
    : templates.find((t) => t.id === list.template);
  const missing = !custom && !chosen ? list.template : null;
  const setList = (next: typeof list) =>
    builder.update((m) => ({ ...m, select: { mode: "list", list: next } }));
  const insert = (text: string) =>
    custom && setList({ custom: list.custom + text });

  return (
    <div className="sb-wbq-columns">
      <div className="sb-wbq-row">
        <span className="sb-wbq-note">Template</span>
        <select
          className="sb-select"
          aria-label="Template"
          value={custom ? "custom" : list.template}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setList(
              v === "custom"
                ? { custom: `* [[\${${builder.firstField()}}]]` }
                : { template: v },
            );
          }}
        >
          {missing ? <option value={missing}>{missing}</option> : null}
          {templates.map((t) => (
            <option key={t.id} value={t.id} title={t.description}>
              {t.id}
            </option>
          ))}
          <option value="custom">Custom template…</option>
        </select>
        {chosen?.definition ? (
          <button
            type="button"
            className="sb-wbq-link"
            onClick={() => void openRef(client, chosen.definition!)}
          >
            Go to definition
          </button>
        ) : null}
      </div>
      {chosen?.description ? (
        <span className="sb-wbq-note">{chosen.description}</span>
      ) : null}
      {custom ? (
        <>
          <input
            className="sb-wbq-input sb-wbq-wide"
            aria-label="Custom template"
            value={list.custom}
            onInput={(e) => setList({ custom: e.currentTarget.value })}
          />
          <div className="sb-wbq-row">
            <span className="sb-wbq-note">Insert</span>
            {builder.offeredFields().map((f) => (
              <button
                key={f.name}
                type="button"
                className="sb-wbq-chip"
                onClick={() => insert(`\${${f.name}}`)}
              >
                {f.name}
              </button>
            ))}
            <span className="sb-wbq-note">as link</span>
            {builder
              .offeredFields()
              .filter((f) =>
                ["text", "pagelink"].includes(builder.typeOf(f.name)),
              )
              .map((f) => (
                <button
                  key={f.name}
                  type="button"
                  className="sb-wbq-chip sb-wbq-chip-off"
                  onClick={() => insert(`[[\${${f.name}}]]`)}
                >
                  [[{f.name}]]
                </button>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function GroupColumns({ client, builder, model }: RowProps) {
  const aggregates = aggregateChoices(client);
  const setColumns = (next: GroupColumn[]) =>
    builder.update((m) => ({ ...m, groupColumns: next }));
  const patch = (i: number, c: GroupColumn) =>
    setColumns(replaceAt(model.groupColumns, i, c));

  return (
    <div className="sb-wbq-columns">
      {model.groupColumns.map((c, i) => (
        <div
          key={c.id}
          className="sb-wbq-column sb-wbq-aggcol"
          role="group"
          aria-label={`Column ${c.header || (c.kind === "agg" ? c.agg : c.field)}`}
        >
          <input
            className="sb-wbq-input sb-wbq-header"
            aria-label="Header"
            value={c.header}
            onInput={(e) => patch(i, { ...c, header: e.currentTarget.value })}
          />
          <select
            className="sb-select"
            aria-label="Aggregate"
            value={c.kind === "key" ? GROUP_KEY_CHOICE : c.agg}
            onChange={(e) =>
              patch(
                i,
                changeGroupColumn(
                  model,
                  c,
                  e.currentTarget.value,
                  builder.firstField(),
                ),
              )
            }
          >
            <option value={GROUP_KEY_CHOICE}>group key</option>
            {aggregates.map((a) => (
              <option key={a.name} value={a.name} title={a.description}>
                {a.name}
              </option>
            ))}
          </select>
          {c.kind === "key" ? (
            model.group.length > 1 ? (
              <select
                className="sb-select"
                aria-label="Group key"
                value={c.field}
                onChange={(e) =>
                  patch(i, { ...c, field: e.currentTarget.value })
                }
              >
                {model.group.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            ) : null
          ) : (
            <>
              <FieldSelect
                builder={builder}
                value={c.field}
                withTypes={false}
                onChange={(field) => patch(i, { ...c, field })}
              />
              {c.agg === "array_agg" ? (
                <label className="sb-wbq-note">
                  <input
                    type="checkbox"
                    checked={c.sorted}
                    onChange={(e) =>
                      patch(i, { ...c, sorted: e.currentTarget.checked })
                    }
                  />{" "}
                  sorted
                </label>
              ) : null}
              <LuaLineInput
                client={client}
                label="Only where"
                initial={c.where ?? ""}
                placeholder="only where…"
                onChange={(where) =>
                  patch(i, { ...c, where: where || undefined })
                }
              />
            </>
          )}
          <button
            type="button"
            className="sb-wbq-x"
            aria-label="Remove column"
            onClick={() => builder.update((m) => removeGroupColumn(m, c.id))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="sb-wbq-row">
        <AddButton
          onClick={() =>
            setColumns([
              ...model.groupColumns,
              {
                id: newId(),
                header: "",
                kind: "agg",
                agg: "count",
                field: builder.firstField(),
                sorted: false,
              },
            ])
          }
        >
          + Column
        </AddButton>
        <span className="sb-wbq-note">
          Each column is a group key or an aggregate.
        </span>
      </div>
    </div>
  );
}

export function SelectRow(props: RowProps) {
  const { builder, model } = props;
  const grouped = isGrouped(model);
  const mode = grouped ? "table" : model.select.mode;
  return (
    <Clause label="Select">
      <span className="sb-wbq-seg" role="radiogroup" aria-label="Show as">
        {(["table", "list"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={mode === m ? "sb-wbq-seg-on" : ""}
            disabled={grouped && m === "list"}
            title={
              grouped && m === "list"
                ? "Grouped results are always a table"
                : undefined
            }
            onClick={() =>
              builder.update((x) =>
                changeSelectMode(x, m, builder.fields, loadTemplates(client)),
              )
            }
          >
            {m === "table" ? "Table" : "List"}
          </button>
        ))}
      </span>
      {grouped ? (
        <GroupColumns {...props} />
      ) : mode === "table" ? (
        <TableColumns {...props} />
      ) : (
        <ListTemplate {...props} />
      )}
    </Clause>
  );
}

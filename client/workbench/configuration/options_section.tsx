import { Checkbox, Input, Select } from "@silverbulletmd/silverbullet/ui";
import type { Client } from "../../client.ts";
import { toLua } from "../../config_management/managed_lua.ts";
import { type Action, copyText } from "../shared/action.ts";
import { ActionMenu } from "../shared/action_menu.tsx";
import { BlockNote } from "../shared/block_ui.tsx";
import type { ConfigurationModel } from "./configuration_model.ts";
import type { UiSchema } from "./schema.ts";

type FieldDeps = { client: Client; model: ConfigurationModel; path: string };

function matches({ path, schema }: UiSchema, phrase: string): boolean {
  if (!phrase) return true;
  const text = `${schema.ui?.label ?? ""} ${schema.description ?? ""} ${path}`;
  return text.toLowerCase().includes(phrase);
}

/** The option fields shown for `phrase`, by category, in display order. */
export function visibleCategories(
  model: ConfigurationModel,
  phrase: string,
): { name: string; fields: UiSchema[] }[] {
  const q = phrase.toLowerCase().trim();
  return model.index.sortedCategoryNames
    .map((name) => ({
      name,
      fields: model.index.categoryMap[name].filter((f) => matches(f, q)),
    }))
    .filter((c) => c.fields.length > 0);
}

export function OptionsSection(props: {
  client: Client;
  model: ConfigurationModel;
  phrase: string;
}) {
  const { client, model } = props;
  const categories = visibleCategories(model, props.phrase);
  if (categories.length === 0) {
    return <BlockNote>No options match.</BlockNote>;
  }
  return (
    <>
      {categories.map(({ name, fields }) => (
        <section
          key={name}
          className="sb-wb-cfg-category"
          data-category={name}
          aria-label={name}
        >
          <div className="sb-wb-cfg-head">
            <h3 className="sb-wb-cfg-title">{name}</h3>
            {model.source?.categories[name]?.description && (
              <span className="sb-wb-muted">
                {model.source.categories[name].description}
              </span>
            )}
          </div>
          {fields.map((field) => (
            <OptionRow
              key={field.path}
              client={client}
              model={model}
              field={field}
            />
          ))}
        </section>
      ))}
    </>
  );
}

function OptionRow(props: {
  client: Client;
  model: ConfigurationModel;
  field: UiSchema;
}) {
  const { client, model } = props;
  const { path, schema } = props.field;
  const label = schema.ui?.label || path;
  const modified = model.isModified(path);
  const writable = !!model.source?.writable;
  const actions: Action<FieldDeps>[] = [
    ...(modified && writable
      ? [
          {
            label: "Reset to default",
            icon: "revert" as const,
            run: async ({ model, path }: FieldDeps) => model.resetField(path),
          },
        ]
      : []),
    {
      label: "Copy as Lua",
      icon: "copy",
      run: ({ client, model, path }) =>
        copyText(
          client,
          `config.set(${toLua(path)}, ${toLua(model.valueOf(path))})`,
        ),
    },
  ];
  return (
    <div className="sb-wb-cfg-row">
      <span
        className={
          modified ? "sb-wb-cfg-dot sb-wb-cfg-modified" : "sb-wb-cfg-dot"
        }
        title={modified ? "Changed from the default" : undefined}
      />
      <div className="sb-wb-cfg-info">
        <div className="sb-wb-cfg-label">{label}</div>
        {schema.description && (
          <div className="sb-wb-cfg-description">{schema.description}</div>
        )}
      </div>
      <div className="sb-wb-cfg-control">
        <Control
          model={model}
          path={path}
          schema={schema}
          label={label}
          disabled={!writable}
        />
      </div>
      <ActionMenu actions={actions} deps={{ client, model, path }} />
    </div>
  );
}

function Control(props: {
  model: ConfigurationModel;
  path: string;
  schema: any;
  label: string;
  disabled: boolean;
}) {
  const { model, path, schema, label, disabled } = props;
  const value = model.valueOf(path) as any;
  const set = (v: unknown) => model.setField(path, v);
  if (schema.type === "boolean") {
    return (
      <Checkbox
        aria-label={label}
        disabled={disabled}
        checked={!!value}
        onChange={(e) => set(e.currentTarget.checked)}
      />
    );
  }
  if (schema.type === "string" && schema.enum) {
    return (
      <Select
        aria-label={label}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => set(e.currentTarget.value)}
      >
        {schema.enum.map((opt: string) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </Select>
    );
  }
  if (schema.type === "string") {
    return (
      <Input
        aria-label={label}
        disabled={disabled}
        type={schema.ui?.inputType === "password" ? "password" : "text"}
        value={value ?? ""}
        onInput={(e) => set(e.currentTarget.value)}
      />
    );
  }
  if (schema.type === "number") {
    return (
      <Input
        aria-label={label}
        disabled={disabled}
        type="number"
        value={value == null ? "" : String(value)}
        onInput={(e) => {
          const v = e.currentTarget.value;
          set(v === "" ? undefined : Number(v));
        }}
      />
    );
  }
  return <span className="sb-wb-muted">Configure manually in CONFIG</span>;
}

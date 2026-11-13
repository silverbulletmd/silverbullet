import { Checkbox, Input, Select } from "@silverbulletmd/silverbullet/ui";
import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import type { Client } from "../../client.ts";
import { toLua } from "../../config_management/managed_lua.ts";
import { resolvedColor } from "../../space_theme.ts";
import { type Action, copyText } from "../shared/action.ts";
import { ActionMenu } from "../shared/action_menu.tsx";
import { BlockNote } from "../shared/block_ui.tsx";
import { ChangedMark } from "./changed_mark.tsx";
import type { ConfigurationModel } from "./configuration_model.ts";
import { EditorSizeInput, FontSelect, useFontPreview } from "./font_select.tsx";
import { getValueAtPath, type UiSchema } from "./schema.ts";
import { ThemeSelect } from "./theme_select.tsx";

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
  /** Whether the Configuration tab is the one on screen. */
  showing: boolean;
}) {
  const { client, model } = props;
  useFontPreview(client, (path) => model.valueOf(path));
  useAccentPreview(client, model.valueOf("accentColor") as string | undefined);
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
              showing={props.showing}
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
  showing: boolean;
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
      // Meant for Library/Config, whose blocks always boot
      run: ({ client, model, path }) =>
        copyText(
          client,
          `config.set(${toLua(path)}, ${toLua(model.valueOf(path))})`,
        ),
    },
  ];
  return (
    <div className="sb-wb-cfg-row">
      <div className="sb-wb-cfg-info">
        <div className="sb-wb-cfg-label">
          {label}
          {modified && (
            <ChangedMark
              name={label}
              writable={writable}
              onReset={() => model.resetField(path)}
            />
          )}
        </div>
        {schema.description && (
          <div className="sb-wb-cfg-description">{schema.description}</div>
        )}
      </div>
      <div className="sb-wb-cfg-control">
        <Control
          client={client}
          model={model}
          path={path}
          schema={schema}
          label={label}
          disabled={!writable}
          showing={props.showing}
        />
      </div>
      <ActionMenu actions={actions} deps={{ client, model, path }} />
    </div>
  );
}

type ControlProps = {
  client: Client;
  model: ConfigurationModel;
  path: string;
  schema: any;
  label: string;
  disabled: boolean;
  showing: boolean;
  value: any;
  set: (value: unknown) => void;
};

/**
 * The control for each `ui` hint, then for each plain schema type; see the
 * Configuration tab guide in docs/API/config.md.
 */
const CONTROLS: Record<string, (p: ControlProps) => JSX.Element> = {
  font: (p) => (
    <FontSelect
      client={p.client}
      value={p.value}
      slot={p.schema.ui.font === "code" ? "code" : "editor"}
      label={p.label}
      disabled={p.disabled}
      onChange={p.set}
    />
  ),
  fontSize: (p) => (
    <EditorSizeInput
      client={p.client}
      value={p.value}
      label={p.label}
      disabled={p.disabled}
      onChange={p.set}
    />
  ),
  theme: (p) => (
    <ThemeSelect
      client={p.client}
      value={p.value}
      showing={p.showing}
      saved={
        getValueAtPath(p.model.source?.values, p.path) as string | undefined
      }
      label={p.label}
      disabled={p.disabled}
      onChange={p.set}
    />
  ),
  color: ({ label, disabled, value, set }) => {
    const shown = shownAccentHex();
    return (
      <span class="sb-config-color">
        <input
          type="color"
          aria-label={`${label} picker`}
          disabled={disabled}
          value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : shown}
          onInput={(e) => set(e.currentTarget.value)}
        />
        <Input
          aria-label={label}
          disabled={disabled}
          type="text"
          placeholder={`Theme default (${shown})`}
          value={value ?? ""}
          onInput={(e) => set(e.currentTarget.value)}
        />
      </span>
    );
  },
  boolean: ({ label, disabled, value, set }) => (
    <Checkbox
      aria-label={label}
      disabled={disabled}
      checked={!!value}
      onChange={(e) => set(e.currentTarget.checked)}
    />
  ),
  enum: ({ schema, label, disabled, value, set }) => (
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
  ),
  string: ({ schema, label, disabled, value, set }) => (
    <Input
      aria-label={label}
      disabled={disabled}
      type={schema.ui?.inputType === "password" ? "password" : "text"}
      value={value ?? ""}
      onInput={(e) => set(e.currentTarget.value)}
    />
  ),
  number: ({ label, disabled, value, set }) => (
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
  ),
};

/** Which of {@link CONTROLS} a field gets: its `ui` hint, else its type. */
export function controlFor(schema: any): string | undefined {
  const hint = ["font", "fontSize", "theme", "color"].find(
    (h) => schema.ui?.[h],
  );
  if (hint) return hint;
  if (schema.type === "string" && schema.enum) return "enum";
  return ["boolean", "string", "number"].includes(schema.type)
    ? schema.type
    : undefined;
}

function Control(props: Omit<ControlProps, "value" | "set">) {
  const { model, path } = props;
  const name = controlFor(props.schema);
  if (!name) {
    return (
      <span className="sb-wb-muted">Configure manually in Library/Config</span>
    );
  }
  const Widget = CONTROLS[name];
  return (
    <Widget
      {...props}
      value={model.valueOf(path)}
      set={(v) => model.setField(path, v)}
    />
  );
}

/**
 * The accent colour on screen as `#rrggbb`: what an unset (or non-hex)
 * `accentColor` falls back to, since a colour picker only takes hex.
 */
function shownAccentHex(): string {
  return resolvedColor(document, "color", "--ui-accent-color") ?? "#000000";
}

/**
 * Shows an edited `accentColor` right away, as fonts do, over whatever theme
 * is on screen (a previewed one included) until the view goes away. Saving
 * reapplies the theme for real.
 */
function useAccentPreview(client: Client, color: string | undefined): void {
  useEffect(() => {
    // "": an unset colour previews the theme's own accent
    client.spaceTheme.preview({ accent: color ?? "" });
  }, [client, color]);
  useEffect(
    () => () => client.spaceTheme.preview({ accent: undefined }),
    [client],
  );
}

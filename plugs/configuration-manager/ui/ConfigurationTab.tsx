import { useEffect, useRef, useState } from "preact/hooks";
import { useCfg } from "./CfgContext.tsx";
import { useConfig } from "./EditorsContext.tsx";
import { cls } from "./chord_display.tsx";
import type { UiSchema } from "./schema.ts";

function Control(
  { path, schema, value }: { path: string; schema: any; value: any },
) {
  const config = useConfig();
  if (schema.type === "boolean") {
    return (
      <input
        type="checkbox"
        class="cfg-checkbox"
        checked={!!value}
        onChange={(e) =>
          config.setField(path, (e.currentTarget as HTMLInputElement).checked)}
      />
    );
  }
  if (schema.type === "string" && schema.enum) {
    return (
      <select
        onChange={(e) =>
          config.setField(path, (e.currentTarget as HTMLSelectElement).value)}
      >
        {schema.enum.map((opt: string) => (
          <option key={opt} value={opt} selected={opt === value}>{opt}</option>
        ))}
      </select>
    );
  }
  if (schema.type === "string") {
    const inputType = schema.ui?.inputType === "password" ? "password" : "text";
    return (
      <input
        type={inputType}
        value={value ?? ""}
        onInput={(e) =>
          config.setField(path, (e.currentTarget as HTMLInputElement).value)}
      />
    );
  }
  if (schema.type === "number") {
    return (
      <input
        type="number"
        value={value == null ? "" : String(value)}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          config.setField(path, v === "" ? undefined : Number(v));
        }}
      />
    );
  }
  return <span class="cfg-hint">Configure manually in CONFIG</span>;
}

function Field(
  { path, schema }: { path: string; schema: any },
) {
  const config = useConfig();
  const modified = config.isModified(path);
  return (
    <div class="cfg-field">
      <div class="cfg-field-info">
        <div class="cfg-field-label">{schema.ui?.label || path}</div>
        {schema.description && (
          <div class="cfg-field-description">{schema.description}</div>
        )}
      </div>
      <div class="cfg-field-control">
        <Control path={path} schema={schema} value={config.pendingConfig[path]} />
        <button
          class={cls({ "cfg-field-reset": true, hidden: !modified })}
          title="Reset to default"
          onClick={() => config.resetField(path)}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function fieldMatches(path: string, schema: any, query: string): boolean {
  if (!query) return true;
  const label = schema.ui?.label || path;
  const description = schema.description || "";
  return `${label} ${description} ${path}`.toLowerCase().includes(query);
}

function Category(
  { name, fields, query }: {
    name: string;
    fields: UiSchema[];
    query: string;
  },
) {
  const { cfg } = useCfg();
  const visible = fields.filter((f) => fieldMatches(f.path, f.schema, query));
  if (visible.length === 0) return null;
  const description = cfg.categories?.[name]?.description;
  return (
    <div class="cfg-category">
      <h2 class="cfg-category-title">{name}</h2>
      {description && <div class="cfg-category-description">{description}</div>}
      {visible.map((f) => <Field key={f.path} path={f.path} schema={f.schema} />)}
    </div>
  );
}

export function ConfigurationTab() {
  const { schemaIndex } = useCfg();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const query = search.toLowerCase().trim();
  return (
    <>
      <input
        ref={inputRef}
        type="text"
        id="cfg-config-search"
        placeholder="Filter configuration options..."
        value={search}
        onInput={(e) =>
          setSearch((e.currentTarget as HTMLInputElement).value)}
      />
      {schemaIndex.sortedCategoryNames.map((name) => (
        <Category
          key={name}
          name={name}
          fields={schemaIndex.categoryMap[name]}
          query={query}
        />
      ))}
    </>
  );
}

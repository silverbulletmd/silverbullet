/** What the schema index is built from: the live configuration. */
export type SchemaSource = {
  schemas: Record<string, any>;
  values: Record<string, any>;
  categories: Record<
    string,
    { name: string; description?: string; priority?: number }
  >;
};

export type UiSchema = { path: string; schema: any };

export type SchemaIndex = {
  categoryMap: Record<string, UiSchema[]>;
  sortedCategoryNames: string[];
};

export function getValueAtPath(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

export function getSchemaAtPath(schemas: any, path: string): any {
  const parts = path.split(".");
  let current: any = schemas;
  for (const part of parts) {
    if (!current?.properties?.[part]) {
      return undefined;
    }
    current = current.properties[part];
  }
  return current;
}

function collectUiSchemas(schemaNode: any, path: string, results: UiSchema[]) {
  if (!schemaNode?.properties) return;
  for (const [key, prop] of Object.entries<any>(schemaNode.properties)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (prop.ui) results.push({ path: fullPath, schema: prop });
    if (prop.type === "object" && prop.properties) {
      collectUiSchemas(prop, fullPath, results);
    }
  }
}

/** The fields that have a `ui`, grouped by category, in display order. */
export function buildSchemaIndex(cfg: SchemaSource): SchemaIndex {
  const items: UiSchema[] = [];
  collectUiSchemas(cfg.schemas, "", items);

  const categoryMap: Record<string, UiSchema[]> = {};
  for (const item of items) {
    // Parent objects whose children also have `ui` are skipped — children
    // will surface as individual fields under their own category.
    if (item.schema.type === "object" && item.schema.properties) {
      const hasChildUi = Object.values<any>(item.schema.properties).some(
        (p) => p.ui,
      );
      if (hasChildUi) continue;
    }
    const cat = item.schema.ui.category;
    (categoryMap[cat] ||= []).push(item);
  }
  for (const fields of Object.values(categoryMap)) {
    fields.sort(
      (a, b) => (b.schema.ui.priority || 0) - (a.schema.ui.priority || 0),
    );
  }

  const defaultPriority = Number.NEGATIVE_INFINITY;
  const sortedCategoryNames = Object.keys(categoryMap).sort((a, b) => {
    const pa = cfg.categories?.[a]?.priority ?? defaultPriority;
    const pb = cfg.categories?.[b]?.priority ?? defaultPriority;
    if (pa !== pb) return pb - pa;
    return a.localeCompare(b);
  });

  return { categoryMap, sortedCategoryNames };
}

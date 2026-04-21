import type { ConfigurationViewModel } from "./types.ts";

export type UiSchema = { path: string; schema: any };

export type SchemaIndex = {
  categoryMap: Record<string, UiSchema[]>;
  sortedCategoryNames: string[];
  initialConfig: Record<string, any>;
  initialModifiedPaths: Set<string>;
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

export function getSchemaAtPath(
  schemas: any,
  path: string,
): any {
  const parts = path.split(".");
  let current: any = schemas;
  for (const part of parts) {
    if (!current || !current.properties || !current.properties[part]) {
      return undefined;
    }
    current = current.properties[part];
  }
  return current;
}

function collectUiSchemas(
  schemaNode: any,
  path: string,
  results: UiSchema[],
) {
  if (!schemaNode || !schemaNode.properties) return;
  for (const [key, prop] of Object.entries<any>(schemaNode.properties)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (prop.ui) results.push({ path: fullPath, schema: prop });
    if (prop.type === "object" && prop.properties) {
      collectUiSchemas(prop, fullPath, results);
    }
  }
}

export function buildSchemaIndex(cfg: ConfigurationViewModel): SchemaIndex {
  const items: UiSchema[] = [];
  collectUiSchemas(cfg.schemas, "", items);

  const initialConfig: Record<string, any> = {};
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
    initialConfig[item.path] = getValueAtPath(cfg.values, item.path);
  }
  for (const fields of Object.values(categoryMap)) {
    fields.sort((a, b) => (a.schema.ui.order || 0) - (b.schema.ui.order || 0));
  }

  const defaultOrder = Number.POSITIVE_INFINITY;
  const sortedCategoryNames = Object.keys(categoryMap).sort((a, b) => {
    const oa = cfg.categories?.[a]?.order ?? defaultOrder;
    const ob = cfg.categories?.[b]?.order ?? defaultOrder;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  return {
    categoryMap,
    sortedCategoryNames,
    initialConfig,
    initialModifiedPaths: new Set(Object.keys(cfg.configOverrides || {})),
  };
}

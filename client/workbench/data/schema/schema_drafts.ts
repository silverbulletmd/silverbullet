/**
 * Unsaved schema edits per tag, kept for the whole session like the
 * Configuration tab's pending edits, and how saving turns them into
 * statements of CONFIG's managed schemas block.
 */
import { deepEqual } from "@silverbulletmd/silverbullet/lib/json";
import { isBuiltinTag } from "@silverbulletmd/silverbullet/lib/tags";
import { CONFIG_UNSET } from "../../../config.ts";
import {
  invalidManagedBlockMessage,
  SCHEMAS_BLOCK,
} from "../../../config_management/config_block.ts";
import { ConfigReloadError } from "../../../config_management/config_page.ts";
import {
  type OwnedSchemas,
  readSchemaBlock,
  type SchemaChanges,
} from "../../../config_management/schema_block.ts";
import type { JsonSchema } from "../../../config_management/schema_lua.ts";
import { validateSchema } from "../../../plugos/syscalls/jsonschema.ts";
import { ReloadingStore } from "../../shared/reloading_store.ts";
import { schemaSources, type TagSource } from "./tag_sources.ts";

export type TagDraft = {
  /** Edited or added rules; null for a removed one */
  rules: Map<string, JsonSchema | null>;
  /** Old name → new name */
  renamed: Map<string, string>;
  required: Map<string, boolean>;
  /** Attributes whose local changes are dropped, back to the underlying definition */
  resets: Set<string>;
  /** A new icon; null removes it */
  icon?: string | null;
};

export type SaveResult =
  | { ok: true; shadowed: string[] }
  | {
      ok: false;
      error: string;
      /** CONFIG was written, but reloading it failed */
      savedButNotApplied?: boolean;
      /** Problems per attribute name */
      fieldErrors?: Record<string, string>;
    };

export type SchemaDraftSource = {
  configText: string;
  definitions: Record<string, any>;
  scripts: { ref: string; page: string; script: string }[];
  writable: boolean;
};

export type SchemaDraftDeps = {
  load: () => Promise<SchemaDraftSource>;
  /** Writes the changes and reloads; a ConfigReloadError means the write landed */
  save: (changes: SchemaChanges) => Promise<void>;
  /** A tag's schema as loaded now */
  effective: (tag: string) => JsonSchema | null;
  subscribeReload: (changed: () => void) => () => void;
  onDirty: (dirty: boolean) => void;
};

type Baseline = SchemaDraftSource & {
  owned: OwnedSchemas;
  sources: Record<string, TagSource[]>;
};

const propertyPath = (tag: string, name: string) => [
  "tags",
  tag,
  "schema",
  "properties",
  name,
];

function withoutDescription(s: JsonSchema | undefined): JsonSchema {
  const { description: _, ...rest } = s ?? {};
  return rest;
}

/** What the block holds for one tag, to notice someone else changing it */
function ownedSnapshot(owned: OwnedSchemas, tag: string): string {
  return JSON.stringify({
    define: owned.defines[tag] ?? null,
    sets: owned.sets.filter((s) => s.path[1] === tag),
    requires: owned.requires.filter((r) => r.tag === tag),
  });
}

function emptyChanges(): SchemaChanges {
  return { define: {}, set: [], reset: [], require: [], resetRequire: [] };
}

export class SchemaDrafts extends ReloadingStore<SchemaDraftSource> {
  saving = false;
  private baseline?: Baseline;
  private drafts = new Map<string, TagDraft>();
  /** The block's statements for a tag when its draft started */
  private snapshots = new Map<string, string>();
  /** Counts edits per tag, to tell whether a draft changed while it was saved */
  private versions = new Map<string, number>();

  constructor(private deps: SchemaDraftDeps) {
    super(deps);
  }

  get ready(): boolean {
    return this.baseline !== undefined;
  }

  get writable(): boolean {
    return this.baseline?.writable ?? false;
  }

  get blockError(): string | undefined {
    return this.baseline?.owned.error;
  }

  override get dirty(): boolean {
    return this.drafts.size > 0;
  }

  draft(tag: string): TagDraft | undefined {
    return this.drafts.get(tag);
  }

  /** The block's own rules for a tag: properties it defines or sets */
  localPaths(tag: string): Set<string> {
    const owned = this.baseline?.owned;
    const names = new Set<string>();
    if (!owned) return names;
    for (const name of Object.keys(owned.defines[tag]?.properties ?? {})) {
      names.add(name);
    }
    for (const { path } of owned.sets) {
      if (path[1] === tag && path[3] === "properties" && path[4]) {
        names.add(path[4]);
      }
    }
    return names;
  }

  ownership(tag: string): "none" | "owned" | "external" {
    const b = this.baseline;
    if (!b) return "none";
    if (b.owned.defines[tag]) return "owned";
    if (b.sources[tag]?.length || b.definitions[tag]?.schema) {
      return "external";
    }
    return "none";
  }

  /** The scripts outside the schemas block that give a tag its schema */
  definitions(tag: string): TagSource[] {
    return this.baseline?.sources[tag] ?? [];
  }

  /** Other scripts that also give a tag this block owns a schema */
  conflict(tag: string): TagSource[] {
    if (this.ownership(tag) !== "owned") return [];
    return this.baseline?.sources[tag] ?? [];
  }

  setRule(tag: string, attribute: string, schema: JsonSchema): void {
    this.edit(tag, (d) => {
      d.rules.set(attribute, schema);
      d.resets.delete(attribute);
    });
  }

  /** Adds a schema's properties and requirements to the tag's draft */
  declare(tag: string, schema: JsonSchema): void {
    const properties = Object.entries<JsonSchema>(schema.properties ?? {});
    const required: string[] = schema.required ?? [];
    if (properties.length === 0 && required.length === 0) return;
    this.edit(tag, (d) => {
      for (const [name, rule] of properties) {
        d.rules.set(name, rule);
        d.resets.delete(name);
      }
      for (const name of required) d.required.set(name, true);
    });
  }

  removeRule(tag: string, attribute: string): void {
    this.edit(tag, (d) => {
      d.rules.set(attribute, null);
      d.required.delete(attribute);
    });
  }

  /** Renames the attribute originally called `from` (whatever it's called now) to `to` */
  rename(tag: string, from: string, to: string): void {
    this.edit(tag, (d) => {
      const current = d.renamed.get(from) ?? from;
      if (to === from) d.renamed.delete(from);
      else d.renamed.set(from, to);
      const rule = d.rules.get(current);
      if (rule !== undefined) {
        d.rules.delete(current);
        if (rule !== null) d.rules.set(to, rule);
      }
      const required = d.required.get(current);
      if (required !== undefined) {
        d.required.delete(current);
        d.required.set(to, required);
      }
    });
  }

  setRequired(tag: string, attribute: string, required: boolean): void {
    this.edit(tag, (d) => void d.required.set(attribute, required));
  }

  setIcon(tag: string, icon: string | null): void {
    this.edit(tag, (d) => {
      d.icon = icon;
    });
  }

  /** Drops the attribute's edits, including a rename (`attribute` is its original name) */
  reset(tag: string, attribute: string): void {
    this.edit(tag, (d) => {
      const current = d.renamed.get(attribute);
      if (current !== undefined) {
        d.renamed.delete(attribute);
        d.rules.delete(current);
        d.required.delete(current);
      }
      d.rules.delete(attribute);
      d.required.delete(attribute);
      if (this.ownership(tag) === "external") d.resets.add(attribute);
    });
  }

  discard(tag?: string): void {
    if (tag === undefined) {
      this.drafts.clear();
      this.snapshots.clear();
    } else {
      this.drafts.delete(tag);
      this.snapshots.delete(tag);
    }
    this.emit();
  }

  changesFor(tag: string): SchemaChanges {
    const changes = emptyChanges();
    const d = this.drafts.get(tag);
    if (!d) return changes;
    const ownership = this.ownership(tag);
    if (d.icon !== undefined) {
      changes.set.push({
        path: isBuiltinTag(tag)
          ? ["tags", tag, "icon"]
          : ["tags", tag, "pageDecoration", "icon"],
        value: d.icon ?? CONFIG_UNSET,
      });
    }
    const schemaEdits =
      d.rules.size > 0 || d.renamed.size > 0 || d.required.size > 0;
    if (ownership === "external") {
      this.targetedChanges(tag, d, changes);
    } else if (schemaEdits) {
      changes.define[tag] = this.wholeSchema(tag, d);
    }
    return changes;
  }

  async save(tag: string): Promise<SaveResult> {
    if (!this.writable) return { ok: false, error: "This space is read-only" };
    if (this.blockError) {
      return {
        ok: false,
        error: invalidManagedBlockMessage(this.blockError, SCHEMAS_BLOCK),
      };
    }
    const fieldErrors = this.validate(tag);
    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        error: "Fix the marked attributes first",
        fieldErrors,
      };
    }
    this.saving = true;
    this.emit();
    try {
      const fresh = await this.deps.load();
      if (
        this.snapshots.has(tag) &&
        ownedSnapshot(readSchemaBlock(fresh.configText), tag) !==
          this.snapshots.get(tag)
      ) {
        return {
          ok: false,
          error: `The schema of #${tag} changed in CONFIG since you started editing it. Discard your changes to see the new version.`,
        };
      }
      const expected = this.expectedProperties(tag);
      const version = this.versions.get(tag);
      try {
        await this.deps.save(this.changesFor(tag));
      } catch (e: any) {
        return {
          ok: false,
          error: e?.message ?? String(e),
          ...(e instanceof ConfigReloadError
            ? { savedButNotApplied: true }
            : {}),
        };
      }
      const effective = this.deps.effective(tag)?.properties ?? {};
      const shadowed = Object.entries(expected)
        .filter(([name, rule]) =>
          rule === null ? name in effective : !deepEqual(effective[name], rule),
        )
        .map(([name]) => name);
      // Edits made while saving stay as a draft (saving them again is harmless)
      if (this.versions.get(tag) === version) {
        this.drafts.delete(tag);
        this.snapshots.delete(tag);
      }
      await this.load();
      return { ok: true, shadowed };
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  private wholeSchema(tag: string, d: TagDraft): JsonSchema {
    const base: JsonSchema = this.baseline?.owned.defines[tag] ?? {
      type: "object",
      properties: {},
    };
    const props: Record<string, JsonSchema> = { ...(base.properties ?? {}) };
    let required: string[] = Array.isArray(base.required)
      ? [...base.required]
      : [];
    for (const [from, to] of d.renamed) {
      if (from in props) {
        props[to] = props[from];
        delete props[from];
      }
      required = required.map((n) => (n === from ? to : n));
    }
    for (const [name, rule] of d.rules) {
      if (rule === null) {
        delete props[name];
        required = required.filter((n) => n !== name);
      } else {
        props[name] = rule;
      }
    }
    for (const [name, req] of d.required) {
      required = required.filter((n) => n !== name);
      if (req) required.push(name);
    }
    const { required: _, ...rest } = base;
    return {
      ...rest,
      properties: props,
      ...(required.length ? { required } : {}),
    };
  }

  private targetedChanges(tag: string, d: TagDraft, changes: SchemaChanges) {
    const base = this.baseline?.definitions[tag]?.schema ?? {};
    const props: Record<string, JsonSchema> = base.properties ?? {};
    const baseRequired = new Set<string>(
      Array.isArray(base.required) ? base.required : [],
    );
    const renameTargets = new Set(d.renamed.values());
    for (const [from, to] of d.renamed) {
      const rule = d.rules.get(to) ?? props[from];
      if (rule) changes.set.push({ path: propertyPath(tag, to), value: rule });
      changes.set.push({ path: propertyPath(tag, from), value: CONFIG_UNSET });
      if (baseRequired.has(from)) {
        if (!d.required.has(to)) {
          changes.require.push({ tag, attribute: to, required: true });
        }
        changes.require.push({ tag, attribute: from, required: false });
      }
    }
    for (const [name, rule] of d.rules) {
      if (renameTargets.has(name)) continue;
      const path = propertyPath(tag, name);
      if (rule === null) {
        changes.set.push({ path, value: CONFIG_UNSET });
      } else if (
        props[name] &&
        deepEqual(withoutDescription(props[name]), withoutDescription(rule))
      ) {
        if (props[name].description !== rule.description) {
          changes.set.push({
            path: [...path, "description"],
            value: rule.description ?? CONFIG_UNSET,
          });
        }
      } else {
        changes.set.push({ path, value: rule });
      }
    }
    for (const [name, required] of d.required) {
      changes.require.push({ tag, attribute: name, required });
    }
    for (const name of d.resets) {
      const path = propertyPath(tag, name);
      changes.reset.push(path, [...path, "description"]);
      changes.resetRequire!.push({ tag, attribute: name });
    }
  }

  /** The properties a save should leave in the loaded schema: a rule, or null for gone */
  private expectedProperties(tag: string): Record<string, JsonSchema | null> {
    const d = this.drafts.get(tag);
    const expected: Record<string, JsonSchema | null> = {};
    if (!d) return expected;
    const props =
      this.ownership(tag) === "external"
        ? (this.baseline?.definitions[tag]?.schema?.properties ?? {})
        : (this.baseline?.owned.defines[tag]?.properties ?? {});
    for (const [from, to] of d.renamed) {
      expected[from] = null;
      const rule = d.rules.get(to) ?? props[from];
      if (rule) expected[to] = rule;
    }
    for (const [name, rule] of d.rules) expected[name] = rule;
    return expected;
  }

  private validate(tag: string): Record<string, string> {
    const errors: Record<string, string> = {};
    const d = this.drafts.get(tag);
    if (!d) return errors;
    const existing = new Set(
      Object.keys(
        (this.ownership(tag) === "owned"
          ? this.baseline?.owned.defines[tag]
          : this.baseline?.definitions[tag]?.schema
        )?.properties ?? {},
      ),
    );
    for (const [name, rule] of d.rules) {
      if (name.trim() === "") {
        errors[name] = "Give the attribute a name";
        continue;
      }
      if (rule !== null) {
        const problem = validateSchema(rule);
        if (problem) errors[name] = problem;
      }
    }
    for (const [from, to] of d.renamed) {
      if (to.trim() === "") errors[to] = "Give the attribute a name";
      else if (
        existing.has(to) &&
        !d.renamed.has(to) &&
        d.rules.get(to) !== null
      ) {
        errors[to] = `${from} can't be renamed to ${to}: it already exists`;
      }
    }
    return errors;
  }

  private edit(tag: string, change: (d: TagDraft) => void): void {
    if (!this.writable) return;
    let d = this.drafts.get(tag);
    if (!d) {
      d = {
        rules: new Map(),
        renamed: new Map(),
        required: new Map(),
        resets: new Set(),
      };
      this.drafts.set(tag, d);
      if (this.baseline) {
        this.snapshots.set(tag, ownedSnapshot(this.baseline.owned, tag));
      }
    }
    change(d);
    this.versions.set(tag, (this.versions.get(tag) ?? 0) + 1);
    this.emit();
  }

  protected override loadErrorMessage(e: any): string {
    return `Couldn't read CONFIG: ${e?.message ?? e}`;
  }

  protected loaded(source: SchemaDraftSource): void {
    this.baseline = {
      ...source,
      owned: readSchemaBlock(source.configText),
      sources: schemaSources(source.scripts),
    };
    this.emit();
  }
}

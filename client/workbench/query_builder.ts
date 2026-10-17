/**
 * The Query tab's state, kept for the whole session so switching tabs or
 * closing the Workbench doesn't lose work.
 */
import type { FieldInfo } from "./query_fields.ts";
import { emptyModel, fieldType, type QueryModel } from "./query_model.ts";
import type { OperatorType } from "./query_ops.ts";

/**
 * Where the query goes: the spot `/Query…` was typed (`from` = `to`), or the
 * query opened from the page, which it replaces
 */
export type InsertTarget = { page: string; from: number; to: number };

type Snapshot = { model: QueryModel; fields: FieldInfo[] };

export class QueryBuilder {
  model: QueryModel | null = null;
  fields: FieldInfo[] = [];
  target: InsertTarget | null = null;
  /** Whether system fields are offered too */
  showSystem = false;
  /** Whether the query editor shows, or only the objects */
  editing = true;
  /**
   * Counts the times the model was replaced rather than edited (a new tag,
   * Undo): inputs keyed on it start over from the model
   */
  resets = 0;
  /** Counts the times the space's data changed under the query (scripts or index loaded) */
  dataVersion = 0;
  /** The model as the tag was picked or opened, to tell whether it was edited since */
  private pristine: QueryModel | null = null;
  /** The empty query a picked tag started with, which fresh fields rebuild */
  private blank: QueryModel | null = null;
  private snapshot: Snapshot | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  /** The fields on offer: system ones only when asked for */
  offeredFields(): FieldInfo[] {
    return this.fields.filter((f) => this.showSystem || !f.system);
  }

  /** The first field on offer, for a new filter or column */
  firstField(): string {
    return this.offeredFields()[0]?.name ?? "name";
  }

  typeOf(name: string): OperatorType {
    return this.model ? fieldType(this.model, this.fields, name) : "text";
  }

  update(
    fn: (m: QueryModel) => QueryModel,
    opts: { undoable?: boolean } = {},
  ): void {
    if (!this.model) return;
    if (opts.undoable) {
      this.snapshot = { model: this.model, fields: this.fields };
    }
    this.model = fn(this.model);
    this.changed();
  }

  setEditing(editing: boolean): void {
    this.editing = editing;
    this.changed();
  }

  setShowSystem(show: boolean): void {
    this.showSystem = show;
    this.changed();
  }

  /** Starts over on `tag`; returns whether the replaced work can be undone */
  pickTag(tag: string, fields: FieldInfo[]): boolean {
    const old = this.model;
    const edited = !!old && old !== this.pristine;
    this.snapshot = edited ? { model: old, fields: this.fields } : null;
    this.model = this.pristine = this.blank = emptyModel(tag, fields);
    this.fields = fields;
    this.resets++;
    this.changed();
    return edited;
  }

  /** Shows `model` (a query opened from a page), replacing the current one undoably */
  openModel(model: QueryModel, fields: FieldInfo[]): void {
    if (this.model) this.snapshot = { model: this.model, fields: this.fields };
    this.model = this.pristine = model;
    this.fields = fields;
    this.resets++;
    this.changed();
  }

  /**
   * The current tag's fields, loaded again because the space's data changed:
   * the query stays, except an untouched new one, whose columns follow the
   * fields
   */
  refreshData(fields: FieldInfo[]): void {
    const m = this.model;
    if (!m) return;
    if (m === this.blank) {
      this.model = this.pristine = this.blank = emptyModel(m.tag, fields);
      this.resets++;
    }
    this.fields = fields;
    this.dataVersion++;
    this.changed();
  }

  undo(): boolean {
    if (!this.snapshot) return false;
    this.model = this.snapshot.model;
    this.fields = this.snapshot.fields;
    this.snapshot = null;
    this.resets++;
    this.changed();
    return true;
  }

  setTarget(target: InsertTarget | null): void {
    this.target = target;
    this.changed();
  }
}

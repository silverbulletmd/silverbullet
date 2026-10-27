/**
 * The Query tab's state, kept for the whole session so switching tabs or
 * closing the Workbench doesn't lose work.
 */
import type { AttributeInfo } from "./query_attributes.ts";
import type { QuerySource } from "./query_from.ts";
import { emptyModel, attributeType, type QueryModel } from "./query_model.ts";
import type { OperatorType } from "./query_ops.ts";

/**
 * Where the query goes: the spot `/Query…` was typed (`from` = `to`), or the
 * query opened from the page, which it replaces
 */
export type InsertTarget = { page: string; from: number; to: number };

type Snapshot = { model: QueryModel; attributes: AttributeInfo[] };

export class QueryBuilder {
  model: QueryModel | null = null;
  attributes: AttributeInfo[] = [];
  target: InsertTarget | null = null;
  /** Whether system attributes are offered too */
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
  /** The empty query a picked tag started with, which fresh attributes rebuild */
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

  /** The attributes on offer: system ones only when asked for */
  offeredAttributes(): AttributeInfo[] {
    return this.attributes.filter((f) => this.showSystem || !f.system);
  }

  /** The first attribute on offer, for a new filter or column */
  firstAttribute(): string {
    return this.offeredAttributes()[0]?.name ?? "name";
  }

  typeOf(name: string): OperatorType {
    return this.model
      ? attributeType(this.model, this.attributes, name)
      : "text";
  }

  update(
    fn: (m: QueryModel) => QueryModel,
    opts: { undoable?: boolean } = {},
  ): void {
    if (!this.model) return;
    if (opts.undoable) {
      this.snapshot = { model: this.model, attributes: this.attributes };
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

  /** Starts over on `source`; returns whether the replaced work can be undone */
  pickSource(source: QuerySource, attributes: AttributeInfo[]): boolean {
    const old = this.model;
    const edited = !!old && old !== this.pristine;
    this.snapshot = edited ? { model: old, attributes: this.attributes } : null;
    this.model = this.pristine = this.blank = emptyModel(source, attributes);
    this.attributes = attributes;
    this.resets++;
    this.changed();
    return edited;
  }

  /**
   * Narrows (or widens) the objects read, keeping the query: they're the same
   * kind of objects, so its filters and columns still apply
   */
  narrow(source: QuerySource, attributes: AttributeInfo[]): void {
    const m = this.model;
    if (!m) return;
    this.snapshot = { model: m, attributes: this.attributes };
    this.model =
      m === this.blank
        ? (this.pristine = this.blank = emptyModel(source, attributes))
        : { ...m, source };
    this.attributes = attributes;
    this.resets++;
    this.changed();
  }

  /** Shows `model` (a query opened from a page), replacing the current one undoably */
  openModel(model: QueryModel, attributes: AttributeInfo[]): void {
    if (this.model)
      this.snapshot = { model: this.model, attributes: this.attributes };
    this.model = this.pristine = model;
    this.attributes = attributes;
    this.resets++;
    this.changed();
  }

  /**
   * The current tag's attributes, loaded again because the space's data changed:
   * the query stays, except an untouched new one, whose columns follow the
   * attributes
   */
  refreshData(attributes: AttributeInfo[]): void {
    const m = this.model;
    if (!m) return;
    if (m === this.blank) {
      this.model =
        this.pristine =
        this.blank =
          emptyModel(m.source, attributes);
      this.resets++;
    }
    this.attributes = attributes;
    this.dataVersion++;
    this.changed();
  }

  undo(): boolean {
    if (!this.snapshot) return false;
    this.model = this.snapshot.model;
    this.attributes = this.snapshot.attributes;
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

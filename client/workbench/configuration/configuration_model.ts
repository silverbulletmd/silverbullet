import {
  findManagedBlock,
  invalidManagedBlockMessage,
} from "../../config_management/config_block.ts";
import {
  diffOverrides,
  type ManagedChanges,
  type OverrideChanges,
} from "../../config_management/managed_edit.ts";
import {
  type CommandOverride,
  parseManagedBlock,
} from "../../config_management/managed_lua.ts";
import { ReloadingStore } from "../shared/reloading_store.ts";
import {
  allActiveBindings,
  type Commands,
  type Conflicts,
  findConflicts,
  hasAnyConflict,
  manifestBindings,
  normalizeLoadedOverride,
  overrideBindings,
  resolvedBindings,
  withBindings,
} from "./keys.ts";
import {
  buildSchemaIndex,
  getSchemaAtPath,
  getValueAtPath,
  type SchemaIndex,
  type SchemaSource,
} from "./schema.ts";

/** Everything the Configuration tab is built from, read fresh on each load. */
export type ConfigurationSource = SchemaSource & {
  commands: Commands;
  configText: string;
  isMac: boolean;
  writable: boolean;
};

export type ConfigurationDeps = {
  load: () => Promise<ConfigurationSource>;
  save: (changes: ManagedChanges) => Promise<void>;
  subscribeReload: (changed: () => void) => () => void;
  onDirty: (dirty: boolean) => void;
};

export type Section = "configuration" | "keyBindings";

/** The overrides of the managed block: config paths and commands. */
export type Overrides = {
  config: Record<string, unknown>;
  commands: Record<string, CommandOverride>;
};

/** An edit that drops the override, back to the default. */
const RESET = Symbol("reset");
type Edits<T> = Map<string, T | typeof RESET>;

function overlay<T>(base: Record<string, T>, edits: Edits<T>) {
  const result = { ...base };
  for (const [key, edit] of edits) {
    if (edit === RESET) delete result[key];
    else result[key] = edit;
  }
  return result;
}

/** Drops the edits a save sent, keeping any changed while it ran */
function dropSent<T>(edits: Edits<T>, sent: Edits<T>): void {
  for (const [key, value] of sent) {
    if (edits.get(key) === value) edits.delete(key);
  }
}

function count(changes: OverrideChanges<unknown>): number {
  return Object.keys(changes.set).length + changes.unset.length;
}

const NO_OVERRIDES: Overrides = { config: {}, commands: {} };

/**
 * The Configuration tab's state. Edits save as they are made: controls
 * changed in one go save right away, text fields when they are left (see
 * `save`). The managed block is parsed once per
 * load into the saved overrides; the user's edits are kept apart and laid
 * over them, so a Library/Config changed meanwhile shows through everywhere else.
 */
export class ConfigurationModel extends ReloadingStore<ConfigurationSource> {
  source?: ConfigurationSource;
  index: SchemaIndex = { categoryMap: {}, sortedCategoryNames: [] };
  managedBlockError?: string;
  section: Section = "configuration";
  /** The saved overrides with the user's edits laid over them */
  pending: Overrides = NO_OVERRIDES;
  saving = false;
  saveError?: string;

  // As written in Library/Config; saving diffs against it
  private saved: Overrides = NO_OVERRIDES;
  // With old manager output repaired; what counts as unchanged
  private repaired: Overrides = NO_OVERRIDES;
  private edits: { config: Edits<unknown>; commands: Edits<CommandOverride> } =
    { config: new Map(), commands: new Map() };
  private saveWanted = false;
  // Set while an edit that saves right away is made, so it doesn't badge
  private committing = false;

  constructor(private deps: ConfigurationDeps) {
    super(deps);
  }

  get ready(): boolean {
    return this.source !== undefined;
  }

  /** How many overrides the user changed; repairs alone don't count. */
  get unsavedCount(): number {
    return (
      count(diffOverrides(this.repaired.config, this.pending.config)) +
      count(diffOverrides(this.repaired.commands, this.pending.commands))
    );
  }

  override get dirty(): boolean {
    return this.unsavedCount > 0;
  }

  showSection(section: Section): void {
    this.section = section;
    this.emit();
  }

  /** The value a field shows: its override, else what's in effect now. */
  valueOf(path: string): unknown {
    if (path in this.pending.config) return this.pending.config[path];
    if (this.edits.config.get(path) === RESET) return this.defaultOf(path);
    return getValueAtPath(this.source?.values, path);
  }

  setField(path: string, value: unknown): void {
    const isBool =
      getSchemaAtPath(this.source?.schemas, path)?.type === "boolean";
    const current = isBool && value == null ? false : value;
    this.edit(
      this.edits.config,
      path,
      current === this.defaultOf(path) ? RESET : value,
    );
  }

  resetField(path: string): void {
    this.andSave(() => this.edit(this.edits.config, path, RESET));
  }

  isModified(path: string): boolean {
    return path in this.pending.config;
  }

  resolvedBindings(name: string): string[] {
    const { commands, isMac } = this.platform();
    return resolvedBindings(name, this.pending.commands, commands, isMac);
  }

  conflictCheck(tokens: string[], self: { name: string; slot: number }) {
    const { commands, isMac } = this.platform();
    return findConflicts(
      tokens,
      allActiveBindings(this.pending.commands, commands, isMac),
      self,
      isMac,
    );
  }

  /** Records a binding, or refuses with the conflicts when there are any. */
  commit(name: string, slot: number, tokens: string[]): Conflicts | null {
    const conflicts = this.conflictCheck(tokens, { name, slot });
    if (hasAnyConflict(conflicts)) return conflicts;
    this.andSave(() =>
      this.editBindings(name, (list) => {
        list[Math.min(slot, list.length)] = tokens.join(" ");
      }),
    );
    return null;
  }

  deleteSlot(name: string, slot: number): void {
    this.andSave(() => this.editBindings(name, (list) => list.splice(slot, 1)));
  }

  resetBinding(name: string): void {
    this.andSave(() => this.edit(this.edits.commands, name, RESET));
  }

  isBindingModified(name: string): boolean {
    return name in this.pending.commands;
  }

  alternateSlot(name: string): number {
    const { commands, isMac } = this.platform();
    const override = overrideBindings(this.pending.commands[name], isMac);
    return (override ?? manifestBindings(name, commands, isMac)).length;
  }

  changes(): ManagedChanges {
    return {
      config: diffOverrides(this.saved.config, this.pending.config),
      commands: diffOverrides(this.saved.commands, this.pending.commands),
    };
  }

  /**
   * Saves every edit. One save runs at a time: edits made meanwhile go out in
   * the next one. While the managed block is invalid the request waits, and
   * the load that finds the block fixed saves.
   */
  async save(): Promise<void> {
    this.saveWanted = true;
    if (this.saving) return;
    while (
      this.saveWanted &&
      this.ready &&
      !this.managedBlockError &&
      this.dirty
    ) {
      this.saveWanted = false;
      this.saving = true;
      this.saveError = undefined;
      this.emit();
      const sent = {
        config: new Map(this.edits.config),
        commands: new Map(this.edits.commands),
      };
      try {
        await this.deps.save(this.changes());
        dropSent(this.edits.config, sent.config);
        dropSent(this.edits.commands, sent.commands);
        await this.load();
      } catch (e: any) {
        this.saveError = `Failed to save: ${e?.message ?? e}`;
        this.saveWanted = false;
      } finally {
        this.saving = false;
        this.emit();
      }
    }
  }

  /** Sets a field and saves it, for controls changed in one go */
  commitField(path: string, value: unknown): void {
    this.andSave(() => this.setField(path, value));
  }

  /**
   * Sets a field to `compute(its current value)` and waits for it to be
   * written, for callers outside the tab: the model only loads while
   * subscribed, so this holds a subscription for as long as it runs. Throws
   * when nothing could be written.
   */
  async commitNow(
    path: string,
    compute: (current: unknown) => unknown,
  ): Promise<void> {
    // A model nothing subscribes to stopped following reloads: load afresh
    const stale = !this.subscribed;
    const release = this.subscribe(() => {});
    try {
      if (stale || !this.ready) await this.load();
      if (!this.ready) {
        throw new Error(this.loadError ?? "Couldn't load the configuration");
      }
      if (!this.source?.writable) throw new Error("This space is read-only");
      if (this.managedBlockError) throw new Error(this.managedBlockError);
      const value = await compute(this.valueOf(path));
      this.committing = true;
      try {
        this.setField(path, value);
      } finally {
        this.committing = false;
      }
      await this.save();
      if (this.saveError) throw new Error(this.saveError);
    } finally {
      release();
    }
  }

  /** Drops a field's unsaved edit, back to what is saved */
  revertField(path: string): void {
    if (!this.edits.config.delete(path)) return;
    this.update();
  }

  discard(): void {
    this.edits.config.clear();
    this.edits.commands.clear();
    this.saveError = undefined;
    this.saveWanted = false;
    this.update();
  }

  protected override get badged(): boolean {
    return this.dirty && !this.saving && !this.committing;
  }

  protected override stopped(): void {
    void this.save();
  }

  protected override loadErrorMessage(e: any): string {
    return `Couldn't read Library/Config: ${e?.message ?? e}`;
  }

  protected loaded(source: ConfigurationSource): void {
    this.source = source;
    this.index = buildSchemaIndex(source);
    this.managedBlockError = undefined;
    this.saved = NO_OVERRIDES;
    const block = findManagedBlock(source.configText);
    if (block) {
      const parsed = parseManagedBlock(block.innerContent);
      this.saved = {
        config: parsed.configOverrides,
        commands: parsed.commandOverrides,
      };
      if (parsed.error !== undefined) {
        this.managedBlockError = invalidManagedBlockMessage(parsed.error);
      }
    }
    this.repaired = {
      config: this.saved.config,
      commands: Object.fromEntries(
        Object.entries(this.saved.commands).map(([name, o]) => [
          name,
          normalizeLoadedOverride(o),
        ]),
      ),
    };
    this.update();
    // A save that waited for the block to be fixed
    if (this.saveWanted && !this.saving) void this.save();
  }

  private andSave(edit: () => void): void {
    this.committing = true;
    try {
      edit();
    } finally {
      this.committing = false;
    }
    void this.save();
  }

  private edit<T>(edits: Edits<T>, key: string, value: T | typeof RESET) {
    if (!this.source?.writable) return;
    edits.set(key, value);
    this.update();
  }

  private editBindings(name: string, edit: (list: string[]) => void): void {
    const list = this.resolvedBindings(name);
    edit(list);
    const { isMac } = this.platform();
    this.edit(
      this.edits.commands,
      name,
      withBindings(this.pending.commands[name], list, isMac),
    );
  }

  private update(): void {
    this.pending = {
      config: overlay(this.repaired.config, this.edits.config),
      commands: overlay(this.repaired.commands, this.edits.commands),
    };
    this.emit();
  }

  private defaultOf(path: string): unknown {
    const schema = getSchemaAtPath(this.source?.schemas, path);
    return schema?.type === "boolean"
      ? (schema.default ?? false)
      : schema?.default;
  }

  private platform() {
    return {
      commands: this.source?.commands ?? {},
      isMac: this.source?.isMac ?? false,
    };
  }
}

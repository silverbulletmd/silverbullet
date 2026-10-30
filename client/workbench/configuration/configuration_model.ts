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

function count(changes: OverrideChanges<unknown>): number {
  return Object.keys(changes.set).length + changes.unset.length;
}

const NO_OVERRIDES: Overrides = { config: {}, commands: {} };

/**
 * The Configuration tab's state. It outlives the tab's view, so edits stay
 * pending while the Workbench is closed. The managed block is parsed once per
 * load into the saved overrides; the user's edits are kept apart and laid
 * over them, so a CONFIG changed meanwhile shows through everywhere else.
 */
export class ConfigurationModel {
  source?: ConfigurationSource;
  index: SchemaIndex = { categoryMap: {}, sortedCategoryNames: [] };
  managedBlockError?: string;
  section: Section = "configuration";
  /** The saved overrides with the user's edits laid over them */
  pending: Overrides = NO_OVERRIDES;
  saving = false;
  saveError?: string;
  loadError?: string;

  // As written in CONFIG; saving diffs against it
  private saved: Overrides = NO_OVERRIDES;
  // With old manager output repaired; what counts as unchanged
  private repaired: Overrides = NO_OVERRIDES;
  private edits: { config: Edits<unknown>; commands: Edits<CommandOverride> } =
    { config: new Map(), commands: new Map() };
  private listeners = new Set<() => void>();
  private stopReload?: () => void;
  private loads = 0;
  private wasDirty = false;

  constructor(private deps: ConfigurationDeps) {}

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

  get dirty(): boolean {
    return this.unsavedCount > 0;
  }

  /** Loads on the first subscriber and follows config reloads while any remain. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.stopReload = this.deps.subscribeReload(() => void this.load());
      void this.load();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopReload?.();
        this.stopReload = undefined;
      }
    };
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
    this.edit(this.edits.config, path, RESET);
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
    this.editBindings(name, (list) => {
      list[Math.min(slot, list.length)] = tokens.join(" ");
    });
    return null;
  }

  deleteSlot(name: string, slot: number): void {
    this.editBindings(name, (list) => list.splice(slot, 1));
  }

  resetBinding(name: string): void {
    this.edit(this.edits.commands, name, RESET);
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

  async save(): Promise<void> {
    if (!this.ready || this.managedBlockError || this.saving || !this.dirty) {
      return;
    }
    this.saving = true;
    this.saveError = undefined;
    this.emit();
    try {
      await this.deps.save(this.changes());
      this.edits.config.clear();
      this.edits.commands.clear();
      await this.load();
    } catch (e: any) {
      this.saveError = `Failed to save: ${e?.message ?? e}`;
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  discard(): void {
    this.edits.config.clear();
    this.edits.commands.clear();
    this.saveError = undefined;
    this.update();
  }

  private async load(): Promise<void> {
    const n = ++this.loads;
    let source: ConfigurationSource;
    try {
      source = await this.deps.load();
    } catch (e: any) {
      if (n !== this.loads) return;
      this.loadError = `Couldn't read CONFIG: ${e?.message ?? e}`;
      this.emit();
      return;
    }
    // A later load started meanwhile: its result is the current one
    if (n !== this.loads) return;
    this.loadError = undefined;
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

  private emit(): void {
    const dirty = this.dirty;
    if (dirty !== this.wasDirty) {
      this.wasDirty = dirty;
      this.deps.onDirty(dirty);
    }
    for (const listener of this.listeners) listener();
  }
}

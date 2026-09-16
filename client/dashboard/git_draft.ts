import type { GitDraft } from "./types.ts";

export class GitDraftSession {
  private revision = 0;
  private active = true;
  dirty = false;

  private readonly initial: GitDraft;

  constructor(public value: GitDraft) {
    this.initial = { ...value };
  }

  get changed(): boolean {
    return (
      this.value.url !== this.initial.url ||
      this.value.mode !== this.initial.mode ||
      this.value.pullIntervalSecs !== this.initial.pullIntervalSecs ||
      this.value.publicKey !== this.initial.publicKey ||
      this.value.fingerprint !== this.initial.fingerprint
    );
  }

  get canApply(): boolean {
    return (
      this.active &&
      !this.dirty &&
      this.value.test?.reachable === true &&
      ["ok", "behind", "emptyRepo"].includes(this.value.test.kind) &&
      this.value.test.checkedUrl === this.value.url
    );
  }

  edit(
    fields: Partial<Pick<GitDraft, "url" | "mode" | "pullIntervalSecs">>,
  ): void {
    this.revision++;
    this.dirty = true;
    this.value = { ...this.value, ...fields, test: undefined };
  }

  async run(
    operation: (value: GitDraft) => Promise<GitDraft>,
  ): Promise<boolean> {
    const revision = this.revision;
    const result = await operation(this.value);
    if (!this.active) return false;
    if (revision !== this.revision) {
      this.value = {
        ...this.value,
        version: result.version,
        publicKey: result.publicKey,
        fingerprint: result.fingerprint,
        test: undefined,
      };
      return false;
    }
    this.value = result;
    this.dirty = false;
    return true;
  }

  invalidateCheck(): void {
    this.revision++;
    this.value = { ...this.value, test: undefined };
  }

  discard(): void {
    this.active = false;
    this.value = { ...this.value, test: undefined };
  }
}

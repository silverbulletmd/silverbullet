import { beforeEach, expect, test, vi } from "vitest";

const calls: string[] = [];
const record =
  (name: string) =>
  async (..._args: unknown[]) => {
    calls.push(name);
  };

const editor = {
  save: vi.fn(record("editor.save")),
  reloadConfigAndCommands: vi.fn(record("editor.reloadConfigAndCommands")),
  flashNotification: vi.fn(record("editor.flashNotification")),
};
const system = {
  reboot: vi.fn(record("system.reboot")),
};
const codeWidget = {
  refreshAll: vi.fn(record("codeWidget.refreshAll")),
};
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  editor,
  system,
  codeWidget,
  clientStore: {},
}));

const { reloadSystem } = await import("./editor.ts");

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

test("System: Reload reboots instead of saving the buffer over external edits", async () => {
  await reloadSystem();
  expect(editor.save).not.toHaveBeenCalled();
  expect(calls).toEqual([
    "system.reboot",
    "codeWidget.refreshAll",
    "editor.flashNotification",
  ]);
});

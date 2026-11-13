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
const theme = {
  list: vi.fn(async () => [] as unknown[]),
  getActive: vi.fn(async () => ({}) as unknown),
  setDeviceTheme: vi.fn(async (..._args: unknown[]) => {}),
  getDeviceTheme: vi.fn(async () => undefined as string | undefined),
};
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  theme,
  editor,
  system,
  codeWidget,
  clientStore: {},
}));

const { reloadSystem, toggleTheme } = await import("./editor.ts");

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

test("Theme: Toggle Light/Dark with a counterpart that is not an installed theme flashes a notification and changes nothing", async () => {
  theme.getActive.mockResolvedValue({
    page: "Themes/Sepia",
    displayName: "Sepia",
    scheme: "light",
    counterpart: "Themes/Missing",
  });
  theme.list.mockResolvedValue([
    { page: "Themes/Sepia", displayName: "Sepia", scheme: "light" },
  ]);
  await toggleTheme();
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "Sepia has no dark counterpart",
    "info",
  );
  expect(theme.setDeviceTheme).not.toHaveBeenCalled();
});

test("Theme: Toggle Light/Dark switches to an installed counterpart", async () => {
  theme.getActive.mockResolvedValue({
    page: "A",
    displayName: "A",
    scheme: "light",
    counterpart: "B",
  });
  theme.list.mockResolvedValue([
    { page: "B", displayName: "B", scheme: "dark" },
  ]);
  await toggleTheme();
  expect(theme.setDeviceTheme).toHaveBeenCalledWith("B");
  expect(editor.flashNotification).not.toHaveBeenCalled();
});

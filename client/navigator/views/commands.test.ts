import { expect, test, vi } from "vitest";

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  editor: {},
  system: {},
}));
vi.mock("../navigator.ts", () => ({ hide: () => {} }));

const { commandPalette } = await import("./commands.ts");

test("a command's own icon is shown in the palette", () => {
  const icon = commandPalette.row.icon as (o: any) => string;
  expect(icon({ name: "Page: Save", priority: 0, icon: "save" })).toBe("save");
});

test("a command without an icon gets the terminal icon", () => {
  const icon = commandPalette.row.icon as (o: any) => string;
  expect(icon({ name: "Page: Save", priority: 0 })).toBe("terminal");
});

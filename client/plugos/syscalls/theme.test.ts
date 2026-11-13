import { beforeEach, expect, test, vi } from "vitest";
import type { Client } from "../../client.ts";
import type { SyscallDefinition } from "../system.ts";
import { themeSyscalls } from "./theme.ts";

const light = {
  page: "Library/Std/Themes/SilverBullet Light",
  displayName: "SilverBullet Light",
  scheme: "light",
  counterpart: "Library/Std/Themes/SilverBullet Dark",
};
const dark = {
  page: "Library/Std/Themes/SilverBullet Dark",
  displayName: "SilverBullet Dark",
  scheme: "dark",
  counterpart: light.page,
};

let active: typeof light;
let client: Client;
const deviceTheme = vi.fn();
const setDeviceTheme = vi.fn();

beforeEach(() => {
  active = light;
  deviceTheme.mockReset().mockResolvedValue(dark.page);
  setDeviceTheme.mockReset().mockResolvedValue(undefined);
  client = {
    tooling: { themes: [light, dark] },
    spaceTheme: {
      get active() {
        return active;
      },
      deviceTheme,
      setDeviceTheme,
    },
  } as unknown as Client;
});

function call(name: string, ...args: unknown[]): any {
  const def = themeSyscalls(client)[name];
  const cb = typeof def === "function" ? def : def.callback;
  return cb({} as any, ...args);
}

// SpaceTheme stores, checks and applies it (space_theme.test.ts)
test("the device theme syscalls go to SpaceTheme; the page is optional", async () => {
  expect(await call("theme.getDeviceTheme")).toBe(dark.page);
  await call("theme.setDeviceTheme", dark.page);
  await call("theme.setDeviceTheme");
  expect(setDeviceTheme.mock.calls).toEqual([[dark.page], [undefined]]);
  const def = themeSyscalls(client)[
    "theme.setDeviceTheme"
  ] as SyscallDefinition;
  expect(def.parameters?.[0].optional).toBe(true);
});

test("getActive returns the theme on screen", () => {
  active = dark;
  expect(call("theme.getActive")).toEqual(dark);
});

test("list returns the installed themes as plain objects", () => {
  expect(call("theme.list")).toEqual([light, dark]);
});

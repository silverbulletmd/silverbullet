import { expect, test } from "vitest";
import { precacheList } from "./build_client.ts";

test("icon data is precached but its search keywords load on demand", () => {
  const list = precacheList(["client.js", "icons.json", "icon-tags.json"]);
  expect(list).toContain("/.client/icons.json");
  expect(list).not.toContain("/.client/icon-tags.json");
});

test("source maps and server-level entry points are not precached", () => {
  const list = precacheList(["client.js", "client.js.map", "dashboard.js"]);
  expect(list).toEqual(["/", "/.client/client.js"]);
});

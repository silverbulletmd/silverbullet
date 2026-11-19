import { expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { frontmatterIconComplete } from "./icon_complete.ts";

function fmEvent(linePrefix: string, fmContent: string) {
  return {
    linePrefix,
    pos: 40,
    pageName: "TestPage",
    parentNodes: [`FrontMatter:${fmContent}`],
  } as any;
}

function withIcons() {
  const mock = createMockSystem();
  mock.system.registerSyscalls([], {
    "icon.names": () => ["book", "house", "house-plus", "zap"],
  });
}

test("completes Lucide names in a nested pageDecoration icon value", async () => {
  withIcons();
  const result = await frontmatterIconComplete(
    fmEvent("  icon: hou", "pageDecoration:\n  icon: hou"),
  );
  expect(result?.options.map((o: any) => o.label)).toEqual([
    "house",
    "house-plus",
  ]);
  expect(result?.from).toBe(40 - "hou".length);
  expect((result!.options[0] as any).icon).toBe("house");
});

test("completes a top-level icon key too", async () => {
  withIcons();
  const result = await frontmatterIconComplete(fmEvent("icon: bo", "icon: bo"));
  expect(result?.options.map((o: any) => o.label)).toEqual(["book"]);
});

test("ignores other keys", async () => {
  withIcons();
  expect(
    await frontmatterIconComplete(fmEvent("title: hou", "title: hou")),
  ).toBeNull();
});

test("ignores icon: outside frontmatter", async () => {
  withIcons();
  expect(
    await frontmatterIconComplete({
      linePrefix: "icon: hou",
      pos: 9,
      pageName: "P",
      parentNodes: ["Paragraph"],
    } as any),
  ).toBeNull();
});

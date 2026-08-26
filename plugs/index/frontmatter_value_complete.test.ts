import { expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { frontmatterValueComplete } from "./frontmatter_value_complete.ts";

function fmEvent(linePrefix: string, fmContent: string) {
  return {
    linePrefix,
    pos: linePrefix.length,
    pageName: "TestPage",
    parentNodes: [`FrontMatter:${fmContent}`],
  } as any;
}

test("frontmatterValueComplete routes recipients, authors, and tags", async () => {
  const mock = createMockSystem();
  mock.system.registerSyscalls([], {
    "system.listAccounts": () => [{ username: "ada", me: false }],
    "system.getProfile": () => ({ username: "me" }),
  });

  const rec = await frontmatterValueComplete(
    fmEvent("recipients: @a", "recipients: @a"),
  );
  expect(rec?.options.map((o: any) => o.label)).toContain("ada");

  const auth = await frontmatterValueComplete(
    fmEvent("authors: @a", "authors: @a"),
  );
  expect(auth?.options.map((o: any) => o.label)).toContain("ada");

  // Outside any known value key -> null (does not throw).
  const none = await frontmatterValueComplete(
    fmEvent("title: hel", "title: hel"),
  );
  expect(none).toBeNull();
});

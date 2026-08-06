import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexComments } from "./comment.ts";

function pm(name = "TestPage"): PageMeta {
  return {
    ref: name,
    name,
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };
}

const page = `Some paragraph making a claim.
<!-- re: "making a claim"
     @pete: verify this — john, 2026-08-04 -->

<!-- just a plain comment -->

<!--#lua 3 + 4 -->
7
<!--/lua-->

<!-- @john: unsigned reply pending -->
`;

test("conforming comments are indexed, others are not", async () => {
  const tree = parseMarkdown(page);
  const objects = await indexComments(pm(), extractFrontMatter(tree), tree);
  // Machine directives (#lua / /lua) are still excluded; the bare
  // "just a plain comment" block is now indexed too, since every HTML
  // comment that isn't a directive is a conforming note.
  expect(objects.length).toBe(3);
  const [first, second, third] = objects;
  expect(first.tag).toBe("comment");
  expect(first.page).toBe("TestPage");
  expect(first.quote).toBe("making a claim");
  expect(first.waitingOn).toBe("pete");
  expect(first.ref).toBe(`TestPage@${first.range[0]}`);
  expect(Array.isArray(first.range)).toBe(true);
  expect(page.slice(first.range[0], first.range[1])).toContain("@pete:");
  expect((first as any).pos).toBeUndefined();

  expect(second.thread).toEqual([{ text: "just a plain comment" }]);
  expect(second.waitingOn).toBeUndefined();

  expect(third.waitingOn).toBe("john");
});

test("comment inside fenced code is not indexed", async () => {
  const tree = parseMarkdown(
    "```\n<!-- @pete: not a real comment -->\n```\n",
  );
  const objects = await indexComments(pm(), extractFrontMatter(tree), tree);
  expect(objects.length).toBe(0);
});

test("an unaddressed signed note is indexed with waitingOn absent", async () => {
  const tree = parseMarkdown(
    "A reminder.\n<!-- rephrase this later — pete, 2026-08-05 -->\n",
  );
  const objects = await indexComments(pm(), extractFrontMatter(tree), tree);
  expect(objects.length).toBe(1);
  expect(objects[0].thread[0].addressee).toBeUndefined();
  expect(objects[0].thread[0].author).toBe("pete");
  expect(objects[0].waitingOn).toBeUndefined();
  expect("waitingOn" in objects[0]).toBe(false);
});

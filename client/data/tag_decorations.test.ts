import { expect, test } from "vitest";
import { withTagDecorations } from "./object_index.ts";

const page = (extra: Record<string, any> = {}) =>
  ({
    ref: "Some Page",
    tag: "page",
    tags: [],
    name: "Some Page",
    ...extra,
  }) as any;

test("a tag's icon is the default page icon for pages carrying it", () => {
  const out: any = withTagDecorations(page({ tags: ["recipe"] }), {
    recipe: { icon: "coffee" },
  });
  expect(out.pageDecoration.icon).toBe("coffee");
});

test("a page's own icon wins over its tags'", () => {
  const out: any = withTagDecorations(
    page({ tags: ["recipe"], pageDecoration: { icon: "book" } }),
    { recipe: { icon: "coffee" } },
  );
  expect(out.pageDecoration.icon).toBe("book");
});

test("the built-in page tag's icon does not decorate every page", () => {
  const out: any = withTagDecorations(page(), {
    page: { icon: "file-text" },
  });
  expect(out.pageDecoration?.icon).toBeUndefined();
});

test("a tag-level pageDecoration contributes its fields but not an icon", () => {
  const out: any = withTagDecorations(page({ tags: ["quote"] }), {
    quote: { pageDecoration: { icon: "x", prefix: "> " } },
  });
  expect(out.pageDecoration.prefix).toBe("> ");
  expect(out.pageDecoration.icon).toBeUndefined();
});

test("a non-string tag icon contributes no icon and doesn't throw", () => {
  const out: any = withTagDecorations(page({ tags: ["odd"] }), {
    odd: { icon: 42 as any },
  });
  expect(out.pageDecoration?.icon).toBeUndefined();
});

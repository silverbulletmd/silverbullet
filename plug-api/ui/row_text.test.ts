import { h } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import { RowText } from "./row_text.tsx";

test("excerpts and their labels take their direction from their own text", () => {
  const html = render(
    h(RowText, {
      primary: "Notes/Reading",
      description: {
        label: "القراءة",
        text: "قرأت الكتاب أمس.",
        highlights: [[5, 11]],
      },
    }),
  );
  expect(html).toContain(
    '<span class="sb-nav-description-label" dir="auto">القراءة</span>',
  );
  expect(html).toContain(
    '<span class="sb-nav-description-text" dir="auto">قرأت <mark>الكتاب</mark> أمس.</span>',
  );
});

test("plain descriptions take their direction from their text", () => {
  const html = render(h(RowText, { primary: "P", description: "ملاحظات" }));
  expect(html).toContain(
    '<span class="sb-nav-description" dir="auto">ملاحظات</span>',
  );
});

// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { LinkWidget } from "../util.ts";

test("a link with rendered content fills its label asynchronously", async () => {
  const w = new LinkWidget({
    text: "n=${1+1}",
    title: "t",
    cssClass: "sb-wiki-link",
    from: 0,
    callback: () => {},
    content: async (label) => {
      label.innerHTML = "n=<b>2</b>";
    },
  });
  const a = w.toDOM();
  await new Promise((r) => setTimeout(r, 0));
  expect(a.tagName).toBe("A");
  expect(a.textContent).toBe("n=2");
  expect(a.querySelector("b")).not.toBeNull();
});

test("a link with empty text renders no text", () => {
  const w = new LinkWidget({
    text: "",
    title: "t",
    cssClass: "sb-wiki-link",
    from: 0,
    callback: () => {},
  });
  expect(w.toDOM().textContent).toBe("");
});

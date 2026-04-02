import { expect, test } from "vitest";
import { matchHtmlTagPairs, parseHtmlTag } from "./html_element.ts";

test("parseHtmlTag - opening tag", () => {
  const result = parseHtmlTag("<marquee>");
  expect(result).toEqual({
    tagName: "marquee",
    attributes: "",
    parsedAttrs: {},
    isClosing: false,
    isSelfClosing: false,
  });
});

test("parseHtmlTag - closing tag", () => {
  const result = parseHtmlTag("</marquee>");
  expect(result).toEqual({
    tagName: "marquee",
    attributes: "",
    parsedAttrs: {},
    isClosing: true,
    isSelfClosing: false,
  });
});

test("parseHtmlTag - tag with attributes", () => {
  const result = parseHtmlTag('<div class="foo" id="bar">');
  expect(result).toEqual({
    tagName: "div",
    attributes: 'class="foo" id="bar"',
    parsedAttrs: { class: "foo", id: "bar" },
    isClosing: false,
    isSelfClosing: false,
  });
});

test("parseHtmlTag - self-closing tag", () => {
  const result = parseHtmlTag('<img src="test.png" />');
  expect(result).toEqual({
    tagName: "img",
    attributes: 'src="test.png"',
    parsedAttrs: { src: "test.png" },
    isClosing: false,
    isSelfClosing: true,
  });
});

test("parseHtmlTag - void element without slash", () => {
  const result = parseHtmlTag("<br>");
  expect(result).toEqual({
    tagName: "br",
    attributes: "",
    parsedAttrs: {},
    isClosing: false,
    isSelfClosing: true,
  });
});

test("parseHtmlTag - invalid text", () => {
  expect(parseHtmlTag("not a tag")).toBeNull();
  expect(parseHtmlTag("")).toBeNull();
});

function makeTags(
  ...specs: { text: string; from: number; to: number }[]
) {
  return specs.map((s) => {
    const parsed = parseHtmlTag(s.text)!;
    return { ...parsed, from: s.from, to: s.to, text: s.text };
  });
}

test("matchHtmlTagPairs - simple pair", () => {
  const tags = makeTags(
    { text: "<b>", from: 0, to: 3 },
    { text: "</b>", from: 10, to: 14 },
  );
  const { pairs, voidElements } = matchHtmlTagPairs(tags);
  expect(pairs).toHaveLength(1);
  expect(pairs[0].open.from).toBe(0);
  expect(pairs[0].close.from).toBe(10);
  expect(voidElements).toHaveLength(0);
});

test("matchHtmlTagPairs - nested same-name tags", () => {
  const tags = makeTags(
    { text: "<b>", from: 0, to: 3 },
    { text: "<b>", from: 5, to: 8 },
    { text: "</b>", from: 12, to: 16 },
    { text: "</b>", from: 18, to: 22 },
  );
  const { pairs } = matchHtmlTagPairs(tags);
  expect(pairs).toHaveLength(2);
  // Inner pair matched first
  expect(pairs[0].open.from).toBe(5);
  expect(pairs[0].close.from).toBe(12);
  // Outer pair
  expect(pairs[1].open.from).toBe(0);
  expect(pairs[1].close.from).toBe(18);
});

test("matchHtmlTagPairs - void elements", () => {
  const tags = makeTags(
    { text: "<br>", from: 0, to: 4 },
    { text: '<img src="x" />', from: 5, to: 20 },
  );
  const { pairs, voidElements } = matchHtmlTagPairs(tags);
  expect(pairs).toHaveLength(0);
  expect(voidElements).toHaveLength(2);
});

test("matchHtmlTagPairs - unmatched tags", () => {
  const tags = makeTags(
    { text: "<b>", from: 0, to: 3 },
    { text: "</i>", from: 10, to: 14 },
  );
  const { pairs } = matchHtmlTagPairs(tags);
  expect(pairs).toHaveLength(0);
});

test("matchHtmlTagPairs - interleaved tags", () => {
  // <b><i></b></i> — b matches b, i left unmatched
  const tags = makeTags(
    { text: "<b>", from: 0, to: 3 },
    { text: "<i>", from: 3, to: 6 },
    { text: "</b>", from: 10, to: 14 },
    { text: "</i>", from: 14, to: 18 },
  );
  const { pairs } = matchHtmlTagPairs(tags);
  // Both pairs match (b with b, i with i) even though interleaved
  expect(pairs).toHaveLength(2);
  expect(pairs[0].open.tagName).toBe("b");
  expect(pairs[1].open.tagName).toBe("i");
});


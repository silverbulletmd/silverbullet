export type ParsedTag = {
  tagName: string;
  attributes: string;
  parsedAttrs: Record<string, string>;
  isClosing: boolean;
  isSelfClosing: boolean;
};

type TagInfo = ParsedTag & {
  from: number;
  to: number;
  text: string;
};

export type MatchedPair = {
  open: TagInfo;
  close: TagInfo;
};

const TAG_REGEX = /^<(\/?)([a-zA-Z][\w-]*)((?:\s[^>]*?)?)\s*(\/?)>$/s;

const ATTR_REGEX =
  /([a-zA-Z:_][\w\-.:]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function parseHtmlTag(text: string): ParsedTag | null {
  const match = TAG_REGEX.exec(text);
  if (!match) return null;
  const rawAttrs = match[3].trim();
  const parsedAttrs: Record<string, string> = {};
  if (rawAttrs) {
    let attrMatch;
    ATTR_REGEX.lastIndex = 0;
    while ((attrMatch = ATTR_REGEX.exec(rawAttrs)) !== null) {
      parsedAttrs[attrMatch[1]] =
        attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
    }
  }
  return {
    tagName: match[2],
    isClosing: match[1] === "/",
    attributes: rawAttrs,
    parsedAttrs,
    isSelfClosing:
      match[4] === "/" || VOID_ELEMENTS.has(match[2].toLowerCase()),
  };
}

export function matchHtmlTagPairs(tags: TagInfo[]): {
  pairs: MatchedPair[];
  voidElements: TagInfo[];
} {
  const pairs: MatchedPair[] = [];
  const voidElements: TagInfo[] = [];
  const stack: TagInfo[] = [];

  for (const tag of tags) {
    if (tag.isSelfClosing) {
      voidElements.push(tag);
      continue;
    }
    if (tag.isClosing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag.tagName.toLowerCase()) {
          pairs.push({ open: stack[i], close: tag });
          stack.splice(i, 1);
          break;
        }
      }
    } else {
      stack.push(tag);
    }
  }

  return { pairs, voidElements };
}

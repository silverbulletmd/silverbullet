import type {
  BlockContext,
  BlockParser,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";

// CommonMark spec §4.6 — the same block-level element names that
// the built-in lezer HTMLBlock parser recognises (type 6).
const blockTagRe =
  /^\s*<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i;

// Type 1: <script>, <pre>, <style> — terminates on matching close tag
const scriptPreStyleRe = /^<(?:script|pre|style)(?:\s|>|$)/i;
const scriptPreStyleEndRe = /<\/(?:script|pre|style)>/i;

// Type 2: <!-- comment -->
const commentStartRe = /^\s*<!--/;
const commentEndRe = /-->/;

// Type 3: <?processing instruction?>
const processingStartRe = /^\s*<\?/;
const processingEndRe = /\?>/;

// Type 4: <!DOCTYPE ...>
const declarationStartRe = /^\s*<![A-Z]/;
const declarationEndRe = />/;

// Type 5: <![CDATA[ ... ]]>
const cdataStartRe = /^\s*<!\[CDATA\[/;
const cdataEndRe = /\]\]>/;

// Type 6 & 7: block-level elements — terminate on empty line
const emptyLineRe = /^[ \t]*$/;

// Matches an opening tag: <tagName ...>  (not self-closing)
const openTagRe = /^<([a-zA-Z][\w-]*)((?:\s+[^>]*?)?)>/;
// Matches a self-closing tag: <tagName ... />
const selfCloseTagRe = /^<([a-zA-Z][\w-]*)((?:\s+[^>]*?)?)\s*\/>/;
// Matches a closing tag: </tagName>
const closeTagRe = /^<\/([a-zA-Z][\w-]*)>/;

/**
 * Consume lines for a "raw" HTML block (comments, CDATA, script/pre/style,
 * processing instructions, declarations) and emit a single flat node.
 * This mirrors the built-in HTMLBlock behaviour for these types.
 */
function parseRawHtmlBlock(
  cx: BlockContext,
  line: Line,
  endPattern: RegExp,
  nodeType: string,
): true {
  const from = cx.lineStart + line.pos;
  while (!endPattern.test(line.text) && cx.nextLine()) {
    // keep consuming lines
  }
  cx.nextLine();
  const to = cx.prevLineEnd();
  cx.addElement(cx.elt(nodeType, from, to));
  return true;
}

/**
 * Parse a structured HTML block (type 6/7) into tag + inline-content nodes.
 */
function parseStructuredHtmlBlock(
  cx: BlockContext,
  line: Line,
): true {
  const startPos = cx.lineStart + line.pos;
  const lineText = line.text.slice(line.pos);

  // Collect the full block text across lines
  let fullText = lineText;
  while (cx.nextLine()) {
    if (emptyLineRe.test(line.text)) break;
    fullText += `\n${line.text}`;
  }

  // Tokenise into tags and text segments, build child elements
  const children: ReturnType<typeof cx.elt>[] = [];
  let pos = 0;
  const absBase = startPos;

  while (pos < fullText.length) {
    if (fullText[pos] === "<") {
      // Try self-closing tag first
      let m = selfCloseTagRe.exec(fullText.slice(pos));
      if (m) {
        children.push(
          cx.elt(
            "HTMLSelfClosingTag",
            absBase + pos,
            absBase + pos + m[0].length,
          ),
        );
        pos += m[0].length;
        continue;
      }

      // Try closing tag
      m = closeTagRe.exec(fullText.slice(pos));
      if (m) {
        children.push(
          cx.elt("HTMLCloseTag", absBase + pos, absBase + pos + m[0].length),
        );
        pos += m[0].length;
        continue;
      }

      // Try opening tag
      m = openTagRe.exec(fullText.slice(pos));
      if (m) {
        children.push(
          cx.elt("HTMLOpenTag", absBase + pos, absBase + pos + m[0].length),
        );
        pos += m[0].length;
        continue;
      }

      // Unrecognised tag-like content: advance past '<'
      pos++;
      continue;
    }

    // Text segment: collect until the next '<' or end
    const textStart = pos;
    while (pos < fullText.length && fullText[pos] !== "<") {
      pos++;
    }

    const textContent = fullText.slice(textStart, pos);
    // Skip pure-whitespace segments
    if (/^\s*$/.test(textContent)) continue;

    // Parse as inline markdown
    const inlineElements = cx.parser.parseInline(
      textContent,
      absBase + textStart,
    );
    for (const el of inlineElements) {
      children.push(el);
    }
  }

  const endPos = absBase + fullText.length;
  cx.addElement(cx.elt("HTMLBlock", startPos, endPos, children));
  return true;
}

/**
 * Custom block parser that replaces the built-in HTMLBlock.
 *
 * For comments, CDATA, script/pre/style, and processing instructions it
 * emits flat nodes (CommentBlock, ProcessingInstructionBlock, HTMLBlock)
 * just like the built-in parser.
 *
 * For regular block-level HTML (type 6/7) it produces a structured tree
 * with HTMLOpenTag / HTMLCloseTag / HTMLSelfClosingTag children and
 * inline markdown content parsed between them.
 */
const htmlBlockParser: BlockParser = {
  name: "HTMLBlock",
  parse(cx: BlockContext, line: Line) {
    if (line.next !== 60 /* '<' */) return false;

    const lineText = line.text.slice(line.pos);

    // Type 1: <script>, <pre>, <style>
    if (scriptPreStyleRe.test(lineText)) {
      return parseRawHtmlBlock(cx, line, scriptPreStyleEndRe, "HTMLBlock");
    }

    // Type 2: <!-- comment -->
    if (commentStartRe.test(lineText)) {
      return parseRawHtmlBlock(cx, line, commentEndRe, "CommentBlock");
    }

    // Type 3: <?processing instruction?>
    if (processingStartRe.test(lineText)) {
      return parseRawHtmlBlock(
        cx,
        line,
        processingEndRe,
        "ProcessingInstructionBlock",
      );
    }

    // Type 4: <!DOCTYPE ...>
    if (declarationStartRe.test(lineText)) {
      return parseRawHtmlBlock(cx, line, declarationEndRe, "HTMLBlock");
    }

    // Type 5: <![CDATA[ ... ]]>
    if (cdataStartRe.test(lineText)) {
      return parseRawHtmlBlock(cx, line, cdataEndRe, "HTMLBlock");
    }

    // Type 6: block-level elements
    if (blockTagRe.test(lineText)) {
      return parseStructuredHtmlBlock(cx, line);
    }

    // Not an HTML block we handle
    return false;
  },
  before: "HTMLBlock",
};

export const HTMLBlockParsing: MarkdownConfig = {
  defineNodes: [
    { name: "HTMLBlock", block: true },
    { name: "HTMLOpenTag" },
    { name: "HTMLCloseTag" },
    { name: "HTMLSelfClosingTag" },
    { name: "CommentBlock", block: true },
    { name: "ProcessingInstructionBlock", block: true },
  ],
  parseBlock: [htmlBlockParser],
};

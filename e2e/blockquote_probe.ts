/**
 * Per-line classes, background, gutter geometry and the x of the first
 * non-blank character. All x values are relative to `.cm-content`'s box, which
 * is itself inset by that element's horizontal padding.
 */
export async function lineProbe(page: any) {
  return await page.evaluate(() => {
    const content = document.querySelector(".cm-content")!;
    const base = content.getBoundingClientRect().left;
    const firstCharX = (line: Element) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeValue!.trim()) {
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, 1);
          const box = range.getBoundingClientRect();
          if (box.width || box.height) return Math.round(box.left - base);
        }
      }
      return null;
    };
    return [...content.children].map((line) => {
      const style = getComputedStyle(line);
      const left = Math.round(line.getBoundingClientRect().left - base);
      return {
        classes: [...line.classList],
        background: style.backgroundColor,
        borderLeft: Number.parseFloat(style.borderLeftWidth),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        backgroundSize: style.backgroundSize,
        /** Where the line's own gutter ends — no text may start left of it. */
        gutterEnd: Math.round(left + Number.parseFloat(style.borderLeftWidth)),
        x: firstCharX(line),
        text: (line as HTMLElement).innerText.replace(/\n/g, "").slice(0, 40),
      };
    });
  });
}

/** x of the first occurrence of `word` in the editor, for shift comparisons. */
export async function wordX(page: any, word: string) {
  return await page.evaluate((word: string) => {
    const content = document.querySelector(".cm-content")!;
    const base = content.getBoundingClientRect().left;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const at = node.nodeValue!.indexOf(word);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const box = range.getBoundingClientRect();
      if (box.width || box.height) return Math.round(box.left - base);
    }
    return null;
  }, word);
}

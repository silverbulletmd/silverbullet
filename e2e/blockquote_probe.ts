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

/**
 * x of the first occurrence of `word` in the editor, for shift comparisons.
 */
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
      range.setEnd(node, at + 1);
      const box = range.getBoundingClientRect();
      if (box.width || box.height) return Math.round(box.left - base);
    }
    return null;
  }, word);
}

/**
 * Device-pixel rows where a quote's bar is *not* painted, between the top of
 * the line holding `from` and the bottom of the line holding `to`. Both must
 * be quoted at the same depth, so an unbroken bar down the whole span is the
 * only correct answer and the returned array should be empty. Row numbers are
 * device pixels counted from the top of `from`'s line.
 *
 * Measured from real pixels rather than from computed style: the bar is a
 * background image, so what it covers is the product of `background-origin`,
 * `-position` and `-size` together, and asserting on any one of those would
 * restate the implementation instead of checking what is drawn. The viewport
 * screenshot is decoded back *inside* the page — a canvas reads a data URL
 * without tainting — so the comparison is per-pixel on all three engines.
 *
 * A row counts as barred when a pixel in the bar's own column differs from the
 * background *the two lines are known to share*, which is read from the DOM and
 * then confirmed against a blank pixel: a reference sampled off a glyph would
 * make every row "differ" and the whole probe pass unconditionally, so every
 * step that could pick the wrong reference throws instead of returning.
 *
 * Two limits, both at the resolution of a single device pixel:
 *
 * * The first and last device row of the span are not sampled — a line box can
 *   begin or end part-way through a device pixel it shares with its neighbour,
 *   so that row is evidence of nothing. A gap exactly one device row wide, at
 *   the very top or the very bottom of the span, would go unseen.
 * * Sampling steps one device row, so a gap thinner than a device pixel is
 *   invisible. On webkit that is half a CSS pixel (`deviceScaleFactor: 2`),
 *   on chromium and firefox a whole one.
 */
export async function barGapRows(
  page: any,
  from: string,
  to: string,
): Promise<number[]> {
  const span = await page.evaluate(
    ({ from, to }: { from: string; to: string }) => {
      const lines = [
        ...document.querySelectorAll(".cm-content > .cm-line"),
      ] as HTMLElement[];
      const first = lines.find((l) => l.innerText.includes(from));
      const last = lines.find((l) => l.innerText.includes(to));
      if (!first || !last) throw new Error(`no line for "${from}"/"${to}"`);
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      if (a.top < 0 || b.bottom > globalThis.innerHeight) {
        throw new Error("the lines measured are not fully in the viewport");
      }
      // What is painted behind the bar. Every layer from the line up to the
      // first opaque one, composited: a quote line tints itself with a
      // translucent wash, so the topmost colour that is merely *not*
      // transparent is not what a pixel there ends up being.
      const layer = (el: Element) => {
        const parts = /^rgba?\(([^)]+)\)$/
          .exec(getComputedStyle(el).backgroundColor)?.[1]
          .split(",")
          .map((v) => Number.parseFloat(v));
        return !parts || parts[3] === 0
          ? null
          : [parts[0], parts[1], parts[2], parts[3] ?? 1];
      };
      const backdrop = (el: Element | null) => {
        const stack: number[][] = [];
        for (; el; el = el.parentElement) {
          const color = layer(el);
          if (!color) continue;
          stack.push(color);
          if (color[3] === 1) break;
        }
        if (!stack.length || stack[stack.length - 1][3] !== 1) return null;
        let color = stack.pop()!;
        while (stack.length) {
          const over = stack.pop()!;
          color = [0, 1, 2].map(
            (i) => color[i] * (1 - over[3]) + over[i] * over[3],
          );
        }
        return [0, 1, 2].map((i) => Math.round(color[i]));
      };
      const behind = backdrop(last);
      if (!behind) throw new Error("nothing paints a background behind a line");
      if (String(backdrop(first)) !== String(behind)) {
        throw new Error(
          "the two lines have different backgrounds, so one reference " +
            "colour cannot tell paint from gap on both",
        );
      }
      // A point on the reference line past everything it renders, so a pixel
      // there is the backdrop and nothing else. Taken from the text's own
      // extent rather than from the line box, which says nothing about how far
      // the text reaches.
      const text = document.createRange();
      text.selectNodeContents(last);
      const textRight = text.getBoundingClientRect().right;
      const blankX = (textRight + b.right) / 2;
      if (blankX < textRight + 4) {
        throw new Error("the reference line leaves no blank margin to sample");
      }
      return {
        top: a.top,
        bottom: b.bottom,
        left: a.left,
        behind,
        blankX,
        // The band the line paints its bars in: the bar itself is at the start
        // of it, so nothing outside it can be mistaken for one.
        band: Number.parseFloat(getComputedStyle(last).backgroundSize),
        // A row through the middle of the last line: it carries no vertical
        // padding of its own, so its bar is the reference the rest is held to.
        probeY: (b.top + b.bottom) / 2,
      };
    },
    { from, to },
  );
  const shot = (await page.screenshot()).toString("base64");
  return await page.evaluate(
    async ({ shot, span }: { shot: string; span: any }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const scale = img.width / globalThis.innerWidth;
      const dp = 1 / scale;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      // A coordinate inside pixel row/column n is anywhere in [n, n+1), so the
      // pixel a coordinate falls in is its floor — rounding would sample the
      // *next* row for every coordinate past its half, and step right over a
      // two-pixel gap probed at its middle.
      const at = (x: number, y: number) => {
        const d = ctx.getImageData(
          Math.floor(x * scale),
          Math.floor(y * scale),
          1,
          1,
        ).data;
        return [d[0], d[1], d[2]];
      };
      const differs = (p: number[], q: number[]) =>
        Math.max(...[0, 1, 2].map((i) => Math.abs(p[i] - q[i]))) > 20;
      // The blank pixel has to *be* the backdrop the DOM says it is. If it is
      // not, the screenshot is not the frame these coordinates were measured
      // in — or the point is not blank after all — and every later comparison
      // would be against a colour that means nothing.
      const bg = at(span.blankX, span.probeY);
      if (differs(bg, span.behind)) {
        throw new Error(
          `the background reference sampled ${bg} where the DOM says ` +
            `${span.behind}: it is not a blank pixel`,
        );
      }
      // The bar's column, found on the reference row rather than assumed from
      // the style that draws it, and only within the band the bars live in.
      let barX: number | null = null;
      for (let x = span.left; x < span.left + span.band; x += dp) {
        if (differs(at(x, span.probeY), bg)) {
          barX = x;
          break;
        }
      }
      if (barX === null) throw new Error("no bar painted on the reference row");
      const gaps: number[] = [];
      for (let y = span.top + dp * 1.5; y < span.bottom - dp; y += dp) {
        if (![0, 1].some((dx) => differs(at(barX! + dx, y), bg))) {
          gaps.push(Math.floor((y - span.top) / dp));
        }
      }
      return gaps;
    },
    { shot, span },
  );
}

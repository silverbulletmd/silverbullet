import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

test.describe("wiki links inside inline formatting", () => {
  test.use({
    spaceFiles: {
      "Styled.md": [
        "Plain [[Target]]",
        "",
        "**Bold [[Target]]**",
        "",
        "_Italic [[Target]]_",
        "",
        "~~Struck [[Target]]~~",
        "",
        "Cursor parks here.",
        "",
      ].join("\n"),
      "Target.md": "# Target\n",
    },
  });

  test("a wiki link follows the bold, italic and strikethrough around it", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Styled");
    await page.locator("#sb-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");

    const style = (label: string) =>
      page
        .locator(".cm-line", { hasText: label })
        .locator(".sb-wiki-link")
        .evaluate((el) => {
          const { fontWeight, fontStyle, textDecorationLine } =
            getComputedStyle(el);
          return {
            fontWeight: Number(fontWeight),
            fontStyle,
            textDecorationLine,
          };
        });

    const plain = await style("Plain");
    const bold = await style("Bold");
    const italic = await style("Italic");
    const struck = await style("Struck");

    expect(bold.fontWeight).toBeGreaterThan(plain.fontWeight);
    expect(italic.fontStyle).toBe("italic");
    expect(plain.fontStyle).toBe("normal");
    expect(plain.textDecorationLine).not.toContain("line-through");
    expect(struck.textDecorationLine).toContain("line-through");
  });
});

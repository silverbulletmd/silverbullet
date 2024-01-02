import { CodeWidgetContent } from "$sb/types.ts";
import { editor, markdown } from "$sb/syscalls.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { jsonToMDTable } from "../template/util.ts";

export async function renderFrontmatter(): Promise<CodeWidgetContent | null> {
  const text = await editor.getText();
  const parsedMd = await markdown.parseMarkdown(text);
  const frontmatter: any = await extractFrontmatter(parsedMd);
  console.log("Frontmatter", frontmatter);
  const tags = frontmatter.tags;
  delete frontmatter.tags;
  const objectEntries = Object.entries(frontmatter);
  let summaryText = "";

  if (objectEntries.length > 0) {
    summaryText += jsonToMDTable(
      objectEntries.map(([key, value]) => ({ Attribute: key, Value: value })),
    );
  }

  if (tags.length > 0) {
    summaryText += (summaryText ? "\n\n" : "") +
      tags.map((tag: string) => `#${tag}`).join(" ");
  }
  return {
    markdown: summaryText,
    buttons: [
      {
        description: "Edit",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
        invokeFunction: "index.editFrontmatter",
      },
    ],
  };
}

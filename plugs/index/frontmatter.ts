import { CodeWidgetContent } from "$sb/types.ts";
import { editor, markdown, space } from "$sb/syscalls.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { queryObjects } from "./api.ts";
import { TemplateObject } from "../template/types.ts";
import { renderTemplate } from "../template/plug_api.ts";
import { loadPageObject } from "../template/template.ts";

export async function renderFrontmatter(): Promise<CodeWidgetContent | null> {
  const text = await editor.getText();
  const pageMeta = await loadPageObject(await editor.getCurrentPage());
  const parsedMd = await markdown.parseMarkdown(text);
  const frontmatter = await extractFrontmatter(parsedMd);
  const tags = [...frontmatter.tags];
  tags.push("page");

  const allFrontMatterTemplates = await queryObjects<TemplateObject>(
    "template",
    {
      // where type = frontmatter and forTags != null
      filter: ["and", ["=", ["attr", "type"], ["string", "frontmatter"]], [
        "!=",
        ["attr", "forTags"],
        ["null"],
      ]],
    },
  );
  allFrontMatterTemplates.sort((a, b) => {
    // order based on the length of the forTags array, more tags = more specific
    return b.forTags!.length - a.forTags!.length;
  });
  for (const template of allFrontMatterTemplates) {
    if (
      template.forTags!.every((tag: string) => tags.includes(tag))
    ) {
      // Match! We're happy
      const templateText = await space.readPage(template.ref);
      const summaryText = await renderTemplate(
        templateText,
        pageMeta,
        frontmatter,
      );
      // console.log("Rendered", summaryText);
      return {
        markdown: summaryText.text,
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
  }
  console.warn(
    "Could not find matching frontmatter template, this shouldn't happen",
  );
  return null;
}

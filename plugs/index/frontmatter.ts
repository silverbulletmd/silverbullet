import { CodeWidgetContent } from "$sb/types.ts";
import { editor, language, markdown, space } from "$sb/syscalls.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { queryObjects } from "./api.ts";
import { TemplateObject } from "../template/types.ts";
import { renderTemplate } from "../template/plug_api.ts";
import { loadPageObject } from "../template/template.ts";
import { expressionToKvQueryExpression } from "$sb/lib/parse-query.ts";
import { evalQueryExpression } from "$sb/lib/query.ts";
import { parseTreeToAST } from "$sb/lib/tree.ts";

// Somewhat decent looking default template
const fallbackTemplate = `{{#each .}}
{{#ifEq @key "tags"}}{{else}}**{{@key}}**: {{.}}
{{/ifEq}}
{{/each}}
{{#if tags}}_Tagged with_ {{#each tags}}#{{.}} {{/each}}{{/if}}`;

export async function renderFrontmatterWidget(): Promise<
  CodeWidgetContent | null
> {
  const text = await editor.getText();
  const pageMeta = await loadPageObject(await editor.getCurrentPage());
  const parsedMd = await markdown.parseMarkdown(text);
  const frontmatter = await extractFrontmatter(parsedMd);

  const allFrontMatterTemplates = await queryObjects<TemplateObject>(
    "template",
    {
      filter: ["=", ["attr", "type"], ["string", "frontmatter"]],
      orderBy: [{ expr: ["attr", "priority"], desc: false }],
    },
  );
  let templateText = fallbackTemplate;
  // Strategy: walk through all matching templates, evaluate the selector, and pick the first one that matches
  for (const template of allFrontMatterTemplates) {
    const exprAST = parseTreeToAST(
      await language.parseLanguage("expression", template.selector!),
    );
    const parsedExpression = expressionToKvQueryExpression(exprAST[1]);
    if (evalQueryExpression(parsedExpression, pageMeta)) {
      // Match! We're happy
      templateText = await space.readPage(template.ref);
      break;
    }
  }
  const summaryText = await renderTemplate(
    templateText,
    pageMeta,
    frontmatter,
  );
  // console.log("Rendered", summaryText);
  return {
    markdown: summaryText.text,
    banner: "frontmatter",
    buttons: [
      {
        description: "Reload",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
        invokeFunction: "index.refreshWidgets",
      },
      {
        description: "Edit",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
        invokeFunction: "index.editFrontmatter",
      },
      {
        description: "",
        svg: "",
        widgetTarget: true,
        invokeFunction: "index.editFrontmatter",
      },
    ],
  };
}

export async function editFrontmatter() {
  // 4 = after the frontmatter (--- + newline)
  await editor.moveCursor(4, true);
}

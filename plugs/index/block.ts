import {
  codeWidget,
  editor,
  language,
  markdown,
  space,
} from "$sb/silverbullet-syscall/mod.ts";
import { parseTreeToAST, renderToText } from "$sb/lib/tree.ts";
import { CodeWidgetContent } from "$sb/types.ts";
import { loadPageObject } from "../template/template.ts";
import { queryObjects } from "./api.ts";
import { SideBlock, TemplateObject } from "../template/types.ts";
import { expressionToKvQueryExpression } from "$sb/lib/parse-query.ts";
import { evalQueryExpression } from "$sb/lib/query.ts";
import { renderTemplate } from "../template/plug_api.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { rewritePageRefs } from "$sb/lib/resolve.ts";

export async function refreshWidgets() {
  await codeWidget.refreshAll();
}

export async function renderTemplateWidgets(side: "top" | "bottom"): Promise<
  CodeWidgetContent | null
> {
  const text = await editor.getText();
  let pageMeta = await loadPageObject(await editor.getCurrentPage());
  const parsedMd = await markdown.parseMarkdown(text);
  const frontmatter = await extractFrontmatter(parsedMd);

  pageMeta = { ...pageMeta, ...frontmatter };

  const blockTemplates = await queryObjects<TemplateObject>(
    "template",
    {
      // where hooks.topBlock and hooks.topBlock.enabled != false
      filter: ["and", ["attr", ["attr", "hooks"], `${side}Block`], [
        "!=",
        ["attr", ["attr", ["attr", "hooks"], `${side}Block`], "enabled"],
        ["boolean", false],
      ]],
      orderBy: [{
        // order by hooks.topBlock.priority asc
        expr: ["attr", ["attr", ["attr", "hooks"], `${side}Block`], "priority"],
        desc: false,
      }],
    },
  );
  // console.log(`Found the following ${side} templates`, blockTemplates);
  const templateBits: string[] = [];
  // Strategy: walk through all matching templates, evaluate the 'where' expression, and pick the first one that matches
  for (const template of blockTemplates) {
    if (!template.hooks) {
      console.warn(
        "No hooks specified for template",
        template.ref,
        "this should never happen",
      );
      continue;
    }
    const blockDef: SideBlock = template.hooks[`${side}Block`]!;
    if (!blockDef.where) {
      console.warn(
        "Skipping template",
        template.ref,
        "because it has no 'where' expression",
      );
      continue;
    }
    const exprAST = parseTreeToAST(
      await language.parseLanguage("expression", blockDef.where!),
    );
    const parsedExpression = expressionToKvQueryExpression(exprAST[1]);
    if (evalQueryExpression(parsedExpression, pageMeta)) {
      // Match! We're happy
      const templateText = await space.readPage(template.ref);
      let renderedTemplate = (await renderTemplate(
        templateText,
        pageMeta,
        frontmatter,
      )).text;

      const parsedMarkdown = await markdown.parseMarkdown(renderedTemplate);
      rewritePageRefs(parsedMarkdown, template.ref);
      renderedTemplate = renderToText(parsedMarkdown);

      // console.log("Rendering template", template.ref, renderedTemplate);
      templateBits.push(renderedTemplate.trim());
    }
  }
  const summaryText = templateBits.join("\n");
  return {
    markdown: summaryText,
    buttons: [
      {
        description: "Reload",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
        invokeFunction: "index.refreshWidgets",
      },
    ],
  };
}

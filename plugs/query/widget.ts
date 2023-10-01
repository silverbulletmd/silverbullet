import { WidgetContent } from "$sb/app_event.ts";
import {
  asset,
  editor,
  events,
  language,
  markdown,
  space,
} from "$sb/syscalls.ts";
import { parseTreeToAST } from "$sb/lib/tree.ts";
import { astToKvQuery } from "$sb/lib/parse-query.ts";
import { jsonToMDTable, renderTemplate } from "../directive/util.ts";
import { renderMarkdownToHtml } from "../markdown/markdown_render.ts";

export async function widget(bodyText: string): Promise<WidgetContent> {
  const pageMeta = await space.getPageMeta(await editor.getCurrentPage());
  const css = await asset.readAsset("assets/style.css");
  const js = await asset.readAsset("assets/script.js");
  const queryAST = parseTreeToAST(
    await language.parseLanguage("query", bodyText),
  );
  const parsedQuery = astToKvQuery(
    queryAST[1],
  );
  // console.log("actual query", parsedQuery);
  const eventName = `query:${parsedQuery.querySource}`;

  let resultMd = "";

  // console.log("Parsed query", parsedQuery);
  // Let's dispatch an event and see what happens
  const results = await events.dispatchEvent(
    eventName,
    { query: parsedQuery, pageName: pageMeta.name },
    30 * 1000,
  );
  if (results.length === 0) {
    // This means there was no handler for the event which means it's unsupported
    return {
      html: `**Error:** Unsupported query source '${parsedQuery.querySource}'`,
    };
  } else {
    // console.log("Parsed query", parsedQuery);
    const allResults = results.flat();
    if (parsedQuery.render) {
      const rendered = await renderTemplate(
        pageMeta,
        parsedQuery.render,
        allResults,
      );
      resultMd = rendered.trim();
    } else {
      if (allResults.length === 0) {
        resultMd = "No results";
      } else {
        resultMd = jsonToMDTable(allResults);
      }
    }
  }

  const mdTree = await markdown.parseMarkdown(resultMd);
  const html = renderMarkdownToHtml(mdTree, {
    smartHardBreak: true,
    translateUrls: (url) => {
      // if (!url.includes("://")) {
      //   url = resolvePath(currentPage, decodeURI(url), true);
      // }
      return url;
    },
  });
  return {
    html: `
       <style>${css}</style>
       <link rel="stylesheet" href="/.client/main.css" />
       <div id="sb-main"><div id="sb-editor"><div class="cm-editor">
       <div id="button-bar">
        <button id="edit-button">✎</button>
       </div>
       
       ${parsedQuery.render ? "" : `<div class="sb-table-widget">`}
  ${html}
  ${parsedQuery.render ? "" : `</div>`}
  </div></div></div>
  `,
    script: js,
  };
}

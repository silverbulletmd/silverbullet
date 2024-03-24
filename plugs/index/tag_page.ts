import { FileMeta } from "../../plug-api/types.ts";
import { markdown, system } from "$sb/syscalls.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { tagPrefix } from "./constants.ts";

export async function readFileTag(
  name: string,
): Promise<{ data: Uint8Array; meta: FileMeta }> {
  const tagName = name.substring(
    tagPrefix.length,
    name.length - ".md".length,
  );
  const text = `All objects in your space tagged with #${tagName}:
\`\`\`template
template: |
    {{#if .}}
    # Pages
    {{#each .}}
    * [[{{name}}]]
    {{/each}}
    {{/if}}
query: |
    page where tags = "${tagName}"
\`\`\`
\`\`\`template
template: |
    {{#if .}}
    # Tasks
    {{#each .}}
    * [{{state}}] [[{{ref}}]] {{name}}
    {{/each}}
    {{/if}}
query: |
    task where tags = "${tagName}"
\`\`\`
\`\`\`template
template: |
    {{#if .}}
    # Items
    {{#each .}}
    * [[{{ref}}]] {{name}}
    {{/each}}
    {{/if}}
query: |
    item where tags = "${tagName}"
\`\`\`
\`\`\`template
template: |
    {{#if .}}
    # Paragraphs
    {{#each .}}
    * [[{{ref}}]] {{text}}
    {{/each}}
    {{/if}}
query: |
    paragraph where tags = "${tagName}"
\`\`\`
`;

  let tree = await markdown.parseMarkdown(text);
  tree = await system.invokeFunction("markdown.expandCodeWidgets", tree, name);

  return {
    data: new TextEncoder().encode(renderToText(tree)),
    meta: {
      name,
      contentType: "text/markdown",
      size: text.length,
      created: 0,
      lastModified: 0,
      perm: "ro",
    },
  };
}

export function writeFileTag(
  name: string,
): FileMeta {
  // Never actually writing this
  return getFileMetaTag(name);
}

export function getFileMetaTag(name: string): FileMeta {
  return {
    name,
    contentType: "text/markdown",
    size: -1,
    created: 0,
    lastModified: 0,
    perm: "ro",
  };
}

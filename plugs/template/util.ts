const frontMatterRegex = /^---\n(([^\n]|\n)*?)---\n/;
const yamlKvRegex = /^\s*(\w+):\s*(.*)/;
const yamlListItemRegex = /^\s*-\s+(.+)/;

/**
 * Quick and dirty way to check if a page is a template or not
 * @param pageText
 * @returns
 */
export function isTemplate(pageText: string): boolean {
  const frontmatter = frontMatterRegex.exec(pageText);
  // Poor man's YAML frontmatter parsing
  if (frontmatter) {
    pageText = pageText.slice(frontmatter[0].length);
    const frontmatterText = frontmatter[1];
    const lines = frontmatterText.split("\n");
    let inTagsSection = false;
    for (const line of lines) {
      const yamlKv = yamlKvRegex.exec(line);
      if (yamlKv) {
        const [key, value] = yamlKv.slice(1);
        // Looking for a 'tags' key
        if (key === "tags") {
          inTagsSection = true;
          // 'template' there? Yay!
          if (value.split(/,\s*/).includes("template")) {
            return true;
          }
        } else {
          inTagsSection = false;
        }
      }
      const yamlListem = yamlListItemRegex.exec(line);
      if (yamlListem && inTagsSection) {
        // List item is 'template'? Yay!
        if (yamlListem[1] === "template") {
          return true;
        }
      }
    }
  }
  // Or if the page text starts with a #template tag
  if (/^\s*#template(\W|$)/.test(pageText)) {
    return true;
  }
  return false;
}

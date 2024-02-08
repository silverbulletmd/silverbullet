const yamlKvRegex = /^\s*(\w+):\s*["']?([^'"]*)["']?$/;
const yamlListItemRegex = /^\s*-\s+["']?([^'"]+)["']?$/;
const frontMatterRegex = /^---\n(([^\n]|\n)*?)---\n/;

/**
 * Cheap YAML parser to determine tags (ugly, regex based but fast)
 * @param yamlText
 * @returns
 */
export function determineTags(yamlText: string): string[] {
  const lines = yamlText.split("\n");
  let inTagsSection = false;
  const tags: string[] = [];
  for (const line of lines) {
    const yamlKv = yamlKvRegex.exec(line);
    if (yamlKv) {
      const [key, value] = yamlKv.slice(1);
      // Looking for a 'tags' key
      if (key === "tags") {
        inTagsSection = true;
        // 'template' there? Yay!
        if (value) {
          tags.push(
            ...value.split(/,\s*|\s+/).map((t) => t.replace(/^#/, "")),
          );
        }
      } else {
        inTagsSection = false;
      }
    }
    const yamlListem = yamlListItemRegex.exec(line);
    if (yamlListem && inTagsSection) {
      tags.push(yamlListem[1].replace(/^#/, ""));
    }
  }
  return tags;
}

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
    const tags = determineTags(frontmatterText);
    if (tags.includes("template")) {
      return true;
    }
  }
  // Or if the page text starts with a #template tag
  if (/^\s*#template(\W|$)/.test(pageText)) {
    return true;
  }
  return false;
}

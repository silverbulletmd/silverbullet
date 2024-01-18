import type { IndexTreeEvent } from "$sb/app_event.ts";
import { system } from "$sb/syscalls.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { FrontmatterConfig } from "./types.ts";

export async function indexTemplate({ name, tree }: IndexTreeEvent) {
  // Perform template frontmatter validation before indexing
  const frontmatter = await extractFrontmatter(tree);
  try {
    // Just parse to make sure it's valid
    FrontmatterConfig.parse(frontmatter);
  } catch (e: any) {
    if (e.message.startsWith("[")) { // We got a zod error
      const zodErrors = JSON.parse(e.message);
      for (const zodError of zodErrors) {
        console.error(
          `Template frontmatter validation error in ${name}:`,
          zodError,
        );
      }
      return;
    }
  }
  // Just delegate to the index plug
  await system.invokeFunction("index.indexPage", { name, tree });
}

import { Diagnostic, linter } from "@codemirror/lint";
import type { Client } from "../client.ts";

export function plugLinter(client: Client) {
  return linter(async (): Promise<Diagnostic[]> => {
    const results = (await client.dispatchAppEvent("editor:lint", {
      name: client.currentPage!,
    })).flat();
    return results;
  });
}

import type { RestrictedAPI } from "./restricted_env.ts";
export function syntheticSpace() {
  const pages: Record<string, string> = {
    "Notes/Maple": "# Maple\nA short note.",
    "Notes/Cedar": "# Cedar\nA longer example note.",
  };
  const rows = Object.entries(pages).map(([name, text]) => ({
    name,
    size: text.length,
    tag: "page",
  }));
  let writes = 0;
  const apis: Record<string, RestrictedAPI> = {
    "space.readPage": {
      capabilities: ["space:read"],
      callback: (name: string) => pages[name],
    },
    "space.listPages": { capabilities: ["space:read"], callback: () => rows },
    "index.pages": { capabilities: ["space:read"], callback: () => rows },
    "space.writePage": {
      capabilities: ["space:write"],
      callback: (name: string, text: string) => {
        writes++;
        pages[name] = text;
      },
    },
    "net.request": {
      capabilities: ["network"],
      callback: () => {
        throw new Error("Network must never be reached");
      },
    },
    "future.api": {
      callback: () => {
        writes++;
      },
    },
  };
  return { apis, pages, rows, writes: () => writes };
}

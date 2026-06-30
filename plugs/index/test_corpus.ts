// Shared test/benchmark helpers for loading the silverbullet/docs
// markdown corpus and synthesizing PageMeta stubs.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

export type CorpusPage = {
  name: string;
  text: string;
};

export const docsDir = fileURLToPath(new URL("../../docs", import.meta.url));

export function loadMarkdownFiles(dir: string, base = ""): CorpusPage[] {
  const out: CorpusPage[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      out.push(...loadMarkdownFiles(full, rel));
    } else if (entry.endsWith(".md")) {
      out.push({
        name: rel.replace(/\.md$/, ""),
        text: readFileSync(full, "utf-8"),
      });
    }
  }
  return out;
}

export function stubPageMeta(name: string): PageMeta {
  return {
    ref: name,
    name,
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };
}

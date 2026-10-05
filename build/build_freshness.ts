import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type FreshnessCheck = {
  artifact: string;
  inputs: string[];
  rebuild: string;
};

const SKIPPED_DIRS = new Set(["node_modules", "test-results", ".git"]);

function isTestFile(name: string): boolean {
  return /\.test\.tsx?$/.test(name);
}

function newestFile(
  root: string,
): { path: string; mtimeMs: number } | undefined {
  let newest: { path: string; mtimeMs: number } | undefined;
  const visit = (path: string) => {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (!SKIPPED_DIRS.has(entry)) visit(join(path, entry));
      }
      return;
    }
    if (isTestFile(path)) return;
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { path, mtimeMs: stat.mtimeMs };
    }
  };
  visit(root);
  return newest;
}

/** One message per artifact that is missing or older than any of its inputs. */
export function staleArtifacts(checks: FreshnessCheck[]): string[] {
  const problems: string[] = [];
  for (const { artifact, inputs, rebuild } of checks) {
    const built = statSync(artifact, { throwIfNoEntry: false });
    if (!built) {
      problems.push(`${artifact} is missing; run \`${rebuild}\``);
      continue;
    }
    for (const input of inputs) {
      const newest = newestFile(input);
      if (newest && newest.mtimeMs > built.mtimeMs) {
        problems.push(
          `${artifact} is older than ${relative(process.cwd(), newest.path)}; run \`${rebuild}\``,
        );
        break;
      }
    }
  }
  return problems;
}

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stylesDir = path.dirname(fileURLToPath(import.meta.url));

/** Names of custom properties declared (`--name:` opening a declaration). */
export function declaredVariables(scss: string): Set<string> {
  return new Set(
    [...scss.matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:/g)].map((m) => m[1]),
  );
}

/** Names of custom properties read through `var()`. */
export function usedVariables(source: string): Set<string> {
  return new Set([...source.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
}

/**
 * Layout, computed and plug-local variables that are not theme variables.
 * `--sb-*` and `--gv-*` are layout/plug-local namespaces; theme variables must
 * never use them. Entries ending in `*` are prefix matches; see `isLocalVariable`.
 */
export const LOCAL_VARIABLES: ReadonlySet<string> = new Set([
  "--sb-*",
  "--editor-column",
  "--editor-base-font",
  "--blockquote-*",
  "--admonition-*",
  "--heat-*",
  "--gv-*",
]);

/**
 * Declared for users' space-style (documented in docs/Space Style.md); the
 * client itself needn't consume them.
 */
export const PUBLIC_API_VARIABLES: ReadonlySet<string> = new Set([
  "--tone-success",
  "--tone-success-soft",
  "--tone-warning",
  "--tone-warning-soft",
  "--tone-danger",
  "--tone-danger-soft",
  "--tone-info",
  "--tone-info-soft",
  "--tone-neutral",
  "--tone-neutral-soft",
  "--tone-accent",
  "--tone-accent-soft",
  // A darker accent fill for themes (the Classic library's hashtags and completion)
  "--ui-accent-strong-color",
  "--ui-accent-strong-contrast-color",
]);

export function isLocalVariable(name: string): boolean {
  for (const entry of LOCAL_VARIABLES) {
    if (
      entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : name === entry
    ) {
      return true;
    }
  }
  return false;
}

/** The theme variables the bundled stylesheets declare: theme.scss. */
export function bundledThemeVariables(): Set<string> {
  return declaredVariables(
    readFileSync(path.join(stylesDir, "theme.scss"), "utf8"),
  );
}

/** Stylesheets and TypeScript (not tests) under `dirs`, recursively, skipping node_modules. */
export function sourceFiles(
  dirs: string[],
  pattern: RegExp = /\.(scss|tsx?)$/,
): string[] {
  return dirs.flatMap((dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules"
          ? []
          : sourceFiles([full], pattern);
      }
      return pattern.test(entry.name) && !entry.name.endsWith(".test.ts")
        ? [full]
        : [];
    }),
  );
}

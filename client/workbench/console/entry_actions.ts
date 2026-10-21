import type { Action } from "../shared/action.ts";
import type { LogEntry } from "./console_log.ts";
import { isExpressionInput } from "./console_session.ts";
import { entryText } from "./log_filter.ts";

/** What a log entry's actions act through. */
export type ActionDeps = {
  copyText: (text: string) => Promise<void>;
  /** Copies a value the way a `${…}` widget's Copy as Markdown does. */
  copyValue: (value: unknown) => Promise<void>;
  rerun: (code: string) => Promise<void>;
};

export type EntryAction = Action<ActionDeps>;

const copy = (label: string, text: () => string): EntryAction => ({
  label,
  icon: "copy",
  run: (deps) => deps.copyText(text()),
});

/** What a log entry's ⋯ menu offers. */
export function entryActions(entry: LogEntry): EntryAction[] {
  switch (entry.kind) {
    case "input": {
      const code = entry.code.trim();
      return [
        ...(isExpressionInput(code)
          ? [copy("Copy as ${…}", () => `\${${code}}`)]
          : []),
        copy("Copy code", () => code),
        // Run again re-evaluates, like a widget's reload
        { label: "Run again", icon: "reload", run: (deps) => deps.rerun(code) },
      ];
    }
    case "result": {
      const [value] = entry.values;
      return entry.values.length === 1
        ? [
            {
              label: "Copy as Markdown",
              icon: "copy",
              run: (deps) => deps.copyValue(value),
            },
          ]
        : [];
    }
    case "stopped":
      return [];
    case "message":
      return entry.level === "error"
        ? [
            copy("Copy error", () =>
              entry.args
                .map((a) => (a instanceof Error ? a.message : String(a)))
                .join(" "),
            ),
          ]
        : [copy("Copy text", () => entryText(entry))];
  }
}

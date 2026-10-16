export type RuntimeLogLevel = "log" | "info" | "warn" | "error" | "debug";
export type RuntimeLogSource = "lua" | "plug" | "sw";

/** A log line from outside the main window's own console: Lua `print`, a plug worker or the service worker. */
export type RuntimeLogRecord = {
  source: RuntimeLogSource;
  level: RuntimeLogLevel;
  text: string;
  /** Narrows the source, e.g. the plug's name. */
  scope?: string;
  /** Where in Space Lua the line was logged. */
  origin?: { ref: string; from?: number };
};

const LABELS: Record<RuntimeLogSource, string> = {
  lua: "Lua",
  plug: "Plug",
  sw: "Service Worker",
};

let sink: ((r: RuntimeLogRecord) => void) | null = null;

export function setRuntimeLogSink(s: ((r: RuntimeLogRecord) => void) | null) {
  sink = s;
}

/** Hands `r` to the installed sink (the Workbench console log), or else to the console. */
export function emitRuntimeLog(r: RuntimeLogRecord): void {
  if (sink) {
    sink(r);
  } else {
    console[r.level](`[${r.scope ?? LABELS[r.source]}]`, r.text);
  }
}

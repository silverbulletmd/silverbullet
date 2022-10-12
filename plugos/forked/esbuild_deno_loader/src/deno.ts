// Lifted from https://raw.githubusercontent.com/denoland/deno_graph/89affe43c9d3d5c9165c8089687c107d53ed8fe1/lib/media_type.ts
export type MediaType =
  | "JavaScript"
  | "Mjs"
  | "Cjs"
  | "JSX"
  | "TypeScript"
  | "Mts"
  | "Cts"
  | "Dts"
  | "Dmts"
  | "Dcts"
  | "TSX"
  | "Json"
  | "Wasm"
  | "TsBuildInfo"
  | "SourceMap"
  | "Unknown";

export interface InfoOutput {
  roots: string[];
  modules: ModuleEntry[];
  redirects: Record<string, string>;
}

export interface ModuleEntry {
  specifier: string;
  size: number;
  mediaType?: MediaType;
  local?: string;
  checksum?: string;
  emit?: string;
  map?: string;
  error?: string;
}

interface DenoInfoOptions {
  importMap?: string;
}

let tempDir: null | string;

export async function info(
  specifier: URL,
  options: DenoInfoOptions,
): Promise<InfoOutput> {
  const cmd = [
    Deno.execPath(),
    "info",
    "--json",
  ];
  if (options.importMap !== undefined) {
    cmd.push("--import-map", options.importMap);
  }
  cmd.push(specifier.href);

  if (!tempDir) {
    tempDir = Deno.makeTempDirSync();
  }

  let proc;

  try {
    proc = Deno.run({
      cmd,
      stdout: "piped",
      cwd: tempDir,
    });
    const raw = await proc.output();
    const status = await proc.status();
    if (!status.success) {
      throw new Error(`Failed to call 'deno info' on '${specifier.href}'`);
    }
    const txt = new TextDecoder().decode(raw);
    return JSON.parse(txt);
  } finally {
    try {
      proc?.stdout.close();
    } catch (err) {
      if (err instanceof Deno.errors.BadResource) {
        // ignore the error
      } else {
        // deno-lint-ignore no-unsafe-finally
        throw err;
      }
    }
    proc?.close();
  }
}

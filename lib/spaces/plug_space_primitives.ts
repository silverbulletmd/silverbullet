import type { SpacePrimitives } from "./space_primitives.ts";
import type { NamespaceOperation } from "../plugos/namespace.ts";
import type { PlugNamespaceHook } from "../../web/hooks/plug_namespace.ts";
import type { FileMeta } from "../../type/index.ts";

export class PlugSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private hook: PlugNamespaceHook,
    private env?: string,
  ) {
  }

  // Used e.g. by the sync engine to see if it should sync a certain path (likely not the case when we have a plug space override)
  public isLikelyHandled(path: string): boolean {
    for (
      const { pattern } of this.hook.spaceFunctions
    ) {
      if (path.match(pattern)) {
        return true;
      }
    }
    return false;
  }

  performOperation(
    type: NamespaceOperation,
    path: string,
    ...args: any[]
  ): Promise<any> | false {
    for (
      const { operation, pattern, plug, name, env } of this.hook.spaceFunctions
    ) {
      // console.log(
      //   "Going to match agains pattern",
      //   operation,
      //   pattern,
      //   path,
      //   this.env,
      //   env,
      // );
      if (
        operation === type && path.match(pattern) &&
        // Both envs are set, and they don't match
        (!this.env || !env || env === this.env)
      ) {
        return plug.invoke(name, [path, ...args]);
      }
    }
    return false;
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const allFiles: FileMeta[] = [];
    const alreadySeenFiles = new Set<string>();
    for (const { plug, name, operation } of this.hook.spaceFunctions) {
      if (operation === "listFiles") {
        try {
          for (const pm of await plug.invoke(name, [])) {
            allFiles.push(pm);
            // console.log("Adding file from plug space", pm.name);
            alreadySeenFiles.add(pm.name);
          }
        } catch (e: any) {
          if (!e.message.includes("not available")) {
            // Don't report "not available in" environments errors
            console.error("Error listing files", e);
          }
        }
      }
    }
    const files = await this.wrapped.fetchFileList();
    for (const pm of files) {
      // We'll use the files coming from the wrapped space only as a fallback
      if (alreadySeenFiles.has(pm.name)) {
        continue;
      }
      allFiles.push(pm);
    }
    return allFiles;
  }

  async readFile(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const result: { data: Uint8Array; meta: FileMeta } | false = await this
      .performOperation(
        "readFile",
        path,
      );
    if (result) {
      return result;
    }
    return this.wrapped.readFile(path);
  }

  getFileMeta(path: string, observing?: boolean): Promise<FileMeta> {
    const result = this.performOperation("getFileMeta", path, observing);
    if (result) {
      return result;
    }
    return this.wrapped.getFileMeta(path, observing);
  }

  writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const result = this.performOperation(
      "writeFile",
      path,
      data,
      meta,
    );
    if (result) {
      return result;
    }

    return this.wrapped.writeFile(
      path,
      data,
      meta,
    );
  }

  deleteFile(path: string): Promise<void> {
    const result = this.performOperation("deleteFile", path);
    if (result) {
      return result;
    }
    return this.wrapped.deleteFile(path);
  }
}

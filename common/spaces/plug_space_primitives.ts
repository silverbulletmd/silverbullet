import { SpacePrimitives } from "$common/spaces/space_primitives.ts";
import { NamespaceOperation } from "$lib/plugos/namespace.ts";
import { FileMeta } from "../../plug-api/types.ts";
import { PlugNamespaceHook } from "../hooks/plug_namespace.ts";

export class PlugSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private hook: PlugNamespaceHook,
    private env?: string,
  ) {}

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
    for (const { plug, name, operation, env } of this.hook.spaceFunctions) {
      if (
        operation === "listFiles" && (!this.env || (env && env === this.env))
      ) {
        try {
          for (const pm of await plug.invoke(name, [])) {
            allFiles.push(pm);
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
      allFiles.push(pm);
    }
    return allFiles;
  }

  async readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const result: { data: Uint8Array; meta: FileMeta } | false = await this
      .performOperation(
        "readFile",
        name,
      );
    if (result) {
      return result;
    }
    return this.wrapped.readFile(name);
  }

  getFileMeta(name: string): Promise<FileMeta> {
    const result = this.performOperation("getFileMeta", name);
    if (result) {
      return result;
    }
    return this.wrapped.getFileMeta(name);
  }

  writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const result = this.performOperation(
      "writeFile",
      name,
      data,
      selfUpdate,
      meta,
    );
    if (result) {
      return result;
    }

    return this.wrapped.writeFile(
      name,
      data,
      selfUpdate,
      meta,
    );
  }

  deleteFile(name: string): Promise<void> {
    const result = this.performOperation("deleteFile", name);
    if (result) {
      return result;
    }
    return this.wrapped.deleteFile(name);
  }
}

import { EventHook } from "../../plugos/hooks/event.ts";
import { Plug } from "../../plugos/plug.ts";

import { FileMeta } from "../types.ts";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives.ts";

export class EventedSpacePrimitives implements SpacePrimitives {
  constructor(private wrapped: SpacePrimitives, private eventHook: EventHook) {}

  fetchFileList(): Promise<{ files: FileMeta[]; timestamp: number }> {
    return this.wrapped.fetchFileList();
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return this.wrapped.proxySyscall(plug, name, args);
  }

  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[],
  ): Promise<any> {
    return this.wrapped.invokeFunction(plug, env, name, args);
  }

  readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    return this.wrapped.readFile(name, encoding);
  }

  async writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    selfUpdate?: boolean,
    timestamp?: number,
  ): Promise<FileMeta> {
    const newMeta = await this.wrapped.writeFile(
      name,
      encoding,
      data,
      selfUpdate,
      timestamp,
    );
    // This can happen async
    if (name.endsWith(".md")) {
      const pageName = name.substring(0, name.length - 3);
      let text = "";
      switch (encoding) {
        case "string":
          text = data as string;
          break;
        case "arraybuffer":
          {
            const decoder = new TextDecoder("utf-8");
            text = decoder.decode(data as ArrayBuffer);
          }

          break;
        case "dataurl":
          throw Error("Data urls not supported in this context");
      }

      if (!name.startsWith("_trash/")) {
        // Only trigger indexing events outside of the trash
        this.eventHook
          .dispatchEvent("page:saved", pageName)
          .then(() => {
            return this.eventHook.dispatchEvent("page:index_text", {
              name: pageName,
              text,
            });
          })
          .catch((e) => {
            console.error("Error dispatching page:saved event", e);
          });
      }
    }
    return newMeta;
  }

  getFileMeta(name: string): Promise<FileMeta> {
    return this.wrapped.getFileMeta(name);
  }

  async deleteFile(name: string): Promise<void> {
    if (name.endsWith(".md")) {
      const pageName = name.substring(0, name.length - 3);
      await this.eventHook.dispatchEvent("page:deleted", pageName);
    }
    return this.wrapped.deleteFile(name);
  }
}

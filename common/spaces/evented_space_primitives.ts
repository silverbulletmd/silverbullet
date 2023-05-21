import { EventHook } from "../../plugos/hooks/event.ts";

import { FileMeta } from "../types.ts";
import type { SpacePrimitives } from "./space_primitives.ts";

export class EventedSpacePrimitives implements SpacePrimitives {
  constructor(private wrapped: SpacePrimitives, private eventHook: EventHook) {}

  fetchFileList(): Promise<FileMeta[]> {
    return this.wrapped.fetchFileList();
  }

  readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    return this.wrapped.readFile(name);
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean,
    lastModified?: number,
  ): Promise<FileMeta> {
    const newMeta = await this.wrapped.writeFile(
      name,
      data,
      selfUpdate,
      lastModified,
    );
    // This can happen async
    if (name.endsWith(".md")) {
      const pageName = name.substring(0, name.length - 3);
      let text = "";
      const decoder = new TextDecoder("utf-8");
      text = decoder.decode(data);

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
    if (name.endsWith(".plug.js")) {
      await this.eventHook.dispatchEvent("plug:changed", name);
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

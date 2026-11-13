import type { KvKey } from "@silverbulletmd/silverbullet/type/datastore";
import type { DataStore } from "../../data/datastore.ts";
import type { SysCallMapping } from "../../plugos/system.ts";

export function clientStoreSyscalls(
  ds: DataStore,
  prefix: KvKey = ["client"],
): SysCallMapping {
  return {
    "clientStore.get": {
      callback: (_ctx, key: string): Promise<any> => {
        return ds.get([...prefix, key]);
      },
      description:
        "Gets a client-specific value from the local key-value store.",
      parameters: [
        { name: "key", type: "string", description: "Key to read." },
      ],
      returns: [{ description: "Stored value, or nil when absent." }],
      examples: [
        { code: 'local sidebarWidth = clientStore.get("sidebarWidth")' },
      ],
    },
    "clientStore.set": {
      callback: (_ctx, key: string, val: any): Promise<void> => {
        return ds.set([...prefix, key], val);
      },
      description:
        "Stores a client-specific value in the local key-value store.",
      parameters: [
        { name: "key", type: "string", description: "Key to set." },
        { name: "value", description: "Value to store." },
      ],
      examples: [{ code: 'clientStore.set("sidebarWidth", 300)' }],
    },
    "clientStore.delete": {
      callback: (_ctx, key: string): Promise<void> => {
        return ds.delete([...prefix, key]);
      },
      description:
        "Deletes a client-specific value from the local key-value store.",
      parameters: [
        { name: "key", type: "string", description: "Key to delete." },
      ],
      examples: [{ code: 'clientStore.delete("sidebarWidth")' }],
    },
  };
}

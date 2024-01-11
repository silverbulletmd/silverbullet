import { shell } from "$sb/syscalls.ts";
import { KV, KvKey, KvQuery } from "$sb/types.ts";
import { SpaceServer } from "./instance.ts";

export type ShellRequest = {
  cmd: string;
  args: string[];
};

export type ShellResponse = {
  stdout: string;
  stderr: string;
  code: number;
};

export type SyscallRequest = {
  ctx: string; // Plug name requesting
  name: string;
  args: any[];
};

export type SyscallResponse = {
  result?: any;
  error?: string;
};

export async function handleRpc(
  spaceServer: SpaceServer,
  name: string,
  body: any,
): Promise<any> {
  switch (name) {
    case "shell": {
      const shellCommand: ShellRequest = body;
      const shellResponse = await spaceServer.shellBackend.handle(
        shellCommand,
      );
      return shellResponse;
    }
    case "datastore.batchGet": {
      const [keys]: [KvKey[]] = body;
      return spaceServer.ds.batchGet(keys);
    }
    case "datastore.batchSet": {
      const [entries]: [KV[]] = body;
      return spaceServer.ds.batchSet(entries);
    }
    case "datastore.batchDelete": {
      const [keys]: [KvKey[]] = body;
      return spaceServer.ds.batchDelete(keys);
    }
    case "datastore.query": {
      const [query]: [KvQuery] = body;
      return spaceServer.ds.query(query);
    }
    default:
      throw new Error(`Unknown rpc ${name}`);
  }
}

import {
  maximumDocumentSize,
  notFoundError,
} from "@silverbulletmd/silverbullet/constants";
import { isValidPath } from "@silverbulletmd/silverbullet/lib/ref";
import type { Client } from "../../client.ts";
import type { CaptureInvocationContext } from "../../capture/invocation.ts";
import type { SysCallMapping } from "../system.ts";

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export function captureSyscalls(
  context: () => CaptureInvocationContext | undefined,
  client: Client,
): SysCallMapping {
  const active = (): CaptureInvocationContext => {
    const current = context();
    if (!current) throw new Error("No active capture action");
    return current;
  };

  return {
    "capture.readFile": {
      callback: async (_ctx, handle: string): Promise<Uint8Array> =>
        new Uint8Array(await (await active().readFile(handle)).arrayBuffer()),
      description:
        "Reads a staged file belonging to the current capture action.",
      parameters: [
        {
          name: "handle",
          type: "string",
          description: "File handle from the capture.",
        },
      ],
      returns: [{ type: "byteArray", description: "File bytes." }],
    },
    "capture.saveFile": {
      callback: async (
        _ctx,
        handle: string,
        path: string,
      ): Promise<boolean> => {
        if (!isValidPath(path)) throw new Error("Invalid capture file path");
        const blob = await active().readFile(handle);
        const limit = client.config.get<number>(
          "maximumDocumentSize",
          maximumDocumentSize,
        );
        if (typeof limit !== "number" || blob.size > limit * 1024 * 1024) {
          throw new Error("Shared file is too large");
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let existing = false;
        try {
          await client.space.getDocumentMeta(path);
          existing = true;
        } catch (error) {
          if (
            !(error instanceof Error && error.message === notFoundError.message)
          )
            throw error;
        }
        if (existing) {
          const saved = await client.space.readDocument(path);
          if (!sameBytes(saved.data, bytes))
            throw new Error(`Shared file conflict: ${path}`);
          return false;
        }
        await client.space.writeDocument(path, bytes);
        const saved = await client.space.readDocument(path);
        if (!sameBytes(saved.data, bytes))
          throw new Error(`Shared file verification failed: ${path}`);
        return true;
      },
      description:
        "Saves a staged file without overwriting different bytes. Returns true when newly created and false when identical content already exists.",
      parameters: [
        {
          name: "handle",
          type: "string",
          description: "File handle from the capture.",
        },
        { name: "path", type: "string", description: "New document path." },
      ],
    },
  };
}

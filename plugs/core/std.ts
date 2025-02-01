import {
  asset,
  codeWidget,
  datastore,
  editor,
  mq,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { FileMeta } from "@silverbulletmd/silverbullet/types";
import { sleep } from "$lib/async.ts";

export async function listFiles(): Promise<FileMeta[]> {
  return await asset.listFiles("core");
}

export async function readFile(
  name: string,
): Promise<{ data: Uint8Array; meta: FileMeta }> {
  const text = await asset.readAsset("core", name, "utf8");
  return {
    data: new TextEncoder().encode(text),
    meta: await asset.getFileMeta("core", name),
  };
}

export function writeFile(): Promise<FileMeta> {
  throw new Error("Writing std files not supported");
}

export function deleteFile(): Promise<void> {
  throw new Error("Deleting std files not supported");
}

export function getFileMeta(name: string): Promise<FileMeta> {
  return asset.getFileMeta("core", name);
}

const stdLibCacheKey = ["stdLibCache"];

type StdLibCache = Record<string, number>; // page name -> last modified time

export async function init() {
  // Check if in read-only mode
  if (await system.getMode() === "ro") {
    return;
  }
  let stdLibCache: StdLibCache | undefined = await datastore.get(
    stdLibCacheKey,
  );
  if (!stdLibCache) {
    stdLibCache = {};
  }
  // Iterate over the current file listing, check if any new files have been added, removed or modified
  const newListing = await listFiles();
  let anythingChanged = false;
  // First check for files that were removed
  for (const cachedFile of Object.keys(stdLibCache)) {
    if (!newListing.find((f) => f.name === cachedFile)) {
      anythingChanged = true;
      console.log(`Clearing index for removed file ${cachedFile}`);
      await system.invokeFunction("index.clearDSIndex", cachedFile);
      delete stdLibCache[cachedFile];
    }
  }

  // Then check for new/modified files
  for (const file of newListing) {
    const lastModified = file.lastModified;

    // Check if file is new or modified compared to cache
    if (!stdLibCache[file.name] || stdLibCache[file.name] !== lastModified) {
      anythingChanged = true;
      await system.invokeFunction("index.clearDSIndex", file.name);
      await mq.send("indexQueue", file.name);
      stdLibCache[file.name] = lastModified;
    }
  }

  // Save updated cache
  await datastore.set(stdLibCacheKey, stdLibCache);

  // If anything changed and we're in sync mode, we can auto trigger reloading of the system after the index queue is processed
  if (anythingChanged && !await system.getEnv()) {
    // We're in sync mode
    console.log("Waiting for index queue to be processed");
    let queueProcessed = false;
    while (!queueProcessed) {
      const stats = await mq.getQueueStats("indexQueue");
      if (stats.queued === 0 && stats.processing === 0) {
        queueProcessed = true;
      }
      await sleep(100);
    }
    console.log("Index queue processed, reloading system");
    await editor.reloadConfigAndCommands();
    await codeWidget.refreshAll();
  }
}

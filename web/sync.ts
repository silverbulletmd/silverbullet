import { HttpSpacePrimitives } from "../common/spaces/http_space_primitives.ts";
import type { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { SpaceSync, SyncStatusItem } from "../common/spaces/sync.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { SysCallMapping } from "../plugos/system.ts";

export class SyncEngine {
  snapshot?: Map<string, SyncStatusItem>;
  remoteSpace?: HttpSpacePrimitives;
  spaceSync?: SpaceSync;

  constructor(
    private localSpacePrimitives: SpacePrimitives,
    private storeCalls: SysCallMapping,
    eventHook: EventHook,
  ) {
    eventHook.addLocalListener("editor:pageLoaded", async (name) => {
      await this.syncFile(`${name}.md`);
    });

    eventHook.addLocalListener("page:saved", async (name) => {
      await this.syncFile(`${name}.md`);
    });
  }

  async init() {
    // TODO: Auth
    this.remoteSpace = new HttpSpacePrimitives("");

    const fakeCtx: any = {};
    const snapshot =
      (await this.storeCalls["store.get"](fakeCtx, "syncSnapshot")) ||
      {};
    this.snapshot = new Map<string, SyncStatusItem>(
      Object.entries(snapshot),
    );

    this.spaceSync = new SpaceSync(
      this.localSpacePrimitives,
      this.remoteSpace,
      this.snapshot!,
      {},
    );
  }

  async syncSpace() {
    try {
      await this.spaceSync!.syncFiles(
        SpaceSync.primaryConflictResolver,
      );
    } catch (e: any) {
      console.error("Sync error", e);
    }
    await this.saveSnapshot();

    console.log("Sync done");
  }

  async syncFile(name: string) {
    console.log("Syncing file", name);
    try {
      const localHash =
        (await this.localSpacePrimitives.getFileMeta(name)).lastModified;
      let remoteHash: number | undefined = undefined;
      try {
        remoteHash = (await this.remoteSpace!.getFileMeta(name)).lastModified;
      } catch (e: any) {
        if (e.message.includes("File not found")) {
          // File doesn't exist remotely, that's ok
        } else {
          throw e;
        }
      }

      await this.spaceSync!.syncFile(
        name,
        localHash,
        remoteHash,
        SpaceSync.primaryConflictResolver,
      );
    } catch (e: any) {
      console.error("Sync error", e);
    }
    await this.saveSnapshot();
    console.log("Sync done");
  }

  async saveSnapshot() {
    const fakeCtx: any = {};
    await this.storeCalls["store.set"](
      fakeCtx,
      "syncSnapshot",
      Object.fromEntries(this.snapshot!),
    );
  }
}

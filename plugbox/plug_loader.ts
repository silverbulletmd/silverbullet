import fs, { stat, watch } from "fs/promises";
import path from "path";
import { createSandbox } from "./node_sandbox";
import { System } from "./runtime";
import { safeRun } from "../server/util";

function extractPlugName(localPath: string): string {
  const baseName = path.basename(localPath);
  return baseName.substring(0, baseName.length - ".plug.json".length);
}

export class DiskPlugLoader<HookT> {
  private system: System<HookT>;
  private plugPath: string;

  constructor(system: System<HookT>, plugPath: string) {
    this.system = system;
    this.plugPath = plugPath;
  }

  watcher() {
    safeRun(async () => {
      for await (const { filename, eventType } of watch(this.plugPath, {
        recursive: true,
      })) {
        if (!filename.endsWith(".plug.json")) {
          return;
        }
        try {
          let localPath = path.join(this.plugPath, filename);
          const plugName = extractPlugName(localPath);
          try {
            await fs.stat(localPath);
          } catch (e) {
            // Likely removed
            await this.system.unload(plugName);
            this.system.emit("plugRemoved", plugName);
          }
          const plugDef = await this.loadPlugFromFile(localPath);
          this.system.emit("plugUpdated", plugName, plugDef);
        } catch {
          // ignore, error handled by loadPlug
        }
      }
    });
  }

  private async loadPlugFromFile(localPath: string) {
    const plug = await fs.readFile(localPath, "utf8");
    const plugName = extractPlugName(localPath);

    console.log("Now loading plug", plugName);
    try {
      const plugDef = JSON.parse(plug);
      await this.system.load(plugName, plugDef, createSandbox(this.system));
      return plugDef;
    } catch (e) {
      console.error("Could not parse plugin file", e);
      throw e;
    }
  }

  async loadPlugs() {
    for (let filename of await fs.readdir(this.plugPath)) {
      if (filename.endsWith(".plug.json")) {
        let localPath = path.join(this.plugPath, filename);
        await this.loadPlugFromFile(localPath);
      }
    }
  }
}

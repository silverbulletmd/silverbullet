import fs from "fs/promises";
import watch from "node-watch";
import path from "path";
import { createSandbox } from "./environment/node_sandbox";
import { safeRun } from "../server/util";
import { System } from "./system";

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
    watch(this.plugPath, (eventType, localPath) => {
      if (!localPath.endsWith(".plug.json")) {
        return;
      }
      safeRun(async () => {
        try {
          // let localPath = path.join(this.plugPath, filename);
          const plugName = extractPlugName(localPath);
          console.log("Change detected for", plugName);
          try {
            await fs.stat(localPath);
          } catch (e) {
            // Likely removed
            await this.system.unload(plugName);
          }
          const plugDef = await this.loadPlugFromFile(localPath);
        } catch (e) {
          console.log("Ignoring something FYI", e);
          // ignore, error handled by loadPlug
        }
      });
    });
  }

  private async loadPlugFromFile(localPath: string) {
    const plug = await fs.readFile(localPath, "utf8");
    const plugName = extractPlugName(localPath);

    console.log("Now loading plug", plugName);
    try {
      const plugDef = JSON.parse(plug);
      await this.system.load(plugName, plugDef, createSandbox);
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

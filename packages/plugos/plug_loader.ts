import fs from "fs/promises";
import watch from "node-watch";
import path from "path";
import { createSandbox } from "./environments/node_sandbox";
import { System } from "./system";
import { Manifest } from "./types";

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
      Promise.resolve()
        .then(async () => {
          try {
            // let localPath = path.join(this.plugPath, filename);
            console.log("Change detected for", localPath);
            try {
              await fs.stat(localPath);
            } catch (e) {
              // Likely removed
              console.log("Plug removed, TODO: Unload");
              return;
            }
            const plugDef = await this.loadPlugFromFile(localPath);
          } catch (e) {
            console.log("Ignoring something FYI", e);
            // ignore, error handled by loadPlug
          }
        })
        .catch(console.error);
    });
  }

  private async loadPlugFromFile(localPath: string) {
    const plug = await fs.readFile(localPath, "utf8");

    try {
      const plugDef: Manifest<HookT> = JSON.parse(plug);
      console.log("Now loading plug", plugDef.name);
      await this.system.load(plugDef, createSandbox);
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

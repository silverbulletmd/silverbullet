import { PluginLoader, System } from "../../../plugbox/src/runtime";
import { Manifest } from "../../../plugbox/src/types";
import { sleep } from "../util";

export class BrowserLoader<HookT> implements PluginLoader<HookT> {
  readonly pathPrefix: string;

  constructor(pathPrefix: string) {
    this.pathPrefix = pathPrefix;
  }

  async load(name: string, manifest: Manifest<HookT>): Promise<void> {
    await fetch(`${this.pathPrefix}/${name}`, {
      method: "PUT",
      body: JSON.stringify(manifest),
    });
  }
}

export class BrowserSystem<HookT> extends System<HookT> {
  constructor(pathPrefix: string) {
    super(new BrowserLoader(pathPrefix), pathPrefix);
  }
  // Service worker stuff
  async pollServiceWorkerActive() {
    for (let i = 0; i < 25; i++) {
      try {
        console.log("Pinging...", `${this.pathPrefix}/$ping`);
        let ping = await fetch(`${this.pathPrefix}/$ping`);
        let text = await ping.text();
        if (ping.status === 200 && text === "ok") {
          return;
        }
      } catch (e) {
        console.log("Not yet");
      }
      await sleep(100);
    }
    // Alright, something's messed up
    throw new Error("Worker not successfully activated");
  }

  async bootServiceWorker() {
    // @ts-ignore
    let reg = navigator.serviceWorker.register(
      new URL("../plugbox_sw.ts", import.meta.url),
      {
        type: "module",
        scope: "/",
      }
    );

    console.log("Service worker registered successfully");

    await this.pollServiceWorkerActive();
  }
}

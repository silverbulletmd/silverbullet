import { ControllerMessage, WorkerLike, WorkerMessage } from "./types";
import { Sandbox, System } from "./runtime";
import { safeRun } from "./util";

// @ts-ignore
import sandboxHtml from "bundle-text:./iframe_sandbox.html";

class IFrameWrapper implements WorkerLike {
  private iframe: HTMLIFrameElement;
  onMessage?: (message: any) => Promise<void>;
  ready: Promise<void>;

  constructor() {
    const iframe = document.createElement("iframe", {});
    this.iframe = iframe;
    iframe.style.display = "none";
    // Let's lock this down significantly
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = sandboxHtml;
    window.addEventListener("message", (evt: any) => {
      if (evt.source !== iframe.contentWindow) {
        return;
      }
      let data = evt.data;
      if (!data) return;
      safeRun(async () => {
        await this.onMessage!(data);
      });
    });
    document.body.appendChild(iframe);
    this.ready = new Promise((resolve) => {
      iframe.onload = () => {
        resolve();
        iframe.onload = null;
      };
    });
  }

  postMessage(message: any): void {
    this.iframe.contentWindow!.postMessage(message, "*");
  }

  terminate() {
    return this.iframe.remove();
  }
}

export function createSandbox(system: System<any>) {
  return new Sandbox(system, new IFrameWrapper());
}

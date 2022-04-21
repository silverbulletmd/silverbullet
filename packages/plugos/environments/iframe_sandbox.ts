import { safeRun } from "../util";

// @ts-ignore
import sandboxHtml from "bundle-text:./iframe_sandbox.html";
import { Sandbox } from "../sandbox";
import { WorkerLike } from "./worker";
import { Plug } from "../plug";

class IFrameWrapper implements WorkerLike {
  private iframe: HTMLIFrameElement;
  onMessage?: (message: any) => Promise<void>;
  ready: Promise<void>;
  private messageListener: (evt: any) => void;

  constructor() {
    const iframe = document.createElement("iframe", {});
    this.iframe = iframe;
    iframe.style.display = "none";
    // Let's lock this down significantly
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = sandboxHtml;
    this.messageListener = (evt: any) => {
      if (evt.source !== iframe.contentWindow) {
        return;
      }
      let data = evt.data;
      if (!data) return;
      safeRun(async () => {
        await this.onMessage!(data);
      });
    };
    window.addEventListener("message", this.messageListener);
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
    console.log("Terminating iframe sandbox");
    window.removeEventListener("message", this.messageListener);
    return this.iframe.remove();
  }
}

export function createSandbox(plug: Plug<any>) {
  return new Sandbox(plug, new IFrameWrapper());
}

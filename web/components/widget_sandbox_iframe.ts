import { WidgetContent } from "$sb/app_event.ts";
import { Client } from "../client.ts";
import { panelHtml } from "./panel_html.ts";

export function createWidgetSandboxIFrame(
  client: Client,
  widgetHeightCacheKey: string | null,
  content: WidgetContent | Promise<WidgetContent>,
  onMessage?: (message: any) => void,
) {
  const iframe = document.createElement("iframe");
  iframe.src = "about:blank";

  const messageListener = (evt: any) => {
    (async () => {
      if (evt.source !== iframe.contentWindow) {
        return;
      }
      const data = evt.data;
      if (!data) {
        return;
      }
      switch (data.type) {
        case "syscall": {
          const { id, name, args } = data;
          try {
            const result = await client.system.localSyscall(name, args);
            if (!iframe.contentWindow) {
              // iFrame already went away
              return;
            }
            iframe.contentWindow!.postMessage({
              type: "syscall-response",
              id,
              result,
            });
          } catch (e: any) {
            if (!iframe.contentWindow) {
              // iFrame already went away
              return;
            }
            iframe.contentWindow!.postMessage({
              type: "syscall-response",
              id,
              error: e.message,
            });
          }
          break;
        }
        case "setHeight":
          iframe.style.height = data.height + "px";
          if (widgetHeightCacheKey) {
            client.space.setCachedWidgetHeight(
              widgetHeightCacheKey,
              data.height,
            );
          }
          break;
        default:
          if (onMessage) {
            onMessage(data);
          }
      }
    })().catch((e) => {
      console.error("Message listener error", e);
    });
  };

  iframe.onload = () => {
    iframe.contentDocument!.write(panelHtml);
    // return;

    // Subscribe to message event on global object (to receive messages from iframe)
    globalThis.addEventListener("message", messageListener);
    // Only run this code once
    iframe.onload = null;
    Promise.resolve(content).then((content) => {
      if (content.html) {
        iframe.contentWindow!.postMessage({
          type: "html",
          html: content.html,
          script: content.script,
          theme: document.getElementsByTagName("html")[0].dataset.theme,
        });
      } else if (content.url) {
        iframe.contentWindow!.location.href = content.url;
        if (content.height) {
          iframe.style.height = content.height + "px";
        }
        if (content.width) {
          iframe.style.width = content.width + "px";
        }
      }
    }).catch(console.error);
  };

  return iframe;
}

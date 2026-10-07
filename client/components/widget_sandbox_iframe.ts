import type { Client } from "../client.ts";
import { trackRender } from "../codemirror/render_settle.ts";
import { panelHtml } from "./panel_html.ts";
import type { CodeWidgetContent } from "@silverbulletmd/silverbullet/type/client";

/**
 * Implements sandbox widgets using iframe with a pooling mechanism to speed up loading
 */

type PreloadedIFrame = {
  iframe: HTMLIFrameElement;
  used: boolean;
  // Is it ready (that is: has the initial load happened)
  ready: Promise<void>;
};

const iframePool = new Set<PreloadedIFrame>();
const desiredPoolSize = 3;

updatePool();

function updatePool(exclude?: PreloadedIFrame) {
  let availableFrames = 0;
  for (const preloadedIframe of iframePool) {
    if (preloadedIframe === exclude) {
      continue;
    }
    if (
      preloadedIframe.used &&
      !document.body.contains(preloadedIframe.iframe)
    ) {
      iframePool.delete(preloadedIframe);
    }
    if (!preloadedIframe.used) {
      availableFrames++;
    }
  }
  for (let i = 0; i < desiredPoolSize - availableFrames; i++) {
    iframePool.add(prepareSandboxIFrame());
  }
}

export function prepareSandboxIFrame(): PreloadedIFrame {
  const iframe = document.createElement("iframe");

  // Use a same-origin empty page compatible with Safari’s installed PWAs.
  iframe.src = "about:blank";
  iframe.style.visibility = "hidden";
  iframe.allow =
    "accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share";

  const ready = new Promise<void>((resolve) => {
    iframe.onload = () => {
      iframe.contentDocument!.write(panelHtml);
      iframe.style.visibility = "visible";
      resolve();
    };
  });
  return {
    iframe,
    used: false,
    ready,
  };
}

function claimIFrame(): PreloadedIFrame {
  for (const preloadedIframe of iframePool) {
    if (!preloadedIframe.used) {
      preloadedIframe.used = true;
      updatePool(preloadedIframe);
      return preloadedIframe;
    }
  }
  console.warn("Had to create a new iframe on the fly, this shouldn't happen");
  const newPreloadedIFrame = prepareSandboxIFrame();
  newPreloadedIFrame.used = true;
  iframePool.add(newPreloadedIFrame);
  return newPreloadedIFrame;
}

export function broadcastReload() {
  for (const preloadedIframe of iframePool) {
    if (preloadedIframe.used && preloadedIframe.iframe?.contentWindow) {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          source: preloadedIframe.iframe.contentWindow,
          data: {
            type: "reload",
          },
        }),
      );
    }
  }
}

export function mountIFrame(
  preloadedIFrame: PreloadedIFrame,
  client: Client,
  widgetHeightCacheKey: string | null,
  content: CodeWidgetContent | null | Promise<CodeWidgetContent | null>,
  onMessage?: (message: any) => void,
) {
  const iframe = preloadedIFrame.iframe;

  trackRender(
    preloadedIFrame.ready.then(async () => {
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
                const result = await client.clientSystem.localSyscall(
                  name,
                  args,
                );
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
              iframe.style.height = `${data.height}px`;
              if (widgetHeightCacheKey) {
                client.widgetCache.setCachedWidgetMeta(widgetHeightCacheKey, {
                  height: data.height,
                  block: true,
                });
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

      globalThis.addEventListener("message", messageListener);
      iframe.onload = null;
      const resolvedContent = await Promise.resolve(content);
      if (!iframe.contentWindow) {
        console.warn("Iframe went away or content was not loaded");
        return;
      }
      if (resolvedContent) {
        if (resolvedContent.html) {
          iframe.contentWindow!.postMessage({
            type: "html",
            html: resolvedContent.html,
            script: resolvedContent.script,
            theme: document.getElementsByTagName("html")[0].dataset.theme,
          });
        } else if (resolvedContent.url) {
          iframe.contentWindow!.location.href = resolvedContent.url;
          if (resolvedContent.height) {
            iframe.style.height = `${resolvedContent.height}px`;
            if (widgetHeightCacheKey) {
              client.widgetCache.setCachedWidgetMeta(widgetHeightCacheKey, {
                height: resolvedContent.height,
                block: true,
              });
            }
          }
          if (resolvedContent.width) {
            iframe.width = `${resolvedContent.width}px`;
          }
        }
      }
    }),
  ).catch(console.error);
}

export function createWidgetSandboxIFrame(
  client: Client,
  widgetHeightCacheKey: string | null,
  content: CodeWidgetContent | null | Promise<CodeWidgetContent | null>,
  onMessage?: (message: any) => void,
) {
  const preloadedIFrame = claimIFrame();
  mountIFrame(
    preloadedIFrame,
    client,
    widgetHeightCacheKey,
    content,
    onMessage,
  );
  return preloadedIFrame.iframe;
}

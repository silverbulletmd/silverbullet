import { WidgetContent } from "../../plug-api/types.ts";
import { Client } from "../client.ts";
import { panelHtml } from "./panel_html.ts";

/**
 * Implements sandbox widgets using iframe with a pooling mechanism to speed up loading
 */

type PreloadedIFrame = {
  // The wrapped iframe element
  iframe: HTMLIFrameElement;
  // Has the iframe been used yet?
  used: boolean;
  // Is it ready (that is: has the initial load happened)
  ready: Promise<void>;
};

const iframePool = new Set<PreloadedIFrame>();
const desiredPoolSize = 3;

updatePool();

function updatePool(exclude?: PreloadedIFrame) {
  let availableFrames = 0;
  // Iterate over all iframes
  for (const preloadedIframe of iframePool) {
    if (preloadedIframe === exclude) {
      continue;
    }
    if (
      // Is this iframe in use, but has it since been removed from the DOM?
      preloadedIframe.used && !document.body.contains(preloadedIframe.iframe)
    ) {
      // Ditch it
      // console.log("Garbage collecting iframe", preloadedIframe);
      iframePool.delete(preloadedIframe);
    }
    if (!preloadedIframe.used) {
      availableFrames++;
    }
  }
  // And after, add more iframes if needed
  for (let i = 0; i < desiredPoolSize - availableFrames; i++) {
    iframePool.add(prepareSandboxIFrame());
  }
}

export function prepareSandboxIFrame(): PreloadedIFrame {
  // console.log("Preloading iframe");
  const iframe = document.createElement("iframe");

  // Empty page with current origin. Handled this differently before, but "dock apps" in Safari (PWA implementation) seem to have various restrictions
  // This one works in all browsers, although it's probably less secure
  iframe.src = "about:blank";

  const ready = new Promise<void>((resolve) => {
    iframe.onload = () => {
      iframe.contentDocument!.write(panelHtml);
      // Now ready to use
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
      // console.log("Took iframe from pool");
      preloadedIframe.used = true;
      updatePool(preloadedIframe);
      return preloadedIframe;
    }
  }
  // Nothing available in the pool, let's spin up a new one and add it to the pool
  console.warn("Had to create a new iframe on the fly, this shouldn't happen");
  const newPreloadedIFrame = prepareSandboxIFrame();
  newPreloadedIFrame.used = true;
  iframePool.add(newPreloadedIFrame);
  return newPreloadedIFrame;
}

export function broadcastReload() {
  for (const preloadedIframe of iframePool) {
    if (preloadedIframe.used && preloadedIframe.iframe?.contentWindow) {
      // Send a message to the global object, which the iframe is listening to
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
  content: WidgetContent | null | Promise<WidgetContent | null>,
  onMessage?: (message: any) => void,
) {
  const iframe = preloadedIFrame.iframe;

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
              const result = await client.clientSystem.localSyscall(name, args);
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
            iframe.height = data.height + "px";
            if (widgetHeightCacheKey) {
              client.setCachedWidgetHeight(
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

    // Subscribe to message event on global object (to receive messages from iframe)
    globalThis.addEventListener("message", messageListener);
    // Only run this code once
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
          iframe.height = resolvedContent.height + "px";
          if (widgetHeightCacheKey) {
            client.setCachedWidgetHeight(
              widgetHeightCacheKey!,
              resolvedContent.height,
            );
          }
        }
        if (resolvedContent.width) {
          iframe.width = resolvedContent.width + "px";
        }
      }
    }
  }).catch(console.error);
}

export function createWidgetSandboxIFrame(
  client: Client,
  widgetHeightCacheKey: string | null,
  content: WidgetContent | null | Promise<WidgetContent | null>,
  onMessage?: (message: any) => void,
) {
  // console.log("Claiming iframe");
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

import { safeRun } from "../lib/async.ts";
import { Client, type ClientConfig } from "./client.ts";
import { parseMarkdown } from "./markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "./markdown/markdown_render.ts";

const configCacheKey = `silverbullet.${document.baseURI}.config`;

safeRun(async () => {
  // First we attempt to fetch the config from the server
  let clientConfig: ClientConfig | undefined;
  try {
    const configResponse = await fetch(".config", {
      // We don't want to follow redirects, we want to get the redirect header in case of auth issues
      redirect: "manual",
      // Add short timeout in case of a bad internet connection, this would block loading of the UI
      signal: AbortSignal.timeout(1000),
    });
    const redirectHeader = configResponse.headers.get("location");
    if (
      configResponse.status === 401 && redirectHeader
    ) {
      alert(
        "Received an authentication redirect, redirecting to URL: " +
          redirectHeader,
      );
      location.href = redirectHeader;
      return;
    }
    clientConfig = await configResponse.json();
    // Persist to localStorage
    localStorage.setItem(configCacheKey, JSON.stringify(clientConfig));
  } catch (e: any) {
    console.error("Failed to fetch client config from server", e.message);
    // We may be offline, let's see if we have a cached config
    const configString = localStorage.getItem(configCacheKey);
    if (configString) {
      // Yep! Let's use it
      clientConfig = JSON.parse(configString);
    } else {
      alert(
        "Could not fetch configuration from server. Make sure you have an internet connection.",
      );
      // Returning here because there's no way to recover from this
      return;
    }
  }
  console.log("Client config", clientConfig);
  console.log("Booting SilverBullet client");

  if (clientConfig!.readOnly) {
    console.log("Running in read-only mode");
  }
  if (navigator.serviceWorker) {
    // Register service worker
    const workerURL = new URL("service_worker.js", document.baseURI);
    navigator.serviceWorker
      .register(workerURL, {
        type: "module",
        //limit the scope of the service worker to any potential URL prefix
        scope: workerURL.pathname.substring(
          0,
          workerURL.pathname.lastIndexOf("/") + 1,
        ),
      })
      .then((registration) => {
        console.log("Service worker registered...");

        // Set up update detection
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          console.log("New service worker installing...");

          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                console.log(
                  "New service worker installed and ready to take over.",
                );
                // Force the new service worker to activate immediately
                newWorker.postMessage({ type: "skipWaiting" });
              }
            });
          }
        });
      });

    // Handle service worker controlled changes (when a new service worker takes over)
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        console.log(
          "New service worker activated, please reload to activate the new version.",
        );
      }
    });

    navigator.serviceWorker.ready.then((registration) => {
      registration.active!.postMessage({
        type: "config",
        config: clientConfig,
      });
    });
  } else {
    console.warn(
      "Not launching service worker, likely because not running from localhost or over HTTPs. This means SilverBullet will not be available offline.",
    );
  }
  const client = new Client(
    document.getElementById("sb-root")!,
    clientConfig!,
  );
  // @ts-ignore: on purpose
  globalThis.client = client;

  // Toggle function for collapsible linked mentions
  // @ts-ignore: on purpose
  globalThis.sbWidgets = globalThis.sbWidgets || {};
  // @ts-ignore: on purpose
  globalThis.sbWidgets.toggleLinkedMentions = function(header: HTMLElement) {
    try {
      const widget = header.closest('.collapsible-linked-mentions') as HTMLElement;
      if (!widget) return;
      
      const isCollapsed = widget.classList.contains('collapsed');
      if (isCollapsed) {
        widget.classList.remove('collapsed');
        header.textContent = header.textContent?.replace('▶', '▼') || '';
        header.setAttribute('aria-expanded', 'true');
      } else {
        widget.classList.add('collapsed');
        header.textContent = header.textContent?.replace('▼', '▶') || '';
        header.setAttribute('aria-expanded', 'false');
      }
    } catch (error) {
      console.error('Error toggling linked mentions:', error);
    }
  };

  // Expandable snippets for linked mentions
  // @ts-ignore: on purpose
  globalThis.toggleSnippet = function(button: HTMLButtonElement) {
    const snippetSpan = button.previousElementSibling as HTMLElement;
    if (!snippetSpan || !snippetSpan.classList.contains('sb-snippet')) {
      console.error('Invalid snippet span found');
      return;
    }

    const fullSnippet = snippetSpan.dataset.fullSnippetHtml;
    const shortSnippet = snippetSpan.dataset.snippetHtml;

    if (button.textContent === '[more]') {
      snippetSpan.innerHTML = fullSnippet || shortSnippet || '';
      button.textContent = '[less]';
    } else {
      snippetSpan.innerHTML = shortSnippet || '';
      button.textContent = '[more]';
    }
  };

  // Renders single snippet element
  function renderSnippet(span: Element): void {
    const snippetText = span.getAttribute('data-snippet') || '';
    const fullSnippetText = span.getAttribute('data-full-snippet') || '';

    if (span.hasAttribute('data-processed')) {
      return;
    }

    try {
      const snippetHtml = snippetText ? renderMarkdownToHtml(parseMarkdown(snippetText)) : '';
      const fullSnippetHtml = fullSnippetText ? renderMarkdownToHtml(parseMarkdown(fullSnippetText)) : '';

      (span as HTMLElement).dataset.snippetHtml = snippetHtml;
      (span as HTMLElement).dataset.fullSnippetHtml = fullSnippetHtml;

      span.setAttribute('data-processed', 'true');

      (span as HTMLElement).innerHTML = snippetHtml;
    } catch (e) {
      console.error('Failed to render snippet markdown for element:', span, 'Error:', e);
      // Fallback to plain text
      (span as HTMLElement).textContent = snippetText;
      // Mark as processed to avoid retry loops
      span.setAttribute('data-processed', 'true');
    }
  }

  // Renders markdown snippets as HTML
  function renderSnippets(): void {
    const snippetSpans = document.querySelectorAll('.sb-snippet:not([data-processed])');
    snippetSpans.forEach(renderSnippet);
  }

  // Watch for new snippets added to DOM
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (element.classList?.contains('sb-snippet')) {
              renderSnippet(element);
            } else if (element.querySelector?.('.sb-snippet')) {
              const newSnippets = element.querySelectorAll('.sb-snippet:not([data-processed])');
              newSnippets.forEach(renderSnippet);
            }
          }
        });
      }
    }
  });

  // Observe document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  await client.init();

  // Initial render of any existing snippets
  renderSnippets();
});

if (!globalThis.indexedDB) {
  alert(
    "SilverBullet requires IndexedDB to operate and it is not available in your browser. Please use a recent version of Chrome, Firefox (not in private mode) or Safari.",
  );
}

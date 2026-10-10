import type { Client } from "../client.ts";
import {
  buildResolveTransclusion,
  buildTranslateUrls,
} from "../codemirror/widgets/widget_util.ts";
import {
  bakeMarkdown,
  createRenderContext,
  evalDirective,
  type PortableMarkdownResult,
  type RenderContext,
  type RenderHost,
} from "./compose.ts";
import type { TaskRefs } from "./inline.ts";
import type { MarkdownRenderOptions } from "./markdown_render.ts";

export type SandboxOptions = {
  /** Height-cache key; defaults to one derived from the sandbox's HTML */
  sandboxKey?: string;
  onSandboxMessage?: (message: any, iframe: HTMLIFrameElement) => void;
};

export function renderHostForClient(
  client: Client,
  opts: SandboxOptions = {},
): RenderHost {
  const resolveTransclusion = buildResolveTransclusion(client);
  return {
    space: client.space,
    sle: client.clientSystem.spaceLuaEnv,
    syntaxExtensions: client.config.get("syntaxExtensions", {}),
    allPages: client.ui.viewState.allPages,
    renderOptions: {
      shortWikiLinks: client.config.get("shortWikiLinks", true),
      translateUrls: buildTranslateUrls(client),
      resolveTransclusion,
    },
    resolveTransclusion,
    createSandbox: (widget) => {
      const host = document.createElement("div");
      const html = typeof widget.html === "string" ? widget.html : "";
      const key = opts.sandboxKey ?? `nested:${html.slice(0, 80)}`;
      const cachedHeight = client.widgetCache.getCachedWidgetHeight(key);
      const reserved = `${cachedHeight > 0 ? cachedHeight : 150}px`;
      // Hold the height until the lazily imported iframe is attached, so
      // measurements don't see an empty host and shrink the page
      host.style.height = reserved;
      // Imported on first use: the sandbox module preloads iframes on load
      void import("../sandbox/widget_sandbox_iframe.ts").then(
        ({ createWidgetSandboxIFrame }) => {
          // Annotated because the message callback below refers to it
          const iframe: HTMLIFrameElement = createWidgetSandboxIFrame(
            client,
            key,
            {
              html,
              script: typeof widget.script === "string" ? widget.script : "",
            },
            (message) => opts.onSandboxMessage?.(message, iframe),
          );
          iframe.style.height = reserved;
          iframe.style.display = "block";
          host.append(iframe);
          host.style.height = "";
        },
      );
      return host;
    },
    mountView: (el, view, pageName) => {
      let unmount: (() => void) | undefined;
      let disposed = false;
      // Imported on first use: the navigator UI pulls in the whole editor
      void import("../navigator/ui/components/inline_view.tsx").then(
        ({ mountInlineView }) => {
          if (!disposed) unmount = mountInlineView(el, client, view, pageName);
        },
      );
      return () => {
        disposed = true;
        unmount?.();
      };
    },
    viewMarkdown: async (view) => {
      const { viewRowsMarkdown } = await import(
        "../navigator/rows_markdown.ts"
      );
      return viewRowsMarkdown(view, client.clientSystem.spaceLuaEnv.env);
    },
  };
}

/** The context `${…}` widgets render, copy and bake in. */
export function liveContextForClient(
  client: Client,
  opts: {
    // The page Copy/Bake text is computed for; defaults to the open page
    page?: { name: string };
    sourcePage?: string;
    // "page" when the rendered text is `sourcePage`'s source
    taskRefs?: TaskRefs;
  } & SandboxOptions = {},
): RenderContext {
  return createRenderContext(renderHostForClient(client, opts), {
    hostPage: opts.page ??
      client.currentPageMeta() ?? { name: client.currentName() },
    sourcePage: opts.sourcePage ?? opts.page?.name ?? client.currentName(),
    taskRefs: opts.taskRefs,
  });
}

/** Evaluates a `${…}` expression as the page renders it. */
export async function evaluateExpression(
  client: Client,
  expr: string,
  page?: { name: string },
): Promise<{ value: unknown; ctx: RenderContext }> {
  const ctx = liveContextForClient(client, { page });
  return { value: await evalDirective(expr, ctx), ctx };
}

/** Bake text of a `${…}` expression (Bake into page, Baked Sections: Update). */
export async function expressionToPortableMarkdown(
  client: Client,
  expr: string,
  page?: { name: string },
): Promise<PortableMarkdownResult> {
  const { value, ctx } = await evaluateExpression(client, expr, page);
  return bakeMarkdown(value, ctx);
}

export function staticContextForClient(
  client: Client,
  renderOptions: MarkdownRenderOptions,
  // Syscall contract: the caller passes the page's text, so "page" unless
  // told otherwise
  taskRefs: TaskRefs,
): RenderContext {
  const host: RenderHost = {
    ...renderHostForClient(client),
    allPages: [],
    renderOptions,
  };
  return createRenderContext(host, {
    hostPage: { name: client.currentName() },
    taskRefs,
  });
}

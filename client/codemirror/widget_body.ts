export type EventPayLoad = {
  name: string;
  data: any;
};

export type WidgetObject = {
  _isWidget?: true;
  html?: string | HTMLElement;
  markdown?: string;
  cssClasses?: string[];
  display?: "block" | "inline";
  events?: Record<string, (event: EventPayLoad) => void>;
  sandbox?: boolean;
  script?: string;
  // false renders `markdown` without evaluating it: no Lua directives, custom
  // syntax or transclusions (for showing user- or agent-written text safely).
  evaluate?: boolean;
};

export type WidgetBody =
  | { kind: "empty" }
  | {
      kind: "html";
      html: string | HTMLElement;
      copyMarkdown?: string;
      block: boolean;
    }
  | { kind: "markdown"; markdown: string; block: boolean; evaluate: boolean };

export function widgetBody(wc: WidgetObject): WidgetBody {
  if (wc.html) {
    return {
      kind: "html",
      html: wc.html,
      copyMarkdown: typeof wc.markdown === "string" ? wc.markdown : undefined,
      block: wc.display === "block",
    };
  }
  if (wc.markdown) {
    return {
      kind: "markdown",
      markdown: wc.markdown,
      block: wc.display === "block",
      evaluate: wc.evaluate !== false,
    };
  }
  return { kind: "empty" };
}

export function bindWidgetEvents(
  target: EventTarget,
  events: WidgetObject["events"],
): () => void {
  const bound: [string, EventListener][] = [];
  for (const [name, handler] of Object.entries(events ?? {})) {
    const listener = (data: Event) => handler({ name, data });
    target.addEventListener(name, listener);
    bound.push([name, listener]);
  }
  return () => {
    for (const [name, listener] of bound) {
      target.removeEventListener(name, listener);
    }
  };
}

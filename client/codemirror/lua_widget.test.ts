import { expect, test, vi } from "vitest";
import type { Client } from "../client.ts";
import { LuaWidget } from "./lua_widget.ts";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";

vi.mock("../components/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

class ElementStub {
  children: ElementStub[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<
    string,
    (event: { stopPropagation: () => void }) => void
  >();
  className = "";
  innerHTML = "";
  type = "";

  appendChild(child: ElementStub) {
    this.children.push(child);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  addEventListener(
    name: string,
    listener: (event: { stopPropagation: () => void }) => void,
  ) {
    this.listeners.set(name, listener);
  }
}

test("an out-of-page view widget can go to its definition in edit-only mode", async () => {
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  const navigate = vi.fn(async () => {});
  const ref = {
    path: "Test/Page.md",
    details: { type: "position" as const, pos: 33 },
  } as Ref;
  try {
    const widget = new LuaWidget({
      client: { navigate } as unknown as Client,
      cacheKey: "test",
      expressionText: "",
      callback: async () => null,
      inPage: false,
      definitionRef: ref,
    });
    const root = widget.wrapHtml(
      true,
      new ElementStub() as unknown as HTMLElement,
      undefined,
      undefined,
      true,
    ) as unknown as ElementStub;
    const button = root.children[0].children.find(
      (child) => child.attributes.get("data-button") === "definition",
    );
    expect(button).toBeDefined();
    button!.listeners.get("click")!({ stopPropagation: () => {} });
    expect(navigate).toHaveBeenCalledWith(ref);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an in-page widget can edit a known source position without searching its text", () => {
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  const dispatch = vi.fn();
  const focus = vi.fn();
  try {
    const widget = new LuaWidget({
      client: {
        editorView: { dispatch },
        focus,
        isReadOnlyMode: () => false,
        widgetCache: {
          prewarmResult: (_key: string, callback: () => Promise<unknown>) =>
            callback(),
        },
        currentName: () => "Example",
      } as unknown as Client,
      cacheKey: "frontmatter",
      expressionText: "",
      callback: async () => null,
      inPage: true,
      editPos: 4,
    });
    const root = widget.wrapHtml(
      true,
      new ElementStub() as unknown as HTMLElement,
      undefined,
      undefined,
      true,
    ) as unknown as ElementStub;
    const edit = root.children[0].children.find(
      (child) => child.attributes.get("data-button") === "edit",
    );
    expect(edit).toBeDefined();
    edit!.listeners.get("click")!({ stopPropagation: () => {} });
    expect(dispatch).toHaveBeenCalledWith({ selection: { anchor: 4 } });
    expect(focus).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an inline out-of-page widget can go to its definition", () => {
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  const navigate = vi.fn(async () => {});
  try {
    const widget = new LuaWidget({
      client: { navigate } as unknown as Client,
      cacheKey: "test",
      expressionText: "",
      callback: async () => null,
      inPage: false,
      definitionRef: { path: "Test/Page.md" },
    });
    const content = new ElementStub();
    const root = widget.wrapHtml(
      false,
      content as unknown as HTMLElement,
      undefined,
    ) as unknown as ElementStub;
    const button = root.children[0].children.find(
      (child) => child.attributes.get("data-button") === "definition",
    );
    expect(button).toBeDefined();
    button!.listeners.get("click")!({ stopPropagation: () => {} });
    expect(navigate).toHaveBeenCalledWith({ path: "Test/Page.md" });
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an in-page inline widget keeps its unwrapped content", () => {
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  try {
    const widget = new LuaWidget({
      client: {
        widgetCache: { prewarmResult: async () => null },
        currentName: () => "Test/Page",
      } as unknown as Client,
      cacheKey: "test",
      expressionText: "",
      callback: async () => null,
      inPage: true,
      definitionRef: { path: "Test/Page.md" },
    });
    const content = new ElementStub();
    expect(
      widget.wrapHtml(false, content as unknown as HTMLElement, undefined),
    ).toBe(content);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a read-only in-page edit-only widget shows no buttons", () => {
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  try {
    const widget = new LuaWidget({
      client: {
        widgetCache: { prewarmResult: async () => null },
        currentName: () => "Test/Page",
        isReadOnlyMode: () => true,
      } as unknown as Client,
      cacheKey: "test",
      expressionText: "",
      callback: async () => null,
      inPage: true,
    });
    const root = widget.wrapHtml(
      true,
      new ElementStub() as unknown as HTMLElement,
      undefined,
      undefined,
      true,
    ) as unknown as ElementStub;
    expect(root.children[0].children).toHaveLength(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a frontmatter-style widget offers Go to definition before Edit", () => {
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  const navigate = vi.fn(async () => {});
  const ref = { path: "CONFIG.md" } as Ref;
  try {
    const widget = new LuaWidget({
      client: {
        navigate,
        isReadOnlyMode: () => false,
        widgetCache: { prewarmResult: async () => null },
        currentName: () => "Example",
      } as unknown as Client,
      cacheKey: "frontmatter",
      expressionText: "",
      callback: async () => null,
      inPage: true,
      editOnly: true,
      editPos: 4,
      definitionRef: ref,
    });
    const root = widget.wrapHtml(
      true,
      new ElementStub() as unknown as HTMLElement,
      undefined,
    ) as unknown as ElementStub;
    const buttons = root.children[0].children;
    expect(buttons.map((b) => b.attributes.get("data-button"))).toEqual([
      "definition",
      "edit",
    ]);
    expect(buttons[0].attributes.get("title")).toBe("Go to definition");
    buttons[0].listeners.get("click")!({ stopPropagation: () => {} });
    expect(navigate).toHaveBeenCalledWith(ref);
  } finally {
    vi.unstubAllGlobals();
  }
});

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

test("an out-of-page view widget can edit its definition in edit-only mode", async () => {
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
      editRef: ref,
    });
    const root = widget.wrapHtml(
      true,
      new ElementStub() as unknown as HTMLElement,
      undefined,
      undefined,
      true,
    ) as unknown as ElementStub;
    const button = root.children[0].children.find(
      (child) => child.attributes.get("data-button") === "edit",
    );
    expect(button).toBeDefined();
    button!.listeners.get("click")!({ stopPropagation: () => {} });
    expect(navigate).toHaveBeenCalledWith(ref);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an inline out-of-page widget can edit its definition", () => {
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  const navigate = vi.fn(async () => {});
  try {
    const widget = new LuaWidget({
      client: { navigate } as unknown as Client,
      cacheKey: "test",
      expressionText: "",
      callback: async () => null,
      inPage: false,
      editRef: { path: "Test/Page.md" },
    });
    const content = new ElementStub();
    const root = widget.wrapHtml(
      false,
      content as unknown as HTMLElement,
      undefined,
    ) as unknown as ElementStub;
    const button = root.children[0].children.find(
      (child) => child.attributes.get("data-button") === "edit",
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
      editRef: { path: "Test/Page.md" },
    });
    const content = new ElementStub();
    expect(
      widget.wrapHtml(false, content as unknown as HTMLElement, undefined),
    ).toBe(content);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an in-page edit-only widget does not show a definition edit button", () => {
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
      editRef: { path: "Test/Page.md" },
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

// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import {
  dataBlockObjects,
  dataBlockPreviewPlugin,
  dataBlockPreviewShows,
  dataBlockPreviewsForState,
  findDataBlocks,
} from "./data_block_preview.ts";

vi.mock("../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

// Stand-in that shows what the callback returns when it is a DOM node
const invalidated: unknown[] = [];
vi.mock("../widgets/lua_widget.ts", () => ({
  LuaWidget: class {
    constructor(private options: { callback: (...args: any[]) => any }) {}
    toDOM() {
      const div = document.createElement("div");
      void this.options
        .callback("", "", () => {})
        .then((result: unknown) => {
          if (result instanceof Node) div.appendChild(result);
        });
      return div;
    }
    destroy() {}
    invalidatePrewarm() {
      invalidated.push(this);
    }
  },
}));

const PAGE = "Contacts";

const doc = [
  "Intro",
  "```#contact",
  "name: Alice",
  "role: Engineer",
  "---",
  "name: Bob",
  "email: bob@example.com",
  "```",
  "Outro",
].join("\n");

function state(text: string, anchor = text.length) {
  return EditorState.create({
    doc: text,
    selection: { anchor },
    extensions: [buildExtendedMarkdownLanguage()],
  });
}

type Renderer = (object: Record<string, unknown>, ctx: any) => unknown;

function client(
  options: {
    renderers?: Record<string, Renderer>;
    codeWidgets?: string[];
    syntaxRendering?: boolean;
    dataBlocksSetting?: boolean;
  } = {},
) {
  const renderers = options.renderers ?? { data: () => "form" };
  return {
    currentName: () => PAGE,
    currentPageMeta: () => ({}),
    isReadOnlyMode: () => false,
    config: {
      get(path: string[], fallback: unknown) {
        if (path.join(".") === "liveEdit.dataBlocks") {
          return options.dataBlocksSetting ?? fallback;
        }
        const [tags, tag, hook] = path;
        if (tags === "tags" && hook === "renderDataBlock" && renderers[tag]) {
          return renderers[tag];
        }
        return fallback;
      },
    },
    clientSystem: {
      scriptsLoaded: true,
      luaCodeWidgets: new Map(
        (options.codeWidgets ?? []).map((lang) => [lang, {}]),
      ),
      codeWidgetHook: { codeWidgetCallbacks: new Map() },
      localSyscall: vi.fn(async (..._args: unknown[]) => {}),
    },
    ui: {
      viewState: {
        uiOptions: {
          markdownSyntaxRendering: options.syntaxRendering ?? false,
        },
      },
    },
    systemReady: true,
    fullIndexCompleted: true,
    pageListLoaded: true,
  };
}

describe("data block detection", () => {
  test("finds closed data and #tag blocks that start their line", () => {
    const text = [
      "```#contact",
      "name: A",
      "```",
      "```data",
      "x: 1",
      "```",
      "```#task",
      "name: shadowed",
      "```",
      "```lua",
      "x = 1",
      "```",
      "- item",
      "  ```#contact",
      "  name: nested",
      "  ```",
      "```#contact",
      "name: unclosed",
    ].join("\n");
    expect(
      findDataBlocks(state(text)).map((b) => [b.lang, b.tag, b.source]),
    ).toEqual([
      ["#contact", "contact", "```#contact\nname: A\n```"],
      ["data", "data", "```data\nx: 1\n```"],
    ]);
  });

  test("splits documents with their positions in the page", () => {
    const [block] = findDataBlocks(state(doc));
    expect(block.documents.map((d) => [d.from, d.text])).toEqual([
      [doc.indexOf("name: Alice"), "name: Alice\nrole: Engineer\n"],
      [doc.indexOf("\nname: Bob"), "\nname: Bob\nemail: bob@example.com"],
    ]);
  });

  test("gives each document its own object and context", () => {
    const [block] = findDataBlocks(state(doc));
    const objects = dataBlockObjects(block, PAGE)!;
    expect(objects).toHaveLength(2);
    expect(objects[1]).toMatchObject({
      index: 1,
      object: {
        name: "Bob",
        email: "bob@example.com",
        tag: "contact",
        page: PAGE,
        ref: `${PAGE}@${doc.indexOf("\nname: Bob")}`,
      },
      context: {
        keys: ["name", "email"],
        types: { name: "string", email: "string" },
        values: { name: "Bob", email: "bob@example.com" },
      },
    });
  });

  test("skips empty documents and leaves invalid or non-mapping YAML as source", () => {
    const blockOf = (body: string) =>
      findDataBlocks(state(`\`\`\`#contact\n${body}\n\`\`\``))[0];
    const withEmpty = dataBlockObjects(blockOf("---\nname: A"), PAGE)!;
    expect(withEmpty.map((o) => o.index)).toEqual([1]);
    expect(dataBlockObjects(blockOf('name: "open'), PAGE)).toBeUndefined();
    expect(dataBlockObjects(blockOf("- a\n- b"), PAGE)).toBeUndefined();
  });
});

describe("data block preview policy", () => {
  test("shows source while the selection is inside or right after the block", () => {
    const blockEnd = doc.indexOf("```\nOutro") + 3;
    const previews = (anchor: number) =>
      dataBlockPreviewsForState(state(doc, anchor), client() as never);
    expect(previews(doc.indexOf("Bob"))).toHaveLength(0);
    expect(previews(blockEnd)).toHaveLength(0);
    expect(previews(blockEnd + 1)).toHaveLength(1);
    expect(previews(0)).toHaveLength(1);
  });

  test("keeps source in Markdown syntax mode", () => {
    expect(
      dataBlockPreviewsForState(
        state(doc),
        client({ syntaxRendering: true }) as never,
      ),
    ).toHaveLength(0);
  });

  test("picks the tag's renderer, then a code widget, then the data tag's", () => {
    const own: Renderer = () => "own";
    const root: Renderer = () => "root";
    const render = (c: ReturnType<typeof client>) =>
      dataBlockPreviewsForState(state(doc), c as never)[0]?.render;
    expect(
      render(
        client({
          renderers: { contact: own, data: root },
          codeWidgets: ["#contact"],
        }),
      ),
    ).toBe(own);
    expect(
      render(client({ renderers: { data: root }, codeWidgets: ["#contact"] })),
    ).toBeUndefined();
    expect(render(client({ renderers: { data: root } }))).toBe(root);
    // Opted out: tag.define { name = "data", renderDataBlock = config.unset }
    expect(render(client({ renderers: {} }))).toBeUndefined();
  });

  test("liveEdit.dataBlocks turns off only the default form", () => {
    const own: Renderer = () => "own";
    const root: Renderer = () => "root";
    const render = (c: ReturnType<typeof client>) =>
      dataBlockPreviewsForState(state(doc), c as never)[0]?.render;
    expect(
      render(client({ renderers: { data: root }, dataBlocksSetting: true })),
    ).toBe(root);
    expect(
      render(client({ renderers: { data: root }, dataBlocksSetting: false })),
    ).toBeUndefined();
    expect(
      render(
        client({
          renderers: { contact: own, data: root },
          dataBlocksSetting: false,
        }),
      ),
    ).toBe(own);
  });
});

describe("data block preview and code widgets", () => {
  test("the fenced-code plugin steps aside only for a block the preview shows", () => {
    const own: Renderer = () => "own";
    const c = client({
      renderers: { contact: own },
      codeWidgets: ["#contact"],
    });
    const from = doc.indexOf("```#contact");
    expect(dataBlockPreviewShows(state(doc), c as never, from)).toBe(true);
    const broken = doc.replace("name: Bob", 'name: "Bob');
    expect(dataBlockPreviewShows(state(broken), c as never, from)).toBe(false);
    // The cursor inside shows the source
    expect(
      dataBlockPreviewShows(state(doc, doc.indexOf("Bob")), c as never, from),
    ).toBe(false);
  });
});

describe("data block preview widget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function mount(render: Renderer) {
    const stub = client({ renderers: { data: render } });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          buildExtendedMarkdownLanguage(),
          dataBlockPreviewPlugin(stub as never),
        ],
      }),
    });
    return { view, parent, stub };
  }

  const flush = async () => {
    await vi.runAllTimersAsync();
  };

  function emailField(object: Record<string, unknown>) {
    const row = document.createElement("div");
    row.setAttribute("data-key", "email");
    const input = document.createElement("input");
    input.value = String(object.email ?? "");
    row.appendChild(input);
    return row;
  }

  test("renders one form per document, each with its own context", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const contexts: any[] = [];
      const mounted = mount((object, ctx) => {
        contexts.push(ctx);
        return emailField(object);
      });
      view = mounted.view;
      await flush();
      const items = mounted.parent.querySelectorAll(
        ".sb-data-block-preview [data-object-index]",
      );
      expect(
        [...items].map((i) => i.getAttribute("data-object-index")),
      ).toEqual(["0", "1"]);
      expect(contexts.map((c) => [c.kind, c.keys, c.readOnly])).toEqual([
        ["data", ["name", "role"], false],
        ["data", ["name", "email"], false],
      ]);
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("ctx.set targets the document where it is now, after an edit above", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const contexts: any[] = [];
      const mounted = mount((object, ctx) => {
        contexts.push(ctx);
        return emailField(object);
      });
      view = mounted.view;
      await flush();
      const second = contexts[1];
      // Keep the DOM (and so the rendered ctx) while the text above changes
      mounted.parent.querySelectorAll("input")[1].focus();
      view.dispatch({ changes: { from: 0, insert: "New first line\n" } });
      await flush();

      await second.set("email", "bob@example.org");
      const shifted = `New first line\n${doc}`;
      const from = shifted.indexOf("\nname: Bob");
      expect(mounted.stub.clientSystem.localSyscall).toHaveBeenCalledWith(
        "object.update",
        [
          {
            name: "Bob",
            email: "bob@example.com",
            page: PAGE,
            ref: `${PAGE}@${from}`,
            tag: "contact",
          },
          { email: "bob@example.org" },
          { remove: [] },
        ],
      );
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("Escape in a field moves the cursor to that key in its own document", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const mounted = mount((object) => emailField(object));
      view = mounted.view;
      await flush();
      const input = mounted.parent.querySelectorAll("input")[1];
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flush();
      expect(view.state.selection.main.head).toBe(
        doc.indexOf("bob@example.com"),
      );
      expect(mounted.parent.querySelector(".sb-data-block-preview")).toBeNull();
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("clicking a form's empty space reveals the start of its own document", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const mounted = mount((object) => emailField(object));
      view = mounted.view;
      await flush();
      const second = mounted.parent.querySelector('[data-object-index="1"]')!;
      second.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      await flush();
      expect(view.state.selection.main.head).toBe(doc.indexOf("name: Bob"));
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("a second quick ctx.set waits for the first, so its target is current", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const contexts: any[] = [];
      const mounted = mount((object, ctx) => {
        contexts.push(ctx);
        return emailField(object);
      });
      view = mounted.view;
      await flush();
      const v = view;
      // Stands in for object.update: lands later, and refuses a stale target
      // the way findTarget does
      mounted.stub.clientSystem.localSyscall.mockImplementation(
        async (_name: unknown, args: any) => {
          const [target, patch] = args;
          await new Promise((resolve) => setTimeout(resolve, 10));
          const text = v.state.doc.toString();
          const bob = `${PAGE}@${text.indexOf("\nname: Bob")}`;
          const alice = `${PAGE}@${text.indexOf("name: Alice")}`;
          if (target.ref !== (patch.role ? alice : bob)) {
            throw new Error("object moved or was removed, query again");
          }
          const [old, replacement] = patch.role
            ? ["role: Engineer", "role: Manager"]
            : ["email: bob@example.com", "email: x"];
          const from = text.indexOf(old);
          v.dispatch({
            changes: { from, to: from + old.length, insert: replacement },
          });
        },
      );
      // As after a blur commit and a click: focus stays in the form, so it
      // keeps its DOM. Engineer → Manager is one character shorter, so Bob
      // moves up
      mounted.parent.querySelectorAll("input")[1].focus();
      const first = contexts[0].set("role", "Manager");
      const second = contexts[1].set("email", "x");
      await vi.runAllTimersAsync();
      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
      expect(v.state.doc.toString()).toBe(
        doc
          .replace("role: Engineer", "role: Manager")
          .replace("email: bob@example.com", "email: x"),
      );
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("ctx.move asks object.update for the new key order", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const contexts: any[] = [];
      const mounted = mount((object, ctx) => {
        contexts.push(ctx);
        return emailField(object);
      });
      view = mounted.view;
      await flush();
      await contexts[1].move("email", -1);
      await flush();
      await contexts.at(-1).move("name", -1);
      const calls = mounted.stub.clientSystem.localSyscall.mock.calls;
      expect(calls).toHaveLength(1);
      expect((calls[0][1] as unknown[]).slice(1)).toEqual([
        {},
        { remove: [], order: ["email", "name"] },
      ]);
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("a tap on a form's empty space doesn't reveal the YAML", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const mounted = mount((object) => emailField(object));
      view = mounted.view;
      await flush();
      const head = view.state.selection.main.head;
      const second = mounted.parent.querySelector('[data-object-index="1"]')!;
      second.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      second.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      await flush();
      expect(view.state.selection.main.head).toBe(head);
      expect(
        mounted.parent.querySelector(".sb-data-block-preview"),
      ).not.toBeNull();
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });
});

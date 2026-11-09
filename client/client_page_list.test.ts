import { afterEach, expect, test, vi } from "vitest";

vi.mock("./codemirror/editor_state.ts", () => ({}));
vi.mock("./sandbox/widget_sandbox_iframe.ts", () => ({
  broadcastReload: () => {},
  createWidgetSandboxIFrame: () => {},
  mountIFrame: () => {},
  prepareSandboxIFrame: () => {},
}));
vi.mock("./navigator/navigator.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./navigator/navigator.ts")>()),
  restoreDocks: async () => {},
}));

const { Client } = await import("./client.ts");
const { ClientSystem } = await import("./client_system.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("a failed direct page-list fetch keeps the last trustworthy list", async () => {
  const viewDispatch = vi.fn();
  const fetchFileList = vi.fn();
  const client = {
    objectIndex: {
      isIndexAvailable: async () => false,
    },
    space: {
      fetchPageList: async () => {
        throw new Error("Offline");
      },
      spacePrimitives: { fetchFileList },
    },
    ui: {
      flashNotification: vi.fn(),
      viewDispatch,
    },
  };

  await Client.prototype.updatePageListCache.call(client);

  expect(viewDispatch).not.toHaveBeenCalled();
  expect(fetchFileList).not.toHaveBeenCalled();
});

/**
 * A cold client: system ready and scripts loaded, no index yet. Built from the
 * prototype so the readiness methods run as they do in the app.
 */
function coldClient(index: { available: boolean }) {
  const client = Object.create(Client.prototype);
  const rebuildEditorState = vi.fn();
  const viewDispatch = vi.fn();
  const queryLuaObjects = vi.fn(async (tag: string) =>
    tag === "page"
      ? [{ name: "index", pageDecoration: { prefix: "🏠 " } }]
      : [],
  );
  Object.assign(client, {
    systemReady: true,
    fullIndexCompleted: false,
    pageListSource: "none",
    widgetReadyDispatched: false,
    clientSystem: { scriptsLoaded: true },
    contentManager: { rebuildEditorState },
    objectIndex: { isIndexAvailable: async () => index.available },
    space: {
      fetchPageList: async () => [{ name: "index" }],
      spacePrimitives: { fetchFileList: vi.fn() },
    },
    pageMetaAugmenter: { augmentObjectArray: async () => {} },
    queryLuaObjects,
    ui: { flashNotification: vi.fn(), viewDispatch },
    eventHook: { dispatchEvent: vi.fn(async () => []) },
    widgetCache: { clearPrewarm: () => {} },
  });
  client.widgetsReady = new Promise<void>((resolve) => {
    client.resolveWidgetsReady = resolve;
  });
  client.indexedRenderReady = new Promise<void>((resolve) => {
    client.resolveIndexedRenderReady = resolve;
  });
  return { client, rebuildEditorState, viewDispatch, queryLuaObjects };
}

const settled = async (promise: Promise<unknown>) =>
  (await Promise.race([
    promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 10)),
  ])) as boolean;

test("widgets become ready from the fallback page list, before the full index", async () => {
  const index = { available: false };
  const { client, rebuildEditorState, viewDispatch, queryLuaObjects } =
    coldClient(index);

  await client.updatePageListCache();

  expect(queryLuaObjects).not.toHaveBeenCalled();
  expect(client.pageListSource).toBe("listing");
  expect(viewDispatch).toHaveBeenCalledWith({
    type: "update-page-list",
    allPages: [{ name: "index" }],
  });
  expect(rebuildEditorState).toHaveBeenCalledOnce();
  expect(await settled(client.widgetsReady)).toBe(true);
  expect(await settled(client.indexedRenderReady)).toBe(false);
});

test("once the index completes, the page list moves to the index and the rebuild is indexed", async () => {
  const index = { available: false };
  const { client, rebuildEditorState, viewDispatch } = coldClient(index);
  await client.updatePageListCache();

  index.available = true;
  await client.adoptIndexedPageList();

  expect(client.pageListSource).toBe("index");
  expect(viewDispatch).toHaveBeenLastCalledWith({
    type: "update-page-list",
    allPages: [{ name: "index", pageDecoration: { prefix: "🏠 " } }],
  });
  // Widgets were already dispatched: only the rebuild after the index
  // (ClientSystem.refreshAfterIndex) redraws them
  expect(rebuildEditorState).toHaveBeenCalledOnce();
  expect(await settled(client.indexedRenderReady)).toBe(false);

  client.settleIndexedRender();
  expect(await settled(client.indexedRenderReady)).toBe(true);
});

test("a warm client is ready and indexed with one rebuild", async () => {
  const { client, rebuildEditorState } = coldClient({ available: true });

  await client.updatePageListCache();
  await client.adoptIndexedPageList();

  expect(rebuildEditorState).toHaveBeenCalledOnce();
  expect(await settled(client.widgetsReady)).toBe(true);
  expect(await settled(client.indexedRenderReady)).toBe(true);
});

test("once another window completes the index, the poll dispatches one reload and stops", async () => {
  vi.useFakeTimers();
  const { client } = coldClient({ available: false });
  let complete = false;
  client.objectIndex.hasFullIndexCompleted = async () => complete;

  let stopped = false;
  void client.pollForIndexCompletion().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(6000);
  expect(client.eventHook.dispatchEvent).not.toHaveBeenCalled();

  complete = true;
  await vi.advanceTimersByTimeAsync(2000);

  expect(stopped).toBe(true);
  expect(client.eventHook.dispatchEvent).toHaveBeenCalledOnce();
  expect(client.eventHook.dispatchEvent).toHaveBeenCalledWith(
    "editor:reloadState",
  );
});

test("the poll stops without a reload once this window completes the index", async () => {
  vi.useFakeTimers();
  const { client } = coldClient({ available: false });
  client.objectIndex.hasFullIndexCompleted = async () => true;

  const polling = client.pollForIndexCompletion();
  client.fullIndexCompleted = true;
  await vi.advanceTimersByTimeAsync(2000);
  await polling;

  expect(client.eventHook.dispatchEvent).not.toHaveBeenCalled();
});

test("a slow fallback listing doesn't overwrite the indexed page list", async () => {
  const index = { available: false };
  const { client, viewDispatch } = coldClient(index);
  let finishListing!: (pages: unknown[]) => void;
  client.space.fetchPageList = () =>
    new Promise((resolve) => {
      finishListing = resolve;
    });
  const fallback = client.updatePageListCache();

  index.available = true;
  await client.adoptIndexedPageList();
  finishListing([{ name: "index" }]);
  await fallback;

  expect(viewDispatch).toHaveBeenCalledOnce();
  expect(viewDispatch).toHaveBeenLastCalledWith({
    type: "update-page-list",
    allPages: [{ name: "index", pageDecoration: { prefix: "🏠 " } }],
  });
});

test("after the index, the decorated page list is adopted before the editor rebuild", async () => {
  const index = { available: false };
  const { client, rebuildEditorState, viewDispatch } = coldClient(index);
  await client.updatePageListCache();
  const order: string[] = [];
  viewDispatch.mockImplementation((action) =>
    order.push(
      action.allPages[0].pageDecoration ? "decorated list" : "plain list",
    ),
  );
  rebuildEditorState.mockImplementation(() => order.push("rebuild"));

  index.available = true;
  const clientSystem = {
    client,
    pageScopes: { clear: () => {} },
    refreshAfterIndex: ClientSystem.prototype.refreshAfterIndex,
  };
  await ClientSystem.prototype.afterIndexCompleted.call(clientSystem as never);

  expect(order).toEqual(["decorated list", "rebuild"]);
  expect(client.fullIndexCompleted).toBe(true);
  expect(await settled(client.indexedRenderReady)).toBe(true);
});

test("an unsaved editor prevents the tab from unloading", () => {
  let beforeUnload: ((event: BeforeUnloadEvent) => void) | undefined;
  vi.stubGlobal(
    "addEventListener",
    vi.fn((name: string, listener: (event: BeforeUnloadEvent) => void) => {
      if (name === "beforeunload") beforeUnload = listener;
    }),
  );
  const register = (
    Client.prototype as unknown as {
      registerUnsavedChangesWarning?: () => void;
    }
  ).registerUnsavedChangesWarning;
  expect(register).toBeTypeOf("function");
  if (!register) return;
  const client = { ui: { viewState: { unsavedChanges: true } } };
  register.call(client);
  const event = {
    preventDefault: vi.fn(),
    returnValue: false,
  } as unknown as BeforeUnloadEvent;

  beforeUnload!(event);

  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.returnValue).toBe(true);
});

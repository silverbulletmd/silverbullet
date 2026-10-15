// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SearchModelState } from "../types/search_admin.ts";
import {
  type ConfirmedAction,
  type ConfirmedActionOptions,
  type SearchModelHost,
  type SearchModelSection,
  useConfirmedAction,
  useSearchModel,
} from "./search_admin_state.ts";

const tiny = {
  id: "tiny",
  displayName: "Tiny test model",
  languages: "English",
  downloadBytes: 2_000_000,
  residentBytes: 3_000_000,
  license: "MIT",
  homepage: "https://example.com/tiny",
  notice: "",
};

const none: SearchModelState = {
  model: null,
  catalog: [tiny],
  download: null,
  stored: [
    {
      id: "tiny",
      displayName: "Tiny test model",
      bytes: 2_000_000,
      complete: true,
      active: false,
    },
  ],
};
const downloading: SearchModelState = {
  ...none,
  model: "tiny",
  download: { state: "downloading", done: 1, total: 2 },
};

let root: HTMLElement;
let section: SearchModelSection<SearchModelState>;

function Probe({ host }: { host: SearchModelHost<SearchModelState> }) {
  section = useSearchModel(host);
  return null;
}

function host(
  over: Partial<SearchModelHost<SearchModelState>> = {},
): SearchModelHost<SearchModelState> {
  return {
    get: vi.fn(async () => none),
    set: vi.fn(async () => downloading),
    remove: vi.fn(async () => ({ ...none, stored: [] })),
    changeQuestion: () => "Turn on semantic search?",
    storedWhere: "the test shelf",
    errorText: (cause) => String(cause),
    ...over,
  };
}

async function mount(h0: SearchModelHost<SearchModelState>) {
  await act(() => render(h(Probe, { host: h0 }), root));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a confirmed change shows the new model and polls its download", async () => {
  const confirm = vi.fn((_question: string) => true);
  vi.stubGlobal("confirm", confirm);
  const h0 = host();
  await mount(h0);
  expect(section.state).toEqual(none);
  await act(() => section.select("tiny"));
  expect(confirm).toHaveBeenCalledWith("Turn on semantic search?");
  expect(h0.set).toHaveBeenCalledWith("tiny");
  expect(section.state).toEqual(downloading);
  expect(section.busy).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(h0.get).toHaveBeenCalledTimes(2);
});

test("a cancelled change keeps the saved model", async () => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => false),
  );
  const h0 = host();
  await mount(h0);
  await act(() => section.select("tiny"));
  expect(h0.set).not.toHaveBeenCalled();
  expect(section.state).toEqual(none);
});

test("a failed change shows the error and reloads", async () => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const h0 = host({
    set: vi.fn(async () => {
      throw "offline";
    }),
  });
  await mount(h0);
  await act(() => section.select("tiny"));
  expect(section.error).toBe("offline");
  expect(h0.get).toHaveBeenCalledTimes(2);
});

test("removing asks with the host's place and shows the result", async () => {
  const confirm = vi.fn((_question: string) => true);
  vi.stubGlobal("confirm", confirm);
  const h0 = host();
  await mount(h0);
  await act(() => section.remove("tiny"));
  expect(confirm.mock.calls[0][0]).toBe(
    "Remove Tiny test model (2 MB) from the test shelf? You can download it again later.",
  );
  expect(h0.remove).toHaveBeenCalledWith("tiny");
  expect(section.state?.stored).toEqual([]);
  expect(h0.get).toHaveBeenCalledTimes(1);
});

test("a failed removal shows the error and reloads", async () => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const h0 = host({
    remove: vi.fn(async () => {
      throw "busy";
    }),
  });
  await mount(h0);
  await act(() => section.remove("tiny"));
  expect(section.error).toBe("busy");
  expect(h0.get).toHaveBeenCalledTimes(2);
});

let action: ConfirmedAction;

function ActionProbe({ options }: { options: ConfirmedActionOptions }) {
  action = useConfirmedAction(options);
  return null;
}

test("a confirmed action marks its key running and reports a failure", async () => {
  const confirm = vi.fn((_question: string) => true);
  vi.stubGlobal("confirm", confirm);
  let finish: () => void = () => {};
  const run = vi.fn(
    (key: string) =>
      new Promise<void>((resolve, reject) => {
        finish = key === "garden" ? resolve : () => reject("disk full");
      }),
  );
  const onError = vi.fn();
  await act(() =>
    render(
      h(ActionProbe, {
        options: {
          question: (key) => (key === "none" ? null : `Rebuild ${key}?`),
          run,
          onError,
        },
      }),
      root,
    ),
  );
  let started: Promise<void> = Promise.resolve();
  await act(() => {
    started = action.start("garden");
  });
  expect(confirm).toHaveBeenLastCalledWith("Rebuild garden?");
  expect(action.running).toEqual({ garden: true });
  await act(async () => {
    finish();
    await started;
  });
  expect(action.running).toEqual({ garden: false });

  await act(() => {
    started = action.start("orchard");
  });
  await act(async () => {
    finish();
    await started;
  });
  expect(onError).toHaveBeenCalledWith("disk full");

  // Nothing to act on, or a cancelled confirmation: nothing runs.
  await act(() => action.start("none"));
  confirm.mockReturnValue(false);
  await act(() => action.start("garden"));
  expect(run).toHaveBeenCalledTimes(2);
});

test("a host's handled error shows nothing", async () => {
  await mount(
    host({
      get: async () => {
        throw "signed out";
      },
      errorText: () => null,
    }),
  );
  expect(section.error).toBe("");
  expect(section.state).toBeUndefined();
});

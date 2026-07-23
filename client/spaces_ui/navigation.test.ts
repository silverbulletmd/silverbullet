import { afterEach, expect, test, vi } from "vitest";

// `SPACES_BASE` is computed at module load from `document.baseURI`, so the
// globals have to be in place before the import — hence the dynamic import
// and `vi.resetModules()` between tests.
async function load(baseURI: string, href: string) {
  vi.resetModules();
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = { baseURI };
  // deno-lint-ignore no-explicit-any
  (globalThis as any).location = new URL(href);
  return await import("./navigation.ts");
}

const BASE = "http://localhost:3000/.spaces/";
const HERE = "http://localhost:3000/.spaces/users";

afterEach(() => {
  // deno-lint-ignore no-explicit-any
  delete (globalThis as any).document;
  // deno-lint-ignore no-explicit-any
  delete (globalThis as any).location;
});

test("another Space Manager screen is handled in place", async () => {
  const { isSpacesUrl } = await load(BASE, HERE);
  expect(isSpacesUrl(new URL("http://localhost:3000/.spaces/users/bob"))).toBe(
    true,
  );
});

test("the Space Manager root itself is handled in place", async () => {
  const { isSpacesUrl } = await load(BASE, HERE);
  expect(isSpacesUrl(new URL("http://localhost:3000/.spaces"))).toBe(true);
  expect(isSpacesUrl(new URL("http://localhost:3000/.spaces/"))).toBe(true);
});

test("a link to a space itself is left to the browser", async () => {
  // The whole point of the spaces list: these URLs leave this app entirely.
  const { isSpacesUrl } = await load(BASE, HERE);
  expect(isSpacesUrl(new URL("http://localhost:3000/notes/"))).toBe(false);
  expect(isSpacesUrl(new URL("http://localhost:3000/"))).toBe(false);
});

test("a path merely starting with the base's text is not a screen", async () => {
  const { isSpacesUrl } = await load(BASE, HERE);
  expect(isSpacesUrl(new URL("http://localhost:3000/.spaces-other/x"))).toBe(
    false,
  );
});

test("another origin is left to the browser", async () => {
  const { isSpacesUrl } = await load(BASE, HERE);
  expect(isSpacesUrl(new URL("https://evil.example.com/.spaces/users"))).toBe(
    false,
  );
});

test("an empty base intercepts nothing", async () => {
  // Guard against the degenerate case where `${base}/` would prefix-match
  // every path on the origin and swallow real navigations.
  const { isSpacesUrl } = await load(
    "http://localhost:3000/",
    "http://localhost:3000/",
  );
  expect(isSpacesUrl(new URL("http://localhost:3000/anything"))).toBe(false);
});

function anchor(href: string, extra: Partial<HTMLAnchorElement> = {}) {
  return {
    href,
    target: "",
    hasAttribute: () => false,
    ...extra,
  } as unknown as HTMLAnchorElement;
}

function click(extra: Partial<MouseEvent> = {}) {
  return { defaultPrevented: false, button: 0, ...extra } as MouseEvent;
}

test("a plain left-click on an in-app link is intercepted", async () => {
  const { shouldIntercept } = await load(BASE, HERE);
  expect(
    shouldIntercept(click(), anchor("http://localhost:3000/.spaces/users/bob")),
  ).toBe(true);
});

test.each([
  ["metaKey", { metaKey: true }],
  ["ctrlKey", { ctrlKey: true }],
  ["shiftKey", { shiftKey: true }],
  ["altKey", { altKey: true }],
])("a %s-click is left to the browser", async (_name, modifier) => {
  // These are the user asking the browser for a new tab/window; hijacking
  // them would silently break open-in-new-tab on every link in the app.
  const { shouldIntercept } = await load(BASE, HERE);
  expect(
    shouldIntercept(
      click(modifier),
      anchor("http://localhost:3000/.spaces/users/bob"),
    ),
  ).toBe(false);
});

test("a middle-click is left to the browser", async () => {
  const { shouldIntercept } = await load(BASE, HERE);
  expect(
    shouldIntercept(
      click({ button: 1 }),
      anchor("http://localhost:3000/.spaces/users/bob"),
    ),
  ).toBe(false);
});

test("an already-handled event is not intercepted again", async () => {
  const { shouldIntercept } = await load(BASE, HERE);
  expect(
    shouldIntercept(
      click({ defaultPrevented: true }),
      anchor("http://localhost:3000/.spaces/users/bob"),
    ),
  ).toBe(false);
});

test("a link opening in a new tab is left to the browser", async () => {
  // The spaces list renders the binding as target="_blank".
  const { shouldIntercept } = await load(BASE, HERE);
  expect(
    shouldIntercept(
      click(),
      anchor("http://localhost:3000/.spaces/users/bob", { target: "_blank" }),
    ),
  ).toBe(false);
});

test("a download link is left to the browser", async () => {
  const { shouldIntercept } = await load(BASE, HERE);
  expect(
    shouldIntercept(
      click(),
      anchor("http://localhost:3000/.spaces/export", {
        hasAttribute: () => true,
      }),
    ),
  ).toBe(false);
});

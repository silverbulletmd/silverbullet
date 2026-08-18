import { expect, test, vi } from "vitest";
import { NavErrorBoundary } from "./nav_error_boundary.tsx";

/**
 * Exercises the boundary's own logic directly rather than mounting into a
 * real DOM -- there is no jsdom (or similar) environment configured for this
 * project's vitest run. `componentDidCatch` (which stages a `setState` update
 * preact only merges into `state` through a live render pass) and `render`
 * (a pure function of `state`) are asserted on separately instead of relying
 * on preact's own state-commit machinery, which isn't this component's to
 * test.
 */

test("componentDidCatch logs the error and requests the fallback state", () => {
  const boundary = new NavErrorBoundary({ slot: "rhs", children: null });
  const setState = vi.spyOn(boundary, "setState");
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  boundary.componentDidCatch(new Error("boom"));

  expect(setState).toHaveBeenCalledWith({ error: "boom" });
  expect(consoleError).toHaveBeenCalledWith(
    "navigator: render error",
    expect.any(Error),
  );
  consoleError.mockRestore();
});

test("componentDidCatch stringifies a non-Error throw", () => {
  const boundary = new NavErrorBoundary({ slot: "rhs", children: null });
  const setState = vi.spyOn(boundary, "setState");
  vi.spyOn(console, "error").mockImplementation(() => {});

  boundary.componentDidCatch("plain string throw");

  expect(setState).toHaveBeenCalledWith({ error: "plain string throw" });
});

test("a child that threw (state.error set) renders the fatal-error banner instead of freezing", () => {
  const boundary = new NavErrorBoundary({ slot: "rhs", children: null });
  // What a real render pass commits into `state` once `componentDidCatch`'s
  // `setState` above has run -- set directly here since nothing is driving
  // that pass in this DOM-free test.
  boundary.state = { error: "boom" };

  const fallback = boundary.render() as any;
  expect(fallback.type).toBe("div");
  expect(fallback.props.className).toBe("sb-nav-root sb-nav-root-rhs");
  const body = fallback.props.children;
  expect(body.props.className).toBe("sb-nav-body");
  const banner = body.props.children;
  expect(banner.props.className).toBe("sb-nav-error");
  expect(banner.props.children).toBe("boom");
});

test("a healthy render (no caught error) passes children straight through", () => {
  const children = { marker: "child-vnode" } as any;
  const boundary = new NavErrorBoundary({ slot: "modal", children });
  expect(boundary.render()).toBe(children);
});

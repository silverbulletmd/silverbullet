import { expect, test } from "vitest";
import { applyEdits } from "./object_edit.ts";
import { planPageUpdate, renderNewPage } from "./object_edit_page.ts";
import { planCtx } from "./object_test_util.ts";

test("update sets and removes frontmatter keys, leaving the body alone", () => {
  const text = "---\ntags: contact\ncompany: Acme\n---\nBody\n";
  expect(
    applyEdits(
      text,
      planPageUpdate(planCtx(text), { company: "Initech", stage: "lead" }, []),
    ),
  ).toBe("---\ntags: contact\ncompany: Initech\nstage: lead\n---\nBody\n");
  expect(applyEdits(text, planPageUpdate(planCtx(text), {}, ["company"]))).toBe(
    "---\ntags: contact\n---\nBody\n",
  );
});

test("update adds frontmatter to a page without it, and drops it when empty", () => {
  expect(
    applyEdits(
      "Body\n",
      planPageUpdate(planCtx("Body\n"), { stage: "lead" }, []),
    ),
  ).toBe("---\nstage: lead\n---\nBody\n");
  const text = "---\nstage: lead\n---\nBody\n";
  expect(applyEdits(text, planPageUpdate(planCtx(text), {}, ["stage"]))).toBe(
    "Body\n",
  );
});

test("an unchanged value produces no edit", () => {
  const text = "---\nstage: lead\n---\nBody\n";
  expect(planPageUpdate(planCtx(text), { stage: "lead" }, [])).toEqual([]);
});

test("renderNewPage writes frontmatter only when there are attributes", () => {
  expect(renderNewPage({ tags: "contact", company: "Acme" }, "Hi\n")).toBe(
    "---\ntags: contact\ncompany: Acme\n---\nHi\n",
  );
  expect(renderNewPage({}, "Hi\n")).toBe("Hi\n");
});

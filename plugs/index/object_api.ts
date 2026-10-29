import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import {
  editor,
  index,
  markdown,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { isValidAnchorName } from "./anchor.ts";
import { extractFrontmatter } from "./api.ts";
import { indexMarkdown } from "./indexer.ts";
import {
  applyEdits,
  checkWritable,
  editedSpans,
  findTarget,
  isPageTarget,
  kindOf,
  ObjectEditError,
  type ObjectHandler,
  type ObjectKind,
  type ObjectTarget,
  type PlanContext,
  pageMetaFor,
  type TextEdit,
} from "./object_edit.ts";
import { dataHandler, planDataAppend } from "./object_edit_data.ts";
import { inlineHandler, planInlineAppend } from "./object_edit_inline.ts";
import {
  PAGE_READ_ONLY,
  planPageUpdate,
  renderNewPage,
} from "./object_edit_page.ts";
import { planTableAppend, tableHandler } from "./object_edit_table.ts";

const HANDLERS: Record<ObjectKind, ObjectHandler> = {
  task: inlineHandler("task"),
  item: inlineHandler("item"),
  paragraph: inlineHandler("paragraph"),
  data: dataHandler,
  table: tableHandler,
};

type Attributes = Record<string, unknown>;
type Planner = (ctx: PlanContext) => Promise<TextEdit[]>;
type Validator = (
  updated: string,
  edits: TextEdit[],
  original: string,
) => Promise<void>;

async function freshObjects(
  text: string,
  page: string,
): Promise<ObjectValue<any>[]> {
  return (await indexMarkdown(
    text,
    pageMetaFor(page),
  )) as unknown as ObjectValue<any>[];
}

async function openPage(): Promise<string | undefined> {
  try {
    return await editor.getCurrentPage();
  } catch {
    // No editor (headless runtime or tests)
    return undefined;
  }
}

/**
 * Runs a syscall, prefixing its errors with the syscall's name; the code
 * below throws plain messages.
 */
async function prefixErrors<T>(fn: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ObjectEditError) {
      throw new ObjectEditError(`${fn}: ${e.message}`);
    }
    throw e;
  }
}

async function checkWritableSpace() {
  if ((await system.getMode()) === "ro") {
    throw new ObjectEditError("this space is read-only");
  }
}

async function checkWritablePage(page: string) {
  let perm: string | undefined;
  try {
    perm = (await space.getPageMeta(page)).perm;
  } catch {
    throw new ObjectEditError(`page ${page} not found`);
  }
  if (perm === "ro") throw new ObjectEditError(`${page} is read-only`);
}

type Job = { page: string; plan: Planner; validate?: Validator };

type Prepared = {
  job: Job;
  open: boolean;
  text: string;
  updated: string;
  edits: TextEdit[];
  /** Ends this edit's turn on the open page; safe to call more than once. */
  release: () => void;
};

// Edits to the open page take turns from reading its text to changing it.
// Checking the text is unchanged and then dispatching takes several awaits, so
// two edits at once could both pass the check and the second would land on
// text it wasn't planned for. Saving happens after the turn ends, because a
// save listener may edit the page again.
let editorTurn: Promise<void> = Promise.resolve();

async function takeEditorTurn(): Promise<() => void> {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  const previous = editorTurn;
  editorTurn = previous.then(() => done);
  await previous;
  return release;
}

/** Plans and validates edits against the page's current text, writing nothing. */
async function preparePage(job: Job): Promise<Prepared> {
  const { page, plan, validate } = job;
  await checkWritablePage(page);
  let open = (await openPage()) === page;
  let release = () => {};
  if (open) {
    release = await takeEditorTurn();
    // The user may have navigated away while this edit waited its turn
    if ((await openPage()) !== page) {
      release();
      release = () => {};
      open = false;
    }
  }
  try {
    const text = open ? await editor.getText() : await space.readPage(page);
    const tree: ParseTree = await markdown.parseMarkdown(text);
    const edits = await plan({ text, tree });
    const updated = applyEdits(text, edits);
    if (edits.length > 0 && validate) await validate(updated, edits, text);
    return { job, open, text, updated, edits, release };
  } catch (e) {
    release();
    throw e;
  }
}

/**
 * Applies prepared edits: on the open page as one undoable change saved
 * right away, otherwise by rewriting the file. Returns false, writing
 * nothing, when the page changed since it was prepared.
 */
async function applyPrepared(p: Prepared): Promise<boolean> {
  if (p.open) {
    try {
      if (p.edits.length === 0) return true;
      // Navigating away since then would put the editor on another page
      if ((await openPage()) !== p.job.page) return false;
      // Typing since the text was read would shift every position
      if ((await editor.getText()) !== p.text) return false;
      // Its own undo step: history doesn't merge it with typing or with the
      // previous edit
      await editor.dispatch({ changes: p.edits, userEvent: "object.update" });
    } finally {
      p.release();
    }
    await editor.save();
    return true;
  }
  if (p.edits.length === 0) return true;
  if ((await space.readPage(p.job.page)) !== p.text) return false;
  await space.writePage(p.job.page, p.updated);
  return true;
}

async function editPages(jobs: Job[]): Promise<Prepared[]> {
  await checkWritableSpace();
  const written = new Map<Job, Prepared>();
  for (let attempt = 0; attempt < 3; attempt++) {
    // Every page still to write is planned and validated before any is
    // written. A page written in an earlier attempt isn't planned again:
    // its objects have changed, so they would no longer match.
    const pending = jobs.filter((job) => !written.has(job));
    const prepared: Prepared[] = [];
    try {
      for (const job of pending) prepared.push(await preparePage(job));
      // The open page goes first, so its turn ends before any other page is
      // written: a page:saved listener may edit the open page
      prepared.sort((a, b) => Number(b.open) - Number(a.open));
      for (const p of prepared) {
        // A page changed while we worked; try the rest again
        if (!(await applyPrepared(p))) break;
        written.set(p.job, p);
      }
    } finally {
      for (const p of prepared) p.release();
    }
    if (written.size === jobs.length) return jobs.map((j) => written.get(j)!);
  }
  throw new ObjectEditError("the page kept changing, try again");
}

async function editPage(
  page: string,
  plan: Planner,
  validate?: Validator,
): Promise<{ text: string; edits: TextEdit[] }> {
  const [p] = await editPages([{ page, plan, validate }]);
  return { text: p.updated, edits: p.edits };
}

function objectValidator(page: string): Validator {
  return async (updated, edits) => {
    const spans = editedSpans(edits);
    const touched = (await freshObjects(updated, page)).filter(
      (o) =>
        kindOf(o) !== null &&
        o.range &&
        spans.some(
          ([from, to]) =>
            o.range[0] < Math.max(to, from + 1) && from <= o.range[1],
        ),
    );
    if (touched.length === 0) return;
    const result = await index.validateObjects(page, [...touched]);
    if (result) throw new ObjectEditError(result.error);
  };
}

async function pageTextValid(page: string, text: string) {
  return validatePageText(page, text).then(
    () => true,
    (e) => {
      if (e instanceof ObjectEditError) return false;
      throw e;
    },
  );
}

async function validatePageText(page: string, text: string) {
  const { frontmatter } = await extractFrontmatter(text);
  // Typed as a list, but a hand-written page can hold a string
  const tags: unknown = frontmatter.tags;
  const pageObject = {
    ...frontmatter,
    ref: page,
    tag: "page",
    name: page,
    page,
    tags: Array.isArray(tags)
      ? tags
      : typeof tags === "string"
        ? tags.split(/[\s,]+/).filter(Boolean)
        : [],
  };
  const result = await index.validateObjects(page, [pageObject as any]);
  if (result) throw new ObjectEditError(result.error);
}

function checkTarget(target: unknown): ObjectTarget {
  const t = target as ObjectTarget;
  // Indexed pages have no page field; their ref is the page name
  if (t?.tag === "page" && t.page === undefined && typeof t.ref === "string") {
    return { ...t, page: t.ref };
  }
  if (!t || typeof t.page !== "string" || typeof t.ref !== "string") {
    throw new ObjectEditError(
      `expected an object from a query, or { page = …, ref = … }`,
    );
  }
  return t;
}

function planUpdate(
  ctx: PlanContext,
  fresh: ObjectValue<any>[],
  target: ObjectTarget,
  patch: Attributes,
  remove: string[],
  order?: string[],
): TextEdit[] {
  const keys = [...Object.keys(patch), ...remove];
  if (isPageTarget(target)) {
    checkWritable("page", PAGE_READ_ONLY, keys);
    return planPageUpdate(ctx, patch, remove, order);
  }
  const found = findTarget(fresh, target);
  const kind = kindOf(found)!;
  if (order && kind !== "data") {
    throw new ObjectEditError(
      `order only applies to pages and data block objects, not a ${kind}`,
    );
  }
  checkWritable(kind, HANDLERS[kind].readOnly, keys);
  return HANDLERS[kind].update(ctx, found, patch, remove, order);
}

export function updateObject(
  target: ObjectTarget | ObjectTarget[],
  patch: Attributes = {},
  options: { remove?: string[]; order?: string[] } = {},
): Promise<void> {
  return prefixErrors("object.update", async () => {
    const remove = options.remove ?? [];
    const order = options.order;
    if (
      order !== undefined &&
      !(Array.isArray(order) && order.every((k) => typeof k === "string"))
    ) {
      throw new ObjectEditError("order must be a list of attribute names");
    }
    const targets = (Array.isArray(target) ? target : [target]).map(
      checkTarget,
    );
    const byPage = new Map<string, ObjectTarget[]>();
    const seen = new Set<string>();
    for (const t of targets) {
      const key = `${t.page}\u0000${t.ref}`;
      if (seen.has(key)) {
        throw new ObjectEditError("the same object is listed twice");
      }
      seen.add(key);
      byPage.set(t.page, [...(byPage.get(t.page) ?? []), t]);
    }
    await editPages(
      [...byPage].map(([page, group]) => {
        const validateObjects = objectValidator(page);
        return {
          page,
          plan: async (ctx: PlanContext) => {
            const fresh = group.every(isPageTarget)
              ? []
              : await freshObjects(ctx.text, page);
            return group.flatMap((t) =>
              planUpdate(ctx, fresh, t, patch, remove, order),
            );
          },
          validate: async (
            updated: string,
            edits: TextEdit[],
            original: string,
          ) => {
            await validateObjects(updated, edits, original);
            // A page that already broke its schema can still be edited, or
            // its other attributes couldn't change until it's fixed by hand
            if (
              group.some(isPageTarget) &&
              (await pageTextValid(page, original))
            ) {
              await validatePageText(page, updated);
            }
          },
        };
      }),
    );
  });
}

export function deleteObject(target: ObjectTarget): Promise<void> {
  return prefixErrors("object.delete", async () => {
    const t = checkTarget(target);
    if (isPageTarget(t)) {
      await checkWritableSpace();
      await checkWritablePage(t.page);
      await space.deletePage(t.page);
      return;
    }
    await editPage(t.page, async (ctx) => {
      const found = findTarget(await freshObjects(ctx.text, t.page), t);
      return HANDLERS[kindOf(found)!].delete(ctx, found);
    });
  });
}

function anchorFor(
  text: string,
  tag: string,
  option: boolean | string | undefined,
): string | undefined {
  if (!option) return undefined;
  if (typeof option === "string") {
    if (!isValidAnchorName(option)) {
      throw new ObjectEditError(`"${option}" isn't a valid anchor name`);
    }
    if (text.includes(`$${option}`)) {
      throw new ObjectEditError(`$${option} is already used on this page`);
    }
    return option;
  }
  for (;;) {
    const name = `${tag}-${Math.random().toString(16).slice(2, 6)}`;
    if (isValidAnchorName(name) && !text.includes(`$${name}`)) return name;
  }
}

export function appendObject(
  page: string,
  record: Attributes,
  options: { anchor?: boolean | string; under?: string; table?: string } = {},
): Promise<ObjectTarget> {
  return prefixErrors("object.append", async () => {
    const tag = record?.tag;
    if (typeof tag !== "string" || tag === "page" || tag === "paragraph") {
      throw new ObjectEditError(
        'the record needs a tag: "task", "item", "table", or the tag of a data block',
      );
    }
    let anchor: string | undefined;
    const { text, edits } = await editPage(
      page,
      async (ctx) => {
        anchor = anchorFor(ctx.text, tag, options.anchor);
        if (tag === "task" || tag === "item") {
          return planInlineAppend(ctx, record, anchor, options.under);
        }
        if (tag === "table") {
          return planTableAppend(ctx, record, anchor, options.table);
        }
        return planDataAppend(ctx, record, anchor);
      },
      objectValidator(page),
    );
    if (anchor) return { page, ref: anchor };
    const [[from, to]] = editedSpans(edits);
    const created = (await freshObjects(text, page)).find(
      (o) => o.tag === tag && o.range && o.range[0] >= from && o.range[0] < to,
    );
    // The whole object, so a later update can tell if the page changed
    if (created) return created as ObjectTarget;
    // Untagged items aren't indexed when index.item.all is off
    const inserted = text.slice(from, to);
    return {
      page,
      tag,
      ref: `${page}@${from + inserted.length - inserted.trimStart().length}`,
    };
  });
}

export function createPage(
  name: string,
  attributes: Attributes = {},
  body = "",
): Promise<{ page: string; ref: string }> {
  return prefixErrors("object.createPage", async () => {
    await checkWritableSpace();
    // getPageMeta matches the exact name; pageExists also resolves by basename
    const exists = await space.getPageMeta(name).then(
      () => true,
      () => false,
    );
    if (exists) throw new ObjectEditError(`${name} already exists`);
    const text = renderNewPage(attributes, body);
    await validatePageText(name, text);
    await space.writePage(name, text);
    return { page: name, ref: name };
  });
}

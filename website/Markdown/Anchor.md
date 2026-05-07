---
description: "An inline $anchor that gives an object a space-globally unique name."
tags: glossary maturity/experimental
---

Anchor syntax (`$my-anchor`) gives the containing [[Object]] a stable, (potentially) meaningful, space-globally unique name. That name becomes the object's `ref`, and it can be linked to from any page using `[[$my-anchor]]`.

Anchors are an alternative to position-based refs (`Page@123`) and header refs (`Page#Section`): they survive edits to the page (positions shift, anchors do not), and unlike header refs they don't collide when two sections share a title.

# Scope rules
Like [[Markdown/Hashtags]], an `$anchor` attaches to its closest containing object:
* In a paragraph, it attaches to the **paragraph**.
* In a bullet, it attaches to that **item**.
* In a [[Task]], it attaches to that **task**.
* In a header, it attaches to that **header**.
* In a [[Markdown/Fenced Code Block]] with a `#tag` as language, the anchor is set via a YAML field named `$ref:` inside the block (the markdown anchor syntax doesn't apply inside YAML).
* In [[Frontmatter]], a `$ref:` field gives the **page** itself a memorable anchor (e.g. `$ref: today` lets you jump to a long, dated page name from anywhere with `[[$today]]`).

# Examples
A paragraph with an anchor $para-anchor here.

* Item with anchor $first-item
* [ ] Task with anchor $first-task

# Header with anchor $sec1

```#person
name: Pete
$ref: pete
```

In addition, all anchors are queryable via [[Object/anchor]]:

${query[[from o = index.tag "anchor"]]}

# Linking
Anchors are referenced from a [[Link]] just like a page or header:

* `[[$my-anchor]]` — bare, resolves space-globally.
* `[[Some Page$my-anchor]]` — page-qualified (useful while a duplicate is being resolved, or for explicitness).
* `![[$my-anchor]]` — [[Transclusions|transcludes]] just the anchored object (paragraph, task, item, etc.), not the whole page.

# Effect on objects
The anchor name replaces the default `ref` for the object that contains it. For instance, `* [ ] $tsk1 Pay rent` produces a task object with `ref: "tsk1"` (instead of the usual `Page@<pos>`).

For page-level anchors (frontmatter `$ref:`), the page object's `ref` is left untouched (so existing page lookups by name keep working) — instead, a parallel `anchor` record points back to the page. See [[Object]] and [[Object/anchor]] for details.

# Naming rules
Anchor names can contain letters, digits, dashes, underscores, slashes, and colons, but:
* Must **not** start with a digit (so `$100` is _not_ an anchor — handy for amounts).
* Must **not** contain whitespace, periods, or other punctuation. Periods are excluded so a sentence-ending period after an anchor (`The $tsk1.`) is not consumed into the name.

The grammar is `$` followed by `[A-Za-z_][A-Za-z0-9_/:-]*`.

# Uniqueness
Anchor names must be **globally unique** within your [[Space]]. Editor-based linting will highlight broken links, and multiple anchors in the same object. The contract is enforced by lint, not by the indexer — when duplicates briefly exist (for instance, while you are renaming one), both stay indexed and lint surfaces the issue at edit time.

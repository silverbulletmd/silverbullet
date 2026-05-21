Relation objects represent typed and untyped relationships between indexed [[Object|objects]] in the space. They are the source of truth for relationship queries (graph views, backlinks of non-page objects, typed-attribute edges). Positional textual occurrences are still recorded by the legacy [[Object/link]] index.

## Attributes
* `from`: ref to the source object: the innermost indexed object that contains the markup producing the edge (page, item, nested item, or fenced `#tag` block object). When the source item carries a `$anchor` the anchor name is used (matching the item's own ref), otherwise the source's byte-offset form (`page@pos`) is used.
* `fromTag`: tag of the source object, denormalized for graph queries.
* `to`: ref to the target object.
* `toTag`: tag of the target object when resolvable at index time. For `[[$anchor]]` references the meta-tag `anchor` is used (anchors are space-global and may live on any kind of host block, so we don't speculate). Absent for unresolved refs, external URLs, and file targets.
* `kind`: one of `mention`, `attribute`, `frontmatter`, `data`, `co-mention`, `url`, `document`. See [[#Kinds]] below.
* `type`: edge type label, e.g. `spouse`, `team`. Populated when `kind` is `attribute`, `frontmatter`, or `data`.
* `via`: for `co-mention` entries only: ref to the containing item or paragraph that scopes the co-occurrence.
* `page`: page where the edge was discovered (used for invalidation).
* `range`: `[start, end]` byte offsets of the wikilink / markdown-link / attribute / data-block-value syntax within `page`. Always present. For `co-mention` records (which are derived) this points at the source-side wikilink. Used by the rename refactor to splice text.
* `alias`: when the source form is `[[ref|alias]]`, the alias. Required to faithfully reproduce the link on rewrite.
* `snippet`: contextual text around the edge where available.
* `pageLastModified`: last-modified timestamp of the source page, useful for ordering.

## Kinds
* `mention`: a plain wikilink or markdown link appearing in page prose or item body.
* `attribute`: an inline `[key: [[ref]]]` attribute pointing at another object.
* `frontmatter`: a page frontmatter key whose value is (or contains) a ref.
* `data`: a fenced `#tag` data block ([[Object/data]]) key whose value is (or contains) a ref.
* `co-mention`: two refs co-occurring in the same item (with its nested children) or paragraph. Emitted in both directions and dedup'd at the innermost shared scope.
* `url`: an external URL link (kept for symmetry with [[Object/link]]).
* `document`: a link to a non-page [[Object/document]] in the space.

## Examples
Here’s a tagged item to use as an example: 

* #contact $pete-ref Pete [spouse: "[[Angela]]"] [team: "[[Super Team]]"]

Show every relation related to [[$pete-ref]] (including this one 👈):

${query[[
  from r = index.relations()
  where r.from == "pete-ref" or
        r.to == "pete-ref"
  select table.select(r, "from", "fromTag", "kind", "to", "toTag")
]]}

All relations defined on this page:
${query[[
  from r = index.relations()
  where r.page == "Object/relation"
  select table.select(r, "from", "fromTag", "kind", "to", "toTag", "snippet")
]]}

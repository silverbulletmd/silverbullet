Relation objects represent typed and untyped relationships between indexed [[Object|objects]] in the space. They are the source of truth for relationship queries (graph views, backlinks of non-page objects, typed-attribute edges). The legacy [[Object/link]] collection is now a virtual projection over `relation`.

## Attributes
* `from`: ref to the source object: the innermost indexed object that contains the markup producing the edge (page, item, nested item, or fenced `#tag` block object). When the source item carries a `$anchor` the anchor name is used (matching the item's own ref), otherwise the source's byte-offset form (`page@pos`) is used.
* `fromTag`: tag of the source object, denormalized for graph queries.
* `to`: ref to the target object.
* `toTag`: the target type — one of `page`, `anchor`, `document`, `url`. Set for every resolved edge (absent for unresolved refs). `url` is a built-in target tag, like `document` (a real object type) and `anchor` (a meta-tag).
* `kind`: the edge label. Either a reserved structural value — `mention` or `co-mention` — or a user predicate (e.g. `spouse`, `team`) taken from a frontmatter key, inline `[key: ...]` attribute, or `#tag` data block key. See [[#Kinds]] below.
* `via`: for `co-mention` entries only: ref to the containing item or paragraph that scopes the co-occurrence.
* `page`: page where the edge was discovered (used for invalidation).
* `range`: `[start, end]` byte offsets of the wikilink / markdown-link / attribute-value syntax within `page`. Always present. For `co-mention` records (which are derived) this points at the source-side wikilink. Used by the rename refactor to splice text.
* `alias`: when the source form is `[[ref|alias]]`, the alias. Required to faithfully reproduce the link on rewrite.
* `snippet`: contextual text around the edge where available.
* `pageLastModified`: last-modified timestamp of the source page, useful for ordering.

## Kinds
* `mention`: a plain wikilink or markdown link (to a page, file, anchor, or external URL — see `toTag`).
* `co-mention`: two refs co-occurring in the same item (with its nested children) or paragraph. Emitted in both directions and dedup'd at the innermost shared scope.
* *user predicates*: any other `kind` value is a typed attribute edge whose label is the key (e.g. `spouse`). `from`/`fromTag` indicate whether it came from frontmatter, an inline attribute, or a data block.

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

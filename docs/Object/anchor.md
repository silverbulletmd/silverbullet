---
references:
- plugs/index/anchor.ts
- plugs/index/indexer.ts
- plugs/index/resolve_anchor.test.ts
---
Every [[Markdown/Anchor]] (`$name`) defined in your [[Concept/Space]] also produces a small `anchor`-tagged object that maps the anchor name to the host object's location.

The host object itself (paragraph, task, header, item, or any user-defined `#tag` object) keeps its own record but with `ref` overridden to the anchor name. The dedicated `anchor` record carries enough information to look the host up, plus a snippet for display in pickers:

* `ref`: the anchor name (e.g. `tsk1` for `$tsk1`). This is the primary key, and is unique across the whole space (enforced by lint).
* `tag`: always `anchor`.
* `page`: the page on which the anchor was defined.
* `hostTag`: the `tag` of the host object the anchor attaches to — `paragraph`, `task`, `item`, `header`, or any custom data-block tag (e.g. `person`).
* `snippet` (optional): a content excerpt for the host object — its first line and a bit more — produced by the same `extractSnippet` helper [[Object/relation|relation]] records use. Used by the [[Feature/Page Picker]] to show what an anchor points at without navigating there. Page-level anchors (frontmatter `$ref:`) have no host block to excerpt, so this is absent for them.
* `pageLastModified` (optional): last-modified timestamp of the host page, mirroring the field [[Object/relation|relation]], [[Object/item|item]], and [[Object/link|link]] records already carry.

`snippet` and `pageLastModified` were added after anchors first shipped, without bumping the index's `desiredIndexVersion` — deliberately, to avoid forcing every space through a full reindex just for two display fields. That's why both are optional: anchor records written before this change have neither, and will keep lacking them until their page is re-indexed (which happens automatically on the next edit to that page, or all at once via ${widgets.commandButton("Space: Reindex")}). Until then, pickers fall back to showing `hostTag on page` for that anchor instead of a snippet.

Position and range are not stored on the anchor record itself. The resolver looks the host up via `getObjectByRef(page, hostTag, ref)` and reads `range` from the host, which avoids drift between the two records on edits; `snippet` is derived from that same host `range` at index time.

# All anchors in this space
${query[[from index.objects("anchor")]]}

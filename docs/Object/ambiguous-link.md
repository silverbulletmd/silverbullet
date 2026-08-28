---
references:
- plugs/index/relation.ts
- plug-api/lib/resolve_path.ts
---
An `ambiguous-link` object records a [[Concept/Link|link]] whose name lookup matches more than one page in the space — a bare name carried by several pages, or a path-qualified link that is the suffix of several paths — with no exact match among them. The link still resolves — see [[Concept/Link#Ambiguous links]] for the ranking that picks the winner — but which page it means depends on where it is written, so each occurrence is indexed for you to find and disambiguate. A link that matches a page exactly is never recorded here: its text is already that page's full path.

Like [[Object/aspiring-page|aspiring pages]], these records are produced by the relation indexer and are recomputed whenever the page is re-indexed, so an ambiguity disappears from the index as soon as it is fixed (by qualifying the link, or by renaming one of the colliding pages).

## Attributes
* `name`: the link target as written, which turned out not to identify a unique page.
* `resolvesTo`: the page the link currently resolves to, which is the first entry of `candidates`.
* `candidates`: every page sharing the name, in ranked order.
* `page`: the page the link appears on.
* `pos`: byte offset of the link within `page`.
* `range`: `[start, end]` byte offsets of the link syntax within `page`.

Ranking is relative to `page`, so two pages linking `[[Config]]` can legitimately have different `resolvesTo` values for the same `name`.

# All ambiguous links in this space
${query[[from index.objects("ambiguous-link")]]}

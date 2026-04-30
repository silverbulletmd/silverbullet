Every [[Markdown/Anchor]] (`$name`) defined in your [[Space]] also produces a small `anchor`-tagged object that maps the anchor name to the host object's location. 

The host object itself (paragraph, task, header, item, or any user-defined `#tag` object) keeps its own record but with `ref` overridden to the anchor name. The dedicated `anchor` record carries only enough information to look the host up:

* `ref`: the anchor name (e.g. `tsk1` for `$tsk1`). This is the primary key, and is unique across the whole space (enforced by lint).
* `tag`: always `anchor`.
* `page`: the page on which the anchor was defined.
* `hostTag`: the `tag` of the host object the anchor attaches to — `paragraph`, `task`, `item`, `header`, or any custom data-block tag (e.g. `person`).

Position and range are deliberately not stored on the anchor record. The resolver looks the host up via `getObjectByRef(page, hostTag, ref)` and reads `range` from the host itself, which avoids drift between the two records on edits.

# All anchors in this space
${query[[from index.tag "anchor"]]}

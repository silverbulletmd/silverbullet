---
description: Bullet and numbered list items.
tagKind: root
references:
- plugs/index/item.ts
---
List items (both bullet point and numbered items) are indexed with the `item` tag, additional tags can be added using [[Tag]].

Here is an example of a #quote item using a custom [[Attribute|attribute]]:

* “If you don’t know where you’re going you may not get there.” [by: Yogi Berra] #quote

And then queried via the #quote tag:
${query[[
  from index.items("quote")
]]}

Additional attributes:

* `parent` will contain a ref to the item’s direct parent `item` if any
* `links` will contain a list of all the wiki-style [[Link|links]] in the item
* `ilinks` (inherited links) will contain a list of all the wiki-style links in the item _and its parents_.
* `itags` will also inherit their ancestors’ tags

Example query showing all attributes of items on this page:
${query[[from index.items() where _.page == editor.getCurrentPage()]]}


## Field reference
* `name`: item content with tags, inline attributes and its anchor removed.
* `text`: item content before that cleanup.
* `page`, `pageLastModified`: containing page and its last-modified timestamp.
* `range`: `[start, end]` source range. `pos` and `toPos` are older start/end fields. Prefer `range` for new code.
* `ref`, `tag`, `tags`, `itags`: shared [[Object#Object representation|object fields]]. Ordinary items have root tag `item`. Checkbox items have root tag `task`.
* Inline attributes become additional fields. The `parent`, `links` and `ilinks` fields described above are optional and appear only when applicable.

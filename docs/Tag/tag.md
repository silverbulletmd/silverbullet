---
description: Every tag used in the space, with the root tag it is used on.
tagKind: index
references:
- plugs/index/tags.ts
- plugs/index/data.ts
- libraries/Library/Std/APIs/Tag.md
---
The `tag` tag indexes the tags themselves: for each page, one record per tag used on it and the root tag of the objects it is used on. This is what powers `#` completion and the [[Tag Picker]].

## Attributes
* `name`: the tag's name, without `#`.
* `page`: the page the tag is used on.
* `parent`: the [[Tag#Root tags|root tag]] of the object the tag is attached to:
  * `page`: a tag in [[Frontmatter]], or in a paragraph holding nothing but hashtags
  * `paragraph`, `header`, `table`, `item` or `task`: a [[Markdown/Hashtags|hashtag]] in that kind of element
  * `data`: a root tag declared by a ` ```#name ` [[Tag/data|data block]]

Built-in tags (`page`, `task`, …) only get a record when they are also used as a hashtag.

Here are the tags used in this space:
${query[[from index.tags() select {name=name, parent=parent} order by name limit 20]]}

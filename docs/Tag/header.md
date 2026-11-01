---
description: Markdown headings.
tagKind: root
references:
- plugs/index/header.ts
---
Headers (lines starting with `#`, `##` etc.) are indexed as well and queryable via the `header` tag.

### Test header

${query[[from index.headers() where page == _CTX.currentPage.name limit 3]]}


## Field reference
* `name`, `text`: heading text with hashtags, inline attributes and its anchor removed.
* `level`: heading depth, from 1 through 6.
* `page`: containing page name.
* `pos`, `range`: start position and `[start, end]` source range of the heading.
* `ref`, `tag`, `tags`, `itags`: shared [[Object#Object representation|object fields]]; `tag` is `header`.
* Inline attributes become additional fields.

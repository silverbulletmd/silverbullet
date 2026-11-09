---
description: Top-level paragraphs that carry a hashtag or anchor.
tagKind: root
references:
- plugs/index/paragraph.ts
---
Top-level paragraphs (that is: paragraphs not embedded in a list) are indexed using the `paragraph` tag, any additional tags can be added using [[Tag]].

By default, paragraphs are indexed when they contain a tag or anchor. However, you can enable indexing _all_ paragraphs by adding the following to your [[CONFIG]]:

```space-lua
config.set("index.paragraph.all", true)
```

Example query, querying a paragraph with a #paragraph-tag:

${query[[from index.paragraphs("paragraph-tag")]]}


## Field reference
* `text`: paragraph Markdown. When the paragraph carries an anchor, its anchor, tags and inline attributes are removed from this text.
* `page`: containing page name.
* `pos`, `range`: start position and `[start, end]` source range.
* `ref`, `tag`, `tags`, `itags`: shared [[Object#Object representation|object fields]]. `tag` is `paragraph`.
* Inline attributes become additional fields. An anchor also causes a paragraph to be indexed even without a hashtag. A paragraph containing only hashtags tags its page instead of producing a paragraph object.

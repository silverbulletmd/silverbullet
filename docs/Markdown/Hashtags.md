---
tags: glossary page-tag-example
description: "An inline #tag that annotates a page or object for categorisation and querying."
references:
- client/codemirror/syntax/hashtag.ts
- plugs/index/tags.ts
---

Hashtag syntax (`#my-tag`) can be used to explicitly assign a [[Tag]] to an [[Object]]. The tag becomes one of the object's [[Tag#User tags|user tags]], stored in its `tags` attribute, next to its root tag.

# Scope rules
* If a hashtag is the only content in a paragraph (at most with additional hashtags), it applies to the **page**.
* If a hashtag is used inside of an item (bullet point, or ordered list), it applies to that **item**.
* If a hashtag is used inside of a [[Task]], it applies to that **task**.
* If a hashtag is used inside of a paragraph, they apply to the **paragraph**.
* If a hashtag is used inside of a heading, it applies to that **header**.
* If a hashtag is used inside of a table row, it applies to that **table** row.
* If you create a [[Markdown/Fenced Code Block]] with a hashtag as language, it doesn't attach a user tag: the hashtag becomes the [[Tag#Root tags|root tag]] of the [[Tag/data|data objects]] in the block.

## Examples

Paragraph #paragraph-tag-example

* Item #item-tag-example
* [ ] Task #task-tag-example

```#data-example
name: Hank
```

# Naming rules
Hashtags can contain letters, dashes, underscores and other characters, but not:
- Whitespace (space, newline, etc.)
- Characters from this list: `!@#$%^&*(),.?":{}|<>\`
- Digits only (e.g. #123)

If you need your tags to contain these characters, you have to surround the tag content with angle brackets like this: #<my tag>

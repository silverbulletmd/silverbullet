Top-level paragraphs (that is: paragraphs not embedded in a list) are indexed using the `paragraph` tag, any additional tags can be added using [[Tag]].

By default, paragraphs are only indexed when they contain a tag. However, you can enable indexing _all_ paragraphs by adding the following to your [[CONFIG]]:

```lua
config.set("index.paragraph.all", true)
```

Example query, querying a paragraph with a #paragraph-tag:

${query[[from index.tag "paragraph-tag"]]}

Every page in your space is available via the `page` tag. You can attach _additional_ tags to a page, by either specifying them in the `tags` attribute [[Frontmatter]], or by putting additional [[Tag]] in a stand alone paragraph with no other (textual) content in them.

In addition to `ref` and `tags`, the `page` tag defines a bunch of additional attributes as can be seen in this example query:

${query[[from index.tag "page" where name == _CTX.currentPage.name]]}

Note that you can also query this page using the `level/intermediate` directly:
${query[[from index.tag "level/intermediate"]]}
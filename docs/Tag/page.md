---
description: Every page in your space.
tagKind: root
references:
- plugs/index/page.ts
- client/data/object_index.ts
---
Every page in your space is available via the `page` tag. You can attach _additional_ tags to a page, by either specifying them in the `tags` attribute [[Frontmatter]], or by putting additional [[Tag|tags]] in a standalone paragraph with no other (textual) content in them.

The field reference below describes the stable attributes. This query shows their values and any additional frontmatter on the current page:

${query[[from index.pages() where name == _CTX.currentPage.name]]}


## Field reference
* `name`: full page name, without `.md`. Also used as `ref` unless a page anchor overrides it.
* `created`, `lastModified`: timestamp strings from file metadata.
* `perm`: `ro` or `rw` for the page’s access mode.
* `tags`: tags explicitly assigned in frontmatter or a standalone hashtag paragraph. `itags` also includes the root `page` tag.
* Frontmatter keys become additional attributes. Built-in file metadata takes precedence over frontmatter values with the same name. Optional `pageDecoration` controls the page’s appearance. See [[Page Decorations]].

See [[Object#Object representation]] for shared fields. The query above shows the values on this page, rather than defining which fields every page must have.

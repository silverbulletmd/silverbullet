---
tags: api/syscall
references:
- plug-api/syscalls/index.ts
- client/plugos/syscalls/index.ts
- client/data/object_index.ts
---

The `index` API provides functions for interacting with SilverBullet's [[Object Index]], including query collections used by [[Space Lua/Integrated Query]], schema introspection, ad-hoc Markdown indexing, and direct object-index operations.

The main query API is `index.objects`; the other collection functions are mostly convenient filters over the same index.

${spacelua.renderApiDocumentation("index")}

## Integrated Query examples

Query one page:

${query[[from index.pages() limit 1]]}

Query three sub-pages below the API page:

${query[[from p = index.subPages("API") limit 3 select p.name]]}

Render three incomplete tasks:

${query[[from t = index.tasks() where not t.done limit 3 select templates.taskItem(t)]]}

Ad-hoc index a Markdown fragment and select its list items:

${query[[
  from index.markdown("* Item 1\n* [ ] Task 1")
  where _.tag == "item"
]]}

`index.extractFrontmatter` can inspect and optionally transform frontmatter and top-level tags. For example, this returns the frontmatter of the current page:

${(index.extractFrontmatter(editor.getText())).frontmatter}

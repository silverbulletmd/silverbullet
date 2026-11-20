---
description: "Pages that are linked to but do not exist yet."
tagKind: index
references:
- plugs/index/relation.ts
- client/data/object_index.ts
---
[[Aspiring Pages]] (codified using the `aspiring-page` tag) are pages that are linked to, but not yet created. [[Like this one]].

Internally SilverBullet uses these in the [[Workbench/Maintenance]] tab (as broken links), page complete and the page picker (to hint at pages to still be created).

Example query (lists all aspiring pages in this space, the results depend on the other unresolved links in your space):

${query[[from index.aspiringPages()]]}

## Attributes
* `name`: unresolved page name.
* `page`: source page containing the link.
* `pos`: start of the unresolved link.
* `ref`: reference identifying that occurrence.

Records are rebuilt when the source page is indexed. Creating the target page removes its aspiring-page entries.

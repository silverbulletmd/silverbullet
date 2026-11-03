---
description: Rows of Markdown tables.
tagKind: root
references:
- plugs/index/table.ts
- client/markdown_parser/table_parser.ts
---
Markdown table rows are indexed using the `table` tag, any additional tags can be added using [[Tag]] in any of its cells.

| Title | Description Text |
| --- | ----- |
| This is some key | The value contains a #table-tag |
| Some Row | This is an example row in between two others |
| Another key | This time without a tag |

And to query:
${query[[from index.tables() where page == _CTX.currentPage.name]]}

Table headers will be normalized by converting them to lowercase and replacing all non alphanumeric characters with `_`.

## Field reference
* Each normalized column heading becomes a field holding the cell’s Markdown text, with hashtags removed. Cell values are strings, rather than automatically parsed numbers or YAML.
* `tableref`: reference to the containing table’s start, as `page@pos`.
* `page`, `pos`, `range`: containing page, row start and row source range.
* `ref`, `tag`, `tags`, `itags`: shared [[Object#Object representation|object fields]]. `tag` is `table`. A row anchor replaces its position-based `ref`.
* Reserved object-field names cannot be overwritten by table columns.

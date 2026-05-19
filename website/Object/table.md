Markdown table rows are indexed using the `table` tag, any additional tags can be added using [[Tag]] in any of its cells.

| Title | Description Text |
| --- | ----- |
| This is some key | The value contains a #table-tag |
| Some Row | This is an example row in between two others |
| Another key | This time without a tag |

And to query:
${query[[from index.tables() where page == _CTX.currentPage.name]]}

Table headers will be normalized by converting them to lowercase and replacing all non alphanumeric characters with `_`.
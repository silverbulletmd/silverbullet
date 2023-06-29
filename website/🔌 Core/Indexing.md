SilverBullet has a generic indexing infrastructure. Pages are reindexed upon saving, so about every second. Manual reindexing can be done running the {[Space: Reindex]} command.

The [[🔌 Core]] plug indexes the following:

* Page metadata encoded in [[Frontmatter]] (queryable via the `page` query source)
* Page backlinks (queryable via the `link` query source), this information is used when renaming a page (automatically updating pages that link to it). Renaming can be done either by editing the page name in the header and hitting `Enter`, or using the {[Page: Rename]} command.
* List items, such as bulleted and numbered lists (queryable via the `item` query source)
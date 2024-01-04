---
tags: plug
---
SilverBullet has a generic indexing infrastructure for [[Objects]]. Pages are automatically index upon save, so about every second. 

The [[Plugs/Index]] plug also defines syntax for [[Tags]].

## Content indexing
The [[Plugs/Index]] plug indexes the following:

* [[Metadata]]
* [[Tags]]
* Page backlinks (queryable via the `link` query source), this information is used when renaming a page (automatically updating pages that link to it).
* List items, such as bulleted and numbered lists (queryable via the `item` query source)
* Paragraphs

## Commands
* {[Space: Reindex]}: Reindexes the entire space
* {[Page: Rename]}: Rename a page
  #ProTip Renaming is more conveniently done by editing the page name in the header and hitting `Enter`.
* {[Page: Batch Rename Prefix]}: Rename a page prefix across the entire space
* {[Page: Extract]}: Extract the selected text into its own page

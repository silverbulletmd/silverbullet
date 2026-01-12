List items (both bullet point and numbered items) are indexed with the `item` tag, additional tags can be added using [[Tags]].

Here is an example of a #quote item using a custom [[Attribute|attribute]]:

* “If you don’t know where you’re going you may not get there.” [by: Yogi Berra] #quote

And then queried via the #quote tag:
${query[[
  from index.tag "quote"
  where table.includes(_.itags, "item")
]]}

Additional attributes:

* `parent` will contain a ref to the item’s direct parent `item` if any
* `iparents` will contain a list of refs to the item’s ancestor nodes including their direct parent, if any
* `links` will contain a list of all the wiki-style [[Link|links]] in the item
* `ilinks` (inherited links) will contain a list of all the wiki-style links in the item _and its parents_.
* `itags` will also inherit their ancestors’ tags

Example query showing all attributes of items on this page:
${query[[from index.tag "item" where _.page == editor.getCurrentPage()]]}
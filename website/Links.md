You can create three types of links in SilverBullet:

* External links, using the `[title](URL)` syntax, for instance: [SilverBullet community](https://community.silverbullet.md).
* “Naked” URL links, like https://community.silverbullet.md
* Internal links using the `[[page name]]` syntax

# Internal link format
Internal links can have various formats:

* `[[CHANGELOG]]`: a simple link to another page that appears like this: [[CHANGELOG]].
* `[[CHANGELOG|The Change Log]]`: a link with an alias that appears like this: [[CHANGELOG|The Change Log]].
* `[[CHANGELOG$edge]]`: a link referencing a particular [[Markdown/Anchors|anchor]]: [[CHANGELOG$edge]]. When the page name is omitted, the anchor is expected to be local to the current page.
* `[[CHANGELOG#Edge]]`: a link referencing a particular header: [[CHANGELOG#Edge]]. When the page name is omitted, the header is expected to be local to the current page.
* `[[CHANGELOG@1234]]`: a link referencing a particular position in a page (characters from the start of the document). This notation is generally automatically generated through templates.

# Caret page links
[[Meta Pages]] are excluded from link auto complete in many contexts. However, you may still want to reference a meta page outside of a “meta context.” To make it easier to reference, you can use the caret syntax: `[[^SETTINGS]]`. Semantically this has the same meaning as `[[SETTINGS]]`. The only difference is that auto complete will _only_ complete meta pages.

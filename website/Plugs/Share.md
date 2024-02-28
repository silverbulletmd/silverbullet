---
repo: https://github.com/silverbulletmd/silverbullet
tags: plug
---
The Share plug provides infrastructure for sharing pages outside of your space. It standardizes the {[Share: Page Or Selection]} (bound to `Cmd-s` or `Ctrl-s`) to share the current page or selection in various ways.

Supported out of the box:

* _Copy to clipboard as clean markdown_ (e.g. to copy into Github, Discourse or some other system that supports plain markdown). This makes the following modifications:
  * It renders any [[Live Queries]] and [[Live Templates]] in place
  * It replaces wiki links with regular links (using the SilverBullet URL as root host name)
  * It removes [[Frontmatter]]
  * It removes [[Attributes]]
  * It removes [[Markdown/Anchors]] and replaces [[Markdown/Command links]] with regular back-tick’ed text.
* _Copy to clipboard as rich text_ (e.g. to copy into Google Docs, Confluence or Word)
* _Publish to Y_: When the `$share` attribute is configured in [[Frontmatter]], see below.

## Publishers
Specific implementations for publishing are implemented in plugs, specifically:
```query
plug where shareSupport = true render [[Library/Core/Query/Page]] 
```

---
type: plug
repo: https://github.com/silverbulletmd/silverbullet
author: Silver Bullet Authors
---

The Share plug provides infrastructure for sharing pages outside of your space. It standardizes the {[Share: Publish]} (bound to `Cmd-s` or `Ctrl-s`) to publish the current page to all share providers specified under the `$share` key in [[Frontmatter]].

Specific implementations for sharing are implemented in other plugs, specifically:
<!-- #query page where share-support = true render [[template/page]] -->
* [[🔌 Github]]
* [[🔌 Markdown]]
* [[🔌 Collab]]
<!-- /query -->

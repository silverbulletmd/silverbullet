---
type: plug
repo: https://github.com/silverbulletmd/silverbullet
---

The Share plug provides infrastructure for sharing pages outside of your space. It standardizes the {[Share: Publish]} (bound to `Cmd-s` or `Ctrl-s`) to publish the current page to all share providers specified under the `$share` key in [[Frontmatter]].

See the [original RFC](https://github.com/silverbulletmd/silverbullet/discussions/117) for implementation details.

Specific implementations for sharing are implemented in other plugs, specifically:
<!-- #query page where share-support = true render [[template/page]] -->
* [[🔌 Ghost]]
* [[🔌 Markdown]]
* [[🔌 Collab]]
* [[🔌 Mattermost]]
* [[🔌 Github]]
<!-- /query -->

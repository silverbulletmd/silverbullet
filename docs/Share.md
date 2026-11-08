---
description: Push, pull or synchronize selected pages with an external destination.
tags: maturity/beta glossary
references:
- libraries/Library/Std/Infrastructure/Share.md
- libraries/Library/Std/Infrastructure/Share Commands.md
- docs/API/share.md
- client/workbench/libraries/libraries_backend.ts
---
A [[Space]] is a boundary: what lives in it sits on your server and stays there unless you decide otherwise. Often, though, _some_ of that content needs to cross the boundary — to push it out into the world, pull it in, or even sync between different locations. This is where SilverBullet _share_ functionality comes in.

**Note:** If you are interested in one-off ways to get content out, have a look at [[Export]].

# Modes
Sharing may be desirable in different directions:
* _Push_: produce content in SilverBullet, then push it to some external location, while being able to keep the external place up to date with changes, keeping SilverBullet as the source of truth. Example use cases:
  * Blog posts
  * Social network posts
  * [[Library]] you want to distribute to others
* _Pull_: pull in content from an external location and import it into your space and be able to keep pulling in new versions on demand. Use cases:
  * [[Library]] that you install
* _Sync_: For bi-directional push and pull. Example use cases:
  * Collaborate on a page with other SilverBullet users across servers

# Operation
SilverBullet has [[^Library/Std/Infrastructure/Share|infrastructural support]] to solve this problem in a general way. It leverages [[Frontmatter]], specifically the following keys:

* `share.uri`: specifies the external location to push, pull or sync your content with, represented as a [[URI|URI]].
* `share.mode`: specifies the _mode_ this sharing should happen, options are: `push`, `pull` or `sync`
* `share.transform` (optional): `false` to publish the page without any of the changes described in [[#What gets published]].

Pull and sync shares also write a `share.hash` key: the hash of the text agreed with the remote at the last pull or sync. Next time it tells which side changed since, and as it travels with the page, that works from any of your devices: nothing about a share is kept on the device. Push needs no such record: it compares the page with the remote.

# Workflow
In your writable space, open the page you want to share and run the `Share: Page` (bound to `Cmd-p`/`Ctrl-p` by default) command. This will pop up a list of enabled “Share providers”. Pick one and follow the provider-specific onboarding steps. At the end, your page will be shared and the `share.*` frontmatter keys automatically set.

Subsequent shares can be done simply by running the `Share: Page` command again.

For the current page, these commands exist:
* ${widgets.commandButton "Share: Open Remote"}: opens the shared copy in your browser, where the location has a web address.
* ${widgets.commandButton "Share: Copy Link"}: copies that web address.
* `Share: Unshare`: stops sharing the page, removing its `share.*` keys. The shared copy stays where it is.

# What gets published
In _push_ mode the page is not sent as it is. Its `share.*` keys are always removed (the rest of its frontmatter is published as it is), and these steps run first, switched on or off depending on where it goes:

* **links**: a page is shared on its own, so [[Link|wiki links]] to other pages turn into plain text and transclusions of them are removed: no dead links are published. Links to a header on the same page stay links, in the form the location understands (for GitHub a Markdown link to the anchor). Gists and other locations reduce all links to text.
* **comments**: HTML comments (`<!-- ... -->`, both whole blocks and inline) are removed, apart from the markers of [[Baked Sections|baked sections]]. The text around a removed comment keeps its paragraphs apart.
* **bake**: [[Baked Sections|live content]] such as queries and templates is replaced by its current result, when the place you publish to can’t run it. It is evaluated as the page being shared, whichever page is open.

* **SilverBullet space:** **links** on, **comments** on, **bake** off.
* **GitHub file, Gist, anything else:** **links** on, **comments** on, **bake** on.

Pages tagged `meta` or `meta/...` (such as library pages) are published as they are, except that their `share.*` keys are removed.

To publish a page unchanged (apart from its `share.*` keys), add `share.transform: false` to its frontmatter. To turn off single steps, use a table:

```yaml
share:
  uri: https://github.com/me/notes/blob/main/Post.md
  mode: push
  transform:
    bake: false
```

These steps only apply to _push_. _Pull_ and _sync_ copy the page as it is, only without the `share.*` keys. You can add your own steps with the `share:transform` service, see [[API/share]].

# Support
Out of the box, sharing is supported for:

* Plain `https://` URIs (_Pull_ mode only) (implemented in [[^Library/Std/Infrastructure/URI]]).
* [[^Library/Std/Infrastructure/Github]] (`https://github.com/*` for repository files and `https://gist.github.com/*` URLs): both in _Pull_ mode, and _Push_ mode after signing in to Github through a device code (or with a personal token configured instead). Technically _Sync_ should work except that Github aggressively caches files, making this impractical.
* [[^Library/Std/Infrastructure/SilverBullet Share|SilverBullet space]]: pages in another SilverBullet space, in _Push_, _Pull_ and _Sync_ mode, signing in with a device code.

To implement your own share provider, have a look at the implementations linked to understand how they work.

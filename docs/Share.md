---
description: The mechanism for publishing or sharing individual pages.
tags: maturity/beta glossary
references:
- libraries/Library/Std/Infrastructure/Share.md
- docs/API/share.md
- client/workbench/libraries/libraries_backend.ts
---
A [[Space]] is a boundary: what lives in it sits on your server and stays there unless you decide otherwise. Often, though, some of that content needs to cross the boundary — to push it out into the world, pull it in, or even sync between different locations. This is where SilverBullet _share_ functionality comes in.

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
  * Collaborate on a page with other SilverBullet users

In sync mode, SilverBullet remembers (on this device) the content both sides last agreed on. When only one side changed, it is copied to the other. When both changed, the two versions are merged three-way; overlapping edits are kept as conflict markers for you to resolve before sharing again. If a merge isn't possible, the remote version is saved as a separate `.conflicted-` copy and nothing is overwritten. See [[API/share]] for details.

When SilverBullet can't tell which side changed (for example the first sync from a new device), it asks which version you want, showing what differs: take theirs, keep mine, or save theirs as a copy.

# Operation
SilverBullet has [[^Library/Std/Infrastructure/Share|infrastructural support]] to solve this problem in a general way. It leverages [[Frontmatter]], specifically the following keys:

* `share.uri`: specifies the external location to push, pull or sync your content with, represented as a [[URI|URI]].
* `share.mode`: specifies the _mode_ this sharing should happen, options are: `push`, `pull` or `sync`
* `share.transform` (optional): `false` to publish the page without any of the changes described in [[#What gets published]], or a table such as `{bake = false}` to turn off individual steps.

Sharing doesn't change the page: SilverBullet keeps what it last shared on the device instead of writing a hash into the page. A `share.hash` key left by an older version is no longer written, but it is still used: while it matches the page, it tells SilverBullet the page hasn't changed since it was last shared, so the first share after updating doesn't have to ask.

# Workflow
On the page you’re interested to share, run the ${widgets.commandButton "Share: Page"} (bound to `Cmd-p`/`Ctrl-p` by default) command. This will pop up a list of enabled “Share providers”. Pick one and follow the provider-specific setup steps. At the end, your page will be shared and the `share.*` frontmatter keys automatically set.

Subsequent shares can be done simply by running the `Share: Page` command again.

# What gets published
In _push_ mode the page is not sent as it is. These steps run first, switched on or off depending on where it goes:

* **links**: a page is shared on its own, so [[Link|wiki links]] to other pages turn into plain text and transclusions of them are removed: no dead links are published. Links to a header on the same page stay links, in the form the location understands (for GitHub a Markdown link to the anchor). Gists and other locations reduce all links to text.
* **comments**: HTML comments (`<!-- ... -->`, both whole blocks and inline) are removed, apart from the markers of [[Baked Sections|baked sections]]. The text around a removed comment keeps its paragraphs apart.
* **frontmatter**: only `title`, `description` and `tags` are kept, so private keys (including `share.*`) are not published.
* **bake**: [[Baked Sections|live content]] such as queries and templates is replaced by its current result, since the place you publish to can't run it. It is evaluated as the page being shared, whichever page is open.

| Destination | links | comments | frontmatter | bake |
|---|---|---|---|---|
| SilverBullet space | on | on | off | off |
| GitHub file, Gist, anything else | on | on | on | on |

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

# Which version?
When a _sync_ or _pull_ finds that both the page and the remote differ and SilverBullet has no record of which one changed (it was never shared from this device), it asks instead of guessing. For _sync_ a diff of the two versions is shown, and you pick _Take theirs_, _Keep mine_ or _Save theirs as a copy_. A _pull_ asks whether to overwrite the page with the remote version (installed libraries are updated without asking).

# Support
Out of the box, sharing is supported for:

* Plain `https://` URIs (_Pull_ mode only) (implemented in [[^Library/Std/Infrastructure/URI]]).
* [[^Library/Std/Infrastructure/Github]] (`https://github.com/*` for repository files and `https://gist.github.com/*` URLs): both in _Pull_ mode, and _Push_ mode after signing in to Github through a device code (or with a personal token configured instead). Technically _Sync_ should work except that Github aggressively caches files, making this impractical.
* [[^Library/Std/Infrastructure/SilverBullet Share|SilverBullet space]]: pages in another SilverBullet space, in _Push_, _Pull_ and _Sync_ mode, signing in with a device code.

To implement your own share provider, have a look at the implementations linked to understand how they work.

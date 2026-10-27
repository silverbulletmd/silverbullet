---
description: The mechanism for publishing or sharing individual pages.
tags: maturity/beta glossary
references:
- libraries/Library/Std/Infrastructure/Share.md
- libraries/Library/Std/Infrastructure/Share Collections.md
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
  * Collaborate on a page with other SilverBullet users

# Operation
SilverBullet has [[^Library/Std/Infrastructure/Share|infrastructural support]] to solve this problem in a general way. It leverages [[Frontmatter]], specifically the following keys:

* `share.uri`: specifies the external location to push, pull or sync your content with, represented as a [[URI|URI]].
* `share.mode`: specifies the _mode_ this sharing should happen, options are: `push`, `pull` or `sync`
* `share.transform` (optional): `false` to publish the page without any of the changes described in [[#What gets published]].

Pull and sync shares also write a `share.hash` key: the hash of the text agreed with the remote at the last pull or sync. Next time it tells which side changed since, and as it travels with the page, that works from any of your devices: nothing about a share is kept on the device. Push needs no such record: it compares the page with the remote.

# Workflow
On the page you’re interested to share, run the ${widgets.commandButton "Share: Page"} (bound to `Cmd-p`/`Ctrl-p` by default) command. This will pop up a list of enabled “Share providers”. Pick one and follow the provider-specific onboarding steps. At the end, your page will be shared and the `share.*` frontmatter keys automatically set.

Subsequent shares can be done simply by running the `Share: Page` command again.

For the current page, these commands exist:
* ${widgets.commandButton "Share: Open Remote"}: opens the shared copy in your browser, where the location has a web address.
* ${widgets.commandButton "Share: Copy Link"}: copies that web address.
* ${widgets.commandButton "Share: Unshare"}: stops sharing the page, removing its `share.*` keys. The shared copy stays where it is.

${widgets.commandButton "Share: All Changed"} shares every _sync_ page you changed since its last share (as its `share.hash` tells), every _push_ page whose remote differs from it or is missing (it reads each push page's remote to find out), and every [[#Collections|collection]] with such a page. _Pull_ pages are left alone. To see all your shared pages and collections and their status, open [[Shared Pages]].

# Collections
> **warning** Warning
> Experimental, this feature may change in the near future.
> 
A _collection_ publishes a set of pages together under one location, keeping the links between them: a blog, or a set of documentation pages. Collections are defined in [[CONFIG]] rather than with frontmatter:

```lua
config.set("share.collections", {
  blog = {
    pages = function()
      return index.contentPages("pub")
    end,
    uri = "github:me/blog@main/content",  -- target root
    -- optional
    path = function(page)
      return page.name:gsub("^Blog/", "")
    end,
    transform = { bake = false },
  },
})
```

* The key (`blog`) names the collection in ${widgets.commandButton "Share: Collection"} and in [[Shared Pages]].
* `pages` is a function returning the member pages, as page objects or page names.
* `uri` is the target root. Each member is written under the root, named after its `<path>`: the page name, or what `path(page)` returns. How the name is formed depends on the location, see below.
* `transform` (optional) turns off steps of [[#What gets published]], like `share.transform` on a single page.
* `mode` (optional) can only be `push`.

${widgets.commandButton "Share: Collection"} asks which collection to publish, then writes the members whose published copy differs from them (or is missing) and leaves the others alone. Links between members point to their published copies; links to pages outside the collection become plain text. The pages themselves are not changed: nothing is added to their frontmatter. A page that is in a collection and also has its own `share.uri` is shared both ways, independently.

**Use a target root dedicated to the collection.** When publishing, SilverBullet lists what is under the root, and anything no member maps to is offered for removal: every `.md` file under the root on GitHub, every `.md` file of a gist, and every page under the root on a SilverBullet space. The files are listed unticked, and only those you tick are deleted. A page you renamed shows up as its new file plus the old one in that list.

Where the collection goes:
* **GitHub repository**: a folder in a repository, such as `github:me/blog@main/content`. All changes of one publish go into a single commit, and you are asked for its commit message.
* **Gist**: an existing gist, such as `https://gist.github.com/me/abc123`, with each member a file in it.
* **SilverBullet space**: a page prefix in another space, such as `https://notes.example.com/Blog`; each member becomes a page under it. The root can also be the space itself (`https://notes.example.com`): members become pages at the top of that space.

${widgets.commandButton "Share: All Changed"} publishes every collection with a member whose published copy differs or is missing, including one that has gained a page (a newly tagged or renamed one) or was never published. It reads each collection's target to find out; a collection whose target can't be read is left to `Share: Collection`.

# What gets published
In _push_ mode the page is not sent as it is. Its `share.*` keys are always removed (the rest of its frontmatter is published as it is), and these steps run first, switched on or off depending on where it goes:

* **links**: a page is shared on its own, so [[Link|wiki links]] to other pages turn into plain text and transclusions of them are removed: no dead links are published. Links to a header on the same page stay links, in the form the location understands (for GitHub a Markdown link to the anchor). Gists and other locations reduce all links to text.
* **comments**: HTML comments (`<!-- ... -->`, both whole blocks and inline) are removed, apart from the markers of [[Baked Sections|baked sections]]. The text around a removed comment keeps its paragraphs apart.
* **bake**: [[Baked Sections|live content]] such as queries and templates is replaced by its current result, when the place you publish to can’t run it. It is evaluated as the page being shared, whichever page is open.

| Destination | links | comments | bake |
|---|---|---|---|
| SilverBullet space | on | on | off |
| GitHub file, Gist, anything else | on | on | on |

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

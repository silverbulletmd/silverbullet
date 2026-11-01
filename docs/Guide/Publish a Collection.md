#guide

Publish selected pages together when they should keep links to one another at an external destination. A collection is push-only; it does not grant public access to your source space. For a live public SilverBullet space, use [[Publishing]].

Try this in a writable practice space, with a destination you control. Configure credentials through [[Share#Workflow|the sharing workflow]] before publishing. The configuration below belongs in a `space-lua` block in [[CONFIG]]; replace the example target with your own dedicated test folder.

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
    uri = "github:sam-example/moonshot-notes@main/content",  -- target root
    -- optional
    path = function(page)
      return page.name:gsub("^Blog/", "")
    end,
    transform = { bake = false },
  },
})
```

* The key (`blog`) names the collection in `Share: Collection` and in [[Shared Pages]].
* `pages` is a function returning the member pages, as page objects or page names.
* `uri` is the target root. Each member is written under the root, named after its `<path>`: the page name, or what `path(page)` returns. How the name is formed depends on the location, see below.
* `transform` (optional) turns off steps of [[Share#What gets published]], like `share.transform` on a single page.
* `mode` (optional) can only be `push`.

`Share: Collection` asks which collection to publish, then writes the members whose published copy differs from them (or is missing) and leaves the others alone. Links between members point to their published copies; links to pages outside the collection become plain text. The pages themselves are not changed: nothing is added to their frontmatter. A page that is in a collection and also has its own `share.uri` is shared both ways, independently.

**Use a target root dedicated to the collection.** When publishing, SilverBullet lists what is under the root, and anything no member maps to is offered for removal: every `.md` file under the root on GitHub, every `.md` file of a gist, and every page under the root on a SilverBullet space. The files are listed unticked, and only those you tick are deleted. A page you renamed shows up as its new file plus the old one in that list.

Where the collection goes:
* **GitHub repository**: a folder in a repository, such as `github:sam-example/moonshot-notes@main/content`. All changes of one publish go into a single commit, and you are asked for its commit message.
* **Gist**: an existing gist, such as `https://gist.github.com/me/abc123`, with each member a file in it.
* **SilverBullet space**: a page prefix in another space, such as `https://notes.example.com/Blog`; each member becomes a page under it. The root can also be the space itself (`https://notes.example.com`): members become pages at the top of that space.

`Share: All Changed` publishes every collection with a member whose published copy differs or is missing, including one that has gained a page (a newly tagged or renamed one) or was never published. It reads each collection’s target to find out; a collection whose target can’t be read is left to `Share: Collection`.


# Check the result
Open [[Shared Pages]], check the collection, and inspect its published links and dynamic results at the destination. Review the removal list before selecting any old files. See [[Share#What gets published]] for transformations and [[Share#Support]] for provider limits.

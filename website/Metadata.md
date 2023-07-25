Metadata is data about data. There are a few entities you can add meta data to:

* **page**: Pages have a default set of meta data built-in, but this can be expanded through mechanisms described below. The available metadata for a page is:
  * `name`: The full name of the page
  * `lastModified`: a timestamp (in ms since 1970-01-01) of when the page was last modified
  * `perm`: either `ro` (read-only) or `rw`: this determines whether the editor opens in read-write or read-only mode.
  * `contentType`: for pages always `text/markdown`
  * `size`: the size of the file in bytes
  * `tags`: A list of tags used in the top-level of the page (if any)
* **item**: Every list item appearing in a numbered, or unordered list is indexed and contains the following default set of metadata:
  * `name`: The full content of the item minus attributes (see later)
  * `page`: The page the item appears in
  * `pos`: The offset (number of characters from the beginning of the page) where the item starts
  * `tags`: A list of tags used in the item (if any)
* **task**: Every task defined in the space using the `* [ ] Task name` syntax
  * `name`: The full task name/description
  * `done`: Whether the task has been marked as done
  * `page`: The page where the task appears
  * `pos`: The offset (number of characters from the beginning of the page) where the item starts
  * `tags`: A list of tags used in the task (if any)
* **tag**: Every tag used in the space
  * `name`: The name of the tag (without `#`)
  * `freq`: The frequency of the use of the tag

In addition, this metadata can be augmented in a few additional ways:

* [[🔌 Core/Tags]]: adds to the `tags` attribute
* [[Frontmatter]]: at the top of pages, a [[YAML]] encoded block can be used to define additional attributes to a page
* [[Attributes]]
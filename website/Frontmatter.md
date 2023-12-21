Frontmatter is a common format to attach additional metadata (data about data) to markdown documents.

In SilverBullet, there are multiple ways to attach [[Metadata]] to a page; frontmatter is one of them.

You create it by starting your markdown document with `---` followed by [[YAML]] encoded attributes and then ending with `---` again. Followed by the regular body of your document.

Here is an example:

    ---
    status: Draft
    tags:
    - tag1
    - tag2
    ---
    ## This is a section
    This is content

# Special attributes
While SilverBullet allows arbitrary metadata to be added to pages, there are a few attributes with special meaning:

* `name` (==DISALLOWED==): is an attribute used for page names, _you should not set it_.
* `displayName` (`string`): very similar in effect as `aliases` but will use this name for the page in certain contexts.
* `aliases` (`array of strings`): allow you to specify a list of alternative names for this page, which can be used to navigate or link to this page
* `tags` (`array of strings` or `string`): an alternative (and perhaps preferred) way to assign [[Tags]] to a page. In principle you specify them as a list of strings, but for convenience you can also specify them as (possibly comma-separated) string, e.g. `tags: tag1, tag2, tag3`

In addition, in the context of [[Templates]] frontmatter has a very specific interpretation.
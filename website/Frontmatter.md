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

SilverBullet allows arbitrary metadata to be added to pages this way, with two exceptions:

* `name` is an attribute used for page names, so don’t attempt to override it in frontmatter
* `tags` can be specified (as in the example) and are, in effect, another way of adding tags to your page. You can achieve the same result by simply adding hashtags in the body of your document, e.g. `#tag1 #tag2`.

SilverBullet also has the _convention_ of using attributes starting with a `$` for internal use. For instance, the sharing capability uses the `$share` attribute, and `$disableDirectives: true` has the special meaning of disabling [[🔌 Directive]] processing on a page.
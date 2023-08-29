Tags in SilverBullet can be added in two ways:

1. Through the `tags` attribute in [[Frontmatter]]
2. By putting a `#tag` at the top level (to tag a page), or at the task or item level to tag those blocks specifically.

For instance, by using the #core-tag in this page, it has been tagged and can be used in a [[🔌 Directive/Query]]:

<!-- #query page where tags = "core-tag" render [[template/page]] -->
* [[Tags]]
<!-- /query -->

Similarly, tags can be applied to list **items**:

* This is a tagged item #core-tag

and be queried:

<!-- #query item where tags = "core-tag" -->
|name                           |tags    |page|pos|
|-------------------------------|--------|----|---|
|This is a tagged item #core-tag|core-tag|Tags|494|
<!-- /query -->

and **tags**:

* [ ] This is a tagged task #core-tag

And they can be queried this way:

<!-- #query task where tags = "core-tag" render [[template/task]] -->
* [ ] [[Tags@808]] This is a tagged task #core-tag
<!-- /query -->

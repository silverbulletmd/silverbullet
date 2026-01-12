The ultimate meta tag is `tag` itself, which indexes for all tags used, in which page they appear and what their “parent tag” is (the context of the tag: either `page`, `item` or `task`).

Here are the tags used/defined in this space:
${query[[from index.tag "tag" select {name=name, parent=parent}]]}

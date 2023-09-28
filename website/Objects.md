#meta-tag

SilverBullet automatically builds and maintains a database of _objects_ based on your space, and subsequently allows you to [[🔌 Directive/Query]] this database in (potentially) useful ways.

This index is maintained by the [[🔌 Index]] plug.

Every object has a set of [[Attributes]]:
* A `ref` attribute: acting as an _identifier_ and often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `link` will use `page name@pos` (where `pos` is the location the link appears in `page name`).
* One more more `tags`, which define the type(s) of an object.
* Any number of additional tag-specific and custom [[Attributes]].

# Tags
$tags
Every object has one or more tags, defining the type of an object. Some tags are built-in (as described below), but you can easily define new tags by simply using the #hashtag notation in strategic locations.

---

This concept is best explained through examples. For this purpose, let’s walk through the base tags in use in SilverBullet:

## page
Every page in your space is available via the `page` tag. You can attach _additional tags_ to a page, by either defining them in the `tags` attribute [[Frontmatter]], or by putting additional [[Tags]] in the _first paragraph_ of your page, as is done in this particular page with a #meta-tag.

The following query shows the attributes defined for a page:

<!-- #query page where name = "{{@page.name}}" -->
|ref    |tags         |name   |size|contentType  |lastModified            |perm|
|--|--|--|--|--|--|--|
|Objects|page,meta-tag|Objects|6745|text/markdown|2023-09-27T08:49:07.911Z|rw|
<!-- /query -->

Since we’ve tagged this page with #meta-tag, we can also query `meta-tag` as a source:

<!-- #query meta-tag -->
|ref    |tags         |name   |size|contentType  |lastModified            |perm|
|--|--|--|--|--|--|--|
|Objects|page,meta-tag|Objects|6745|text/markdown|2023-09-27T08:49:07.911Z|rw|
<!-- /query -->

Potentially useful tags for pages could be:

* Tags denoting the type of thing the page is describing, for instance `#person` or `#book`.
* The status of a page, e.g. `#InProgress` or `#Published`

## task
Every task in your space is tagged with the `task` tag by default. You tag it with additional tags by using tags in the task name, e.g.

* [ ] My task #upnext 

And can then be queried via either `task` or `upnext`:

<!-- #query upnext render [[template/task]] -->
* [ ] [[Objects@2387]] My task #upnext
<!-- /query -->

## item
List items are not indexed unless explicitly tagged (for performance reasons). Tagging of items is done by simply adding a tag to the item:

* “If you don’t know where you’re going you may not get there.” [by: Yogi Berra] #quote

And then queried via the #quote tag:

<!-- #query quote select by, name -->
|by        |name                                                                 |
|--|--|
|Yogi Berra|“If you don’t know where you’re going you may not get there.”  #quote|
<!-- /query -->

## data
You can also embed arbitrary YAML data blocks in pages via fencded code blocks using the `data` language, for which you can optionally define a (single) tag, by using `data:tag`, e.g.

```data:person
name: Pete
age: 55
```

Which then becomes queryable via `person`:
<!-- #query person -->
|ref         |tags  |name|age|pos |page   |
|------------|------|----|--|----|-------|
|Objects@3267|person|Pete|55|3267|Objects|
<!-- /query -->

## link
All page _links_ are tagged with `link`. You cannot attach additional tags to links. The main two attributes of a link are:

* `toPage` the page the link is linking _to_
* `page` the page the link appears on

In addition, the `snippet` attribute attempts to capture a little bit of context on where the link appears.

_Note_: this is the data source used for the {[Mentions: Toggle]} feature as well page {[Page: Rename]}.

Here is an query that shows all links that appear in this particular page:

<!-- #query link where page = "{{@page.name}}" and inDirective = false -->
|ref         |tags|toPage            |snippet                                             |pos |page   |inDirective|asTemplate|
|--|--|--|--|--|--|--|--|
|Objects@1274|link|Frontmatter       |in the `tags` attribute [[Frontmatter]], or by putti|1274|Objects|false|false|
|Objects@1316|link|Tags              |r by putting additional [[Tags]] in the _first parag|1316|Objects|false|false|
|Objects@137 |link|🔌 Directive/Query|sequently allows you to [[🔌 Directive/Query]] this |137 |Objects|false|false|
|Objects@237 |link|🔌 Index          |ex is maintained by the [[🔌 Index]] plug.          |237 |Objects|false|false|
|Objects@2493|link|template/task     |-- #query upnext render [[template/task]] -->       |2493|Objects|false|true |
|Objects@283 |link|Attributes        |ery object has a set of [[Attributes]]:             |283 |Objects|false|false|
|Objects@6250|link|Attributes        |ch is used to index all [[Attributes]] used in your |6250|Objects|false|false|
|Objects@746 |link|Attributes        |tag-specific and custom [[Attributes]].             |746 |Objects|false|false|
<!-- /query -->

## anchor
$myanchor
Anchors use the `$myanchor` notation to allow deeplinking into a page and are also indexed and queryable. It is not possible to attach additional tags to an anchor.

Here is an example query:

<!-- #query anchor where page = "{{@page.name}}"-->
|ref             |tags  |name    |page   |pos |
|----------------|------|--------|-------|----|
|Objects@myanchor|anchor|myanchor|Objects|5219|
|Objects@tags    |anchor|tags    |Objects|768 |
<!-- /query -->

## tag
The ultimate meta tag is _tag_ itself, which indexes all tags used, in which page and what their “parent tag” is (the context in which the tag is used).

Here are the tags used/defined in this page:

<!-- #query tag where page = "{{@page.name}}" -->
|ref     |tags|name    |page   |parent|
|--------|---|--------|-------|----|
|meta-tag|tag|meta-tag|Objects|page|
|person  |tag|person  |Objects|data|
|quote   |tag|quote   |Objects|item|
|upnext  |tag|upnext  |Objects|task|
<!-- /query -->

## attribute
This is another meta tag, which is used to index all [[Attributes]] used in your space. This is used by e.g. attribute completion in various contexts. You likely don’t need to use this tag directly, but it’s there.

<!-- #query attribute where page = "{{@page.name}}" limit 1 -->
|ref                 |tags     |tag     |name       |attributeType|page   |
|--------------------|---------|--------|-----------|------|-------|
|meta-tag:contentType|attribute|meta-tag|contentType|string|Objects|
<!-- /query -->

#meta-tag

SilverBullet automatically builds and maintains an index of _objects_ extracted from all markdown pages in your space. It subsequently allows you to [[Query]] this database in (potentially) useful ways.

Some examples of things you can query for:
* Give me a list of all books that I have marked as _want to read_
* Give me a list of all tasks not yet completed that have today as a due date
* Give me a list of items tagged with `#quote`
* Give me a list of not-completed tasks that reference the current page

By design, the truth remains in the markdown: all data indexed into objects will have a representation in markdown text as well. The index can be flushed at any time and be rebuilt from markdown files.

# Object representation
Every object has a set of [[Attributes]]:
* `ref`: a unique _identifier_ (unique to the page, at least), often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `task` will use `page@pos` (where `pos` is the location the task appears in `page`).
* `tags`: an array of type(s) of an object, see [[@tags]].
* Any number of additional tag-specific and custom [[Attributes]].

# Tags
$tags
Every object has one or more tags, defining the types of an object. Some tags are built-in (as described below), but you can easily define new tags by simply using the #hashtag notation in strategic locations (more on these locations later).

Here are the currently built-in tags:

## page
Every page in your space is available via the `page` tag. You can attach _additional tags_ to a page, by either specifying them in the `tags` attribute [[Frontmatter]], or by putting additional [[Tags]] in the _first paragraph_ of your page, as is done in this particular page with a #meta-tag.

In addition to `ref` and `tags`, the `page` tag defines a bunch of additional attributes as can be seen in this example query:

<!-- #query page where name = "{{@page.name}}" -->
|ref    |tags         |name   |size|contentType  |lastModified            |perm|
|--|--|--|--|--|--|--|
|Objects|page,meta-tag|Objects|8080|text/markdown|2023-09-28T18:46:08.677Z|rw|
<!-- /query -->

Since we’ve tagged this page with #meta-tag, we can also query `meta-tag` as a source:

<!-- #query meta-tag -->
|ref    |tags         |name   |size|contentType  |lastModified            |perm|
|--|--|--|--|--|--|--|
|Objects|page,meta-tag|Objects|8080|text/markdown|2023-09-28T18:46:08.677Z|rw|
<!-- /query -->

## task
Every task in your space is tagged with the `task` tag by default. You tag it with additional tags by using [[Tags]] in the task name, e.g.

* [ ] My task #upnext 

And can then be queried via either `task` or `upnext`. 

The following query shows all attributes available for tasks:

<!-- #query upnext -->
|ref         |tags       |name           |done |page   |pos |state|
|------------|-----------|---------------|-----|-------|----|-|
|Objects@2709|task,upnext|My task #upnext|false|Objects|2709| |
<!-- /query -->

Although you may want to render it using a template such as [[template/task]] instead:

<!-- #query upnext render [[template/task]] -->
* [ ] [[Objects@2709]] My task #upnext
<!-- /query -->

## item
List items are not currently indexed unless explicitly tagged (for performance reasons). Like other things, an an item can be tagged using [[Tags]].

Here is an example of a #quote item using a custom [[Attributes|attribute]]:

* “If you don’t know where you’re going you may not get there.” [by: Yogi Berra] #quote

And then queried via the #quote tag:

<!-- #query quote select by, name -->
|by        |name                                                                 |
|--|--|
|Yogi Berra|“If you don’t know where you’re going you may not get there.”  #quote|
<!-- /query -->

## data
You can also embed arbitrary YAML data blocks in pages via fenced code blocks and use a tag as a coding language, e.g.

```#person
name: Pete
age: 55
```

Which then becomes queriable via the `person` tag:

<!-- #query person -->
|ref         |tags  |name|age|pos |page   |
|------------|------|----|--|----|-------|
|Objects@3999|person|Pete|55|3999|Objects|
<!-- /query -->

## link
All page _links_ are tagged with `link`. You cannot attach additional tags to links. The main two attributes of a link are:

* `toPage` the page the link is linking _to_
* `page` the page the link appears on

In addition, the `snippet` attribute attempts to capture a little bit of context on where the link appears.

_Note_: this is the data source used for the {[Mentions: Toggle]} feature as well page {[Page: Rename]}.

Here is an query that shows all links that appear in this particular page:

<!-- #query link where page = "{{@page.name}}" and inDirective = false -->
|ref         |tags|toPage            |snippet                                             |pos |page   |inDirective|asTemplate|alias    |
|--|--|--|--|--|--|--|--|--|
|Objects@1190|link|                  |pe(s) of an object, see [[@tags]].                  |1190|Objects|false|false|         |
|Objects@1252|link|Attributes        |tag-specific and custom [[Attributes]].             |1252|Objects|false|false|         |
|Objects@162 |link|🔌 Directive/Query|sequently allows you to [[Query]] this |162 |Objects|false|false|         |
|Objects@1724|link|Frontmatter       |in the `tags` attribute [[Frontmatter]], or by putti|1724|Objects|false|false|         |
|Objects@1766|link|Tags              |r by putting additional [[Tags]] in the _first parag|1766|Objects|false|false|         |
|Objects@2676|link|Tags              |dditional tags by using [[Tags]] in the task name, e|2676|Objects|false|false|         |
|Objects@3149|link|template/task     |sing a template such as [[template/task]] instead:  |3149|Objects|false|false|         |
|Objects@3203|link|template/task     |-- #query upnext render [[template/task]] -->       |3203|Objects|false|true |         |
|Objects@3428|link|Tags              |tem can be tagged using [[Tags]].                   |3428|Objects|false|false|         |
|Objects@3490|link|Attributes        |ote item using a custom [[Attributes\|attribute]]:  |3490|Objects|false|false|attribute|
|Objects@6570|link|Anchors           |[[Anchors]] use the `$myanch                        |6570|Objects|false|false|         |
|Objects@7593|link|Attributes        |ch is used to index all [[Attributes]] used in your |7593|Objects|false|false|         |
|Objects@791 |link|Attributes        |ery object has a set of [[Attributes]]:             |791 |Objects|false|false|         |
<!-- /query -->

## anchor
$myanchor

[[Anchors]] use the `$myanchor` notation to allow deeplinking into a page and are also indexed and queryable. It is not possible to attach additional tags to an anchor.

Here is an example query:

<!-- #query anchor where page = "{{@page.name}}"-->
|ref             |tags  |name    |page   |pos |
|----------------|------|--------|-------|----|
|Objects@myanchor|anchor|myanchor|Objects|6557|
|Objects@tags    |anchor|tags    |Objects|1274|
<!-- /query -->

## tag
The ultimate meta tag is _tag_ itself, which indexes for all tags used, in which page they appear and what their “parent tag” is (the context of the tag: either `page`, `item` or `task`).

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

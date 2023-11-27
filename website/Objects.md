#core

SilverBullet automatically builds and maintains an index of _objects_ extracted from all markdown pages in your space. It subsequently allows you to [[Live Queries|query]] this database in (potentially) useful ways.

Some examples of things you can query for:
* Give me a list of all books that I have marked as _want to read_
* Give me a list of all tasks not yet completed that have today as a due date
* Give me a list of items tagged with `#quote`
* Give me a list of not-completed tasks that reference the current page

By design, the truth remains in the markdown: all data indexed as objects will have a representation in markdown text as well. The index can be flushed at any time and be rebuilt from its source markdown files kept in your space.

# Object representation
Every object has a set of [[Attributes]].

At the very least:
* `ref`: a unique _identifier_ (unique to the page, at least), often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `task` will use `page@pos` (where `pos` is the location the task appears in `page`).
* `tags`: an array of type(s) of an object, see [[@tags]].

In addition, any number of additional tag-specific and custom [[Attributes]] can be defined (see below).

# Tags
$tags
Every object has one or more tags, defining the types of an object. Some tags are built-in (as described below), but you can easily define new tags by simply using the #hashtag notation in strategic locations (more on these locations later).

Here are the currently built-in tags:

## page
$page
Every page in your space is available via the `page` tag. You can attach _additional tags_ to a page, by either specifying them in the `tags` attribute [[Frontmatter]], or by putting additional [[Tags]] in the _first paragraph of your page_, as is done with the #core tag at the beginning of this page.

In addition to `ref` and `tags`, the `page` tag defines a bunch of additional attributes as can be seen in this example query:

```query
page where name = "{{@page.name}}"
```

## task
$task
Every task in your space is tagged with the `task` tag by default. You tag it with additional tags by using [[Tags]] in the task name, e.g.

* [ ] My task #upnext 

And can then be queried via either `task` or `upnext`. 

The following query shows all attributes available for tasks:

```query
upnext
```
Although you may want to render it using a template such as [[template/tasks/task] instead:

```query
upnext render [[template/task]]
```

## taskstate
[[🔌 Tasks]] support the default `x` and ` ` states (done and not done), but custom states as well. Custom states used across your space are kept in `taskstate`:

* [NOT STARTED] Task 1
* [IN PROGRESS] Task 2

And can be queried as follows:

```query
taskstate where page = "{{@page.name}}"
```

## template
$template
Indexes all pages tagged with `#template`. Technically this is not a built-in, but we’ll list it here anyway. See [[Templates]] for more information on templates.

```query
template
```


## item
$item
List items (both bullet point and numbered items) are indexed by default with the `item` tag, and additional tags can be added using [[Tags]].

Here is an example of a #quote item using a custom [[Attributes|attribute]]:

* “If you don’t know where you’re going you may not get there.” [by: Yogi Berra] #quote

And then queried via the #quote tag:

```query 
quote where tags = "item" select name, by
```

## paragraph
$paragraph
Top-level paragraphs (that is: paragraphs not embedded in a list) are indexed using the `paragraph` tag, any additional tags can be added using [[Tags]].

A paragraph with a #paragraph-tag.

```query
paragraph-tag
```

## data
$data
You can also embed arbitrary YAML data blocks in pages via fenced code blocks and use a tag as a coding language, e.g.

```#person
name: Pete
age: 55
```

Which then becomes queriable via the `person` tag:

```query
person 
```

## link
$link
All page _links_ are tagged with `link`. You cannot attach additional tags to links. The main two attributes of a link are:

* `toPage` the page the link is linking _to_
* `page` the page the link appears on

In addition, the `snippet` attribute attempts to capture a little bit of context on where the link appears.

_Note_: this is the data source used for the {[Mentions: Toggle]} feature as well page {[Page: Rename]}.

Here is a query that shows all links that appear in this particular page:

```query
link where page = "{{@page.name}}" and inDirective = false 
```

## anchor
$anchor

[[Anchors]] use the `$myanchor` notation to allow deeplinking into a page and are also indexed and queryable. It is not possible to attach additional tags to an anchor.

Here is an example query:

```query
anchor where page = "{{@page.name}}"
```

## tag
$tag
The ultimate meta tag is _tag_ itself, which indexes for all tags used, in which page they appear and what their “parent tag” is (the context of the tag: either `page`, `item` or `task`).

Here are the tags used/defined in this page:

```query
tag where page = "{{@page.name}}" 
```

## attribute
$attribute
This is another meta tag, which is used to index all [[Attributes]] used in your space. This is used by e.g. attribute completion in various contexts. You likely don’t need to use this tag directly, but it’s there.

```query
attribute where page = "{{@page.name}}" limit 1 
```

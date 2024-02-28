SilverBullet automatically builds and maintains an index of _objects_ extracted from all markdown pages in your space. It subsequently allows you to [[Live Queries|query]] this database in (potentially) useful ways.

By design, the truth remains in the markdown: all data indexed as objects will have a representation in markdown text as well. This index can be flushed at any time and be rebuilt from its source markdown files kept in your space (and you can do so on demand if you like using the {[Space: Reindex]} command).

# Object representation
Every object has a set of [[Attributes]], some predefined, but you can add any additional custom attributes that you like.

The following attributes are predefined, and you can expect all objects to have them:
* `ref`: a globally unique _identifier_, often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `task` will use `page@pos` (where `pos` is the location the task appears in `page`).
* `tag`: the main type, or “tag” of the page, usually a built-in type of the object (see below).

In addition, many objects will also contain:
* `tags`: an optional set of additional, explicitly assigned tags.
* `itags`: a set of _implicit_ or _inherited_ tags: including the object’s `tag`, `tags` as well as any tags _assigned to its containing page_. This is useful to answer queries like, “give me all tasks on pages where that page is tagged with `person`“, which would be expressed as `task where itags = "person"` (although technically that would also match any tags that have the `#person` explicitly assigned).

Beside these, any number of additional tag-specific and custom [[Attributes]] can be defined (see below).

# Tags
Every object has a main `tag`, which signifies the type of object being described. In addition, any number of additional tags can be assigned as well via the `tags` attribute. You can use either the main `tag` or any of the `tags` as query sources in [[Live Queries]] — examples below.

Here are the currently built-in tags:

## page
Every page in your space is available via the `page` tag. You can attach _additional_ tags to a page, by either specifying them in the `tags` attribute [[Frontmatter]], or by putting additional [[Tags]] in a stand alone paragraph with no other (textual) content in them, e.g.:

#example-tag #another-tag

In addition to `ref` and `tags`, the `page` tag defines a bunch of additional attributes as can be seen in this example query:

```query
page where name = @page.name
```

Note that you can also query this page using the `example-tag` directly:

```query
example-tag
```

## table
Markdown table rows are indexed using the `table` tag, any additional tags can be added using [[Tags]] in any of its cells.

| Title | Description Text |
| --- | ----- |
| This is some key | The value contains a #table-tag |
| Some Row | This is an example row in between two others |
| Another key | This time without a tag |


```query
table
```

Table headers will be normalized by converting them to lowercase and replacing all non alphanumeric characters with `_`.

## task

task
Every task in your space is tagged with the `task` tag by default. You tag it with additional tags by using [[Tags]] in the task name, e.g.

* [ ] My task #upnext 

And can then be queried via either `task` or `upnext`. 

The following query shows all attributes available for tasks:

```query
upnext
```

Although you may want to render it using a template such as [[Library/Core/Query/Task]] instead:

```query
upnext render [[Library/Core/Query/Task]]
```

## taskstate
[[Plugs/Tasks]] support the default `x` and ` ` states (done and not done), but custom states as well. Custom states used across your space are kept in `taskstate`:

* [NOT STARTED] Task 1
* [IN PROGRESS] Task 2

And can be queried as follows:

```query
taskstate where page = @page.name
```

## template
Indexes all pages tagged with `#template`. See [[Templates]] for more information on templates.

```query
template select name limit 5
```


## item
List items (both bullet point and numbered items) are indexed with the `item` tag, and additional tags can be added using [[Tags]].

Here is an example of a #quote item using a custom [[Attributes|attribute]]:

* “If you don’t know where you’re going you may not get there.” [by: Yogi Berra] #quote

And then queried via the #quote tag:

```query 
quote where page = @page.name and tag = "item" select name, by
```

## paragraph
Top-level paragraphs (that is: paragraphs not embedded in a list) are indexed using the `paragraph` tag, any additional tags can be added using [[Tags]].

A paragraph with a #paragraph-tag.

```query
paragraph-tag
```

## data
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
All page _links_ are tagged with `link`. You cannot attach additional tags to links. The main two attributes of a link are:

* `toPage` the page the link is linking _to_
* `page` the page the link appears on

In addition, the `snippet` attribute attempts to capture a little bit of context on where the link appears.

_Note_: this is the data source used for the {[Mentions: Toggle]} feature as well page {[Page: Rename]}.

Here is a query that shows all links that appear in this particular page:

```query
link where page = @page.name
```

## anchor
[[Markdown/Anchors]] use the $myanchor notation to allow deeplinking into a page and are also indexed and queryable. It is not possible to attach additional tags to an anchor.

Here is an example query:

```query
anchor where page = @page.name
```

## header
Headers (lines starting with `#`, `##` etc.) are indexed as well and queriable.

```query
header where page = @page.name limit 3
```


## tag
The ultimate meta tag is _tag_ itself, which indexes for all tags used, in which page they appear and what their “parent tag” is (the context of the tag: either `page`, `item` or `task`).

Here are the tags used/defined in this page:

```query
tag where page = @page.name select name, parent
```

## attribute
This is another meta tag, which is used to index all [[Attributes]] used in your space. This is used by e.g. attribute completion in various contexts. You likely don’t need to use this tag directly, but it’s there.

```query
attribute where page = @page.name limit 1 
```

# System tags
The following tags are technically implemented a bit differently than the rest, but they are still available to be queried.

## command
Enables querying of all [[Commands]] available in SilverBullet as well as their assigned keyboard shortcuts.
```query
command order by name limit 5
```

## syscall
Enables querying of all [[PlugOS]] syscalls enabled in your space. Mostly useful in the context of [[Plugs]] and [[Space Script]] development.

```query
syscall limit 5
```


SilverBullet automatically builds and maintains an index of _objects_ extracted from all [[Markdown]] [[Pages]] in your [[Spaces]]. It subsequently allows you to use [[Space Lua/Lua Integrated Query]] to query this database in (potentially) useful ways.

By design, the truth remains in the markdown: all data indexed as objects will have a representation in markdown text as well. This index can be flushed at any time and be rebuilt from its source markdown files kept in your space (and you can do so on demand if you like using the `Space: Reindex` command).

# Object representation
Every object has a set of [[Attributes]], some predefined, but you can add any additional custom attributes that you like.

The following attributes are predefined, and you can expect all objects to have them:
* `ref`: a globally unique _identifier_, often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `task` will use `page@pos` (where `pos` is the location the task appears in `page`).
* `tag`: the main type, or “tag” of the object, usually a built-in type (see below for a list).

In addition, many objects will also contain:
* `tags`: an optional set of additional, explicitly assigned tags.
* `itags`: a set of _implicit_ or _inherited_ tags: including the object’s `tag`, `tags` as well as any tags _assigned to its containing page_. This is useful to answer queries like, “give me all tasks on pages where that page is tagged with `person`“, which would be expressed as `query[[from index.tag "task" where table.includes(_.itags, "person")]]` (although technically that would also match any tags that have the `#person` explicitly assigned).

Beside these, any number of additional tag-specific and custom [[Attributes]] can be defined (see below).

# Tags
Every object has a main `tag`, which signifies the type of object being described. In addition, any number of additional tags can be assigned as well via the `tags` attribute. You can use either the main `tag` or any of the `tags` as query sources in [[Space Lua/Lua Integrated Query]] — examples below.

# Built-in tags
## page
Every page in your space is available via the `page` tag. You can attach _additional_ tags to a page, by either specifying them in the `tags` attribute [[Frontmatter]], or by putting additional [[Tags]] in a stand alone paragraph with no other (textual) content in them.

In addition to `ref` and `tags`, the `page` tag defines a bunch of additional attributes as can be seen in this example query:

${query[[from index.tag "page" where name == _CTX.currentPage.name]]}

Note that you can also query this page using the `level/intermediate` directly:
${query[[from index.tag "level/intermediate"]]}

## aspiring-page
[[Aspiring Pages]] are pages that are linked to, but not yet created.

${query[[from index.tag "aspiring-page"]]}

## table
Markdown table rows are indexed using the `table` tag, any additional tags can be added using [[Tags]] in any of its cells.

| Title | Description Text |
| --- | ----- |
| This is some key | The value contains a #table-tag |
| Some Row | This is an example row in between two others |
| Another key | This time without a tag |

${query[[from index.tag "table" where page == _CTX.currentPage.name]]}

Table headers will be normalized by converting them to lowercase and replacing all non alphanumeric characters with `_`.

## item
List items (both bullet point and numbered items) are indexed with the `item` tag, and additional tags can be added using [[Tags]].

Here is an example of a #quote item using a custom [[Attributes|attribute]]:

* “If you don’t know where you’re going you may not get there.” [by: Yogi Berra] #quote

And then queried via the #quote tag:
${query[[
  from index.tag "quote"
  where table.includes(itags, "item")
]]}

When items are nested, they will contain a `parent` attrite with a reference to their parent. In addition, `itags` will also inherit their ancestors’ tags. For instance:

* Root item #root-tag
  * Sub item #sub-tag
    * Leaf item

The `Leaf item` will be indexed as follows:
${query[[
  from index.tag "item"
  where page == _CTX.currentPage.name
  and name == "Leaf item"
  select {name=name, parent=parent, itags=itags}
]]}

## task
Every task in your space is tagged with the `task` tag by default. You tag it with additional tags by using [[Tags]] in the task name, e.g.

* [ ] My task #upnext 

And can then be queried via either `task` or `upnext`. 

The following query shows all attributes available for tasks:

${query[[from index.tag "upnext"]]}

Although you may want to render it using a template instead:

${template.each(query[[from index.tag "upnext"]], templates.taskItem)}

Similar to [[#item]], `task` objects have a `parent` attribute when nested (pointing to their parent `item`), and inherit their ancestor’s tags in `itags`.

## taskstate
[[Tasks]] support the default `x` and ` ` states (done and not done), but custom states as well. Custom states used across your space are kept in `taskstate`:

* [NOT STARTED] Task 1
* [IN PROGRESS] Task 2

And can be queried as follows:
${query[[from index.tag "taskstate" where page == _CTX.currentPage.name]]}

## paragraph
Top-level paragraphs (that is: paragraphs not embedded in a list) are indexed using the `paragraph` tag, any additional tags can be added using [[Tags]].

A paragraph with a #paragraph-tag.

${query[[from index.tag "paragraph-tag"]]}

## data
You can also embed arbitrary YAML data blocks in pages via fenced code blocks and use a tag as a coding language, e.g.

```#contact
name: Pete
age: 55
```

Which then becomes queriable via the `contact` tag:
${query[[from index.tag "contact"]]}

## link
All page _links_ are tagged with `link`. You cannot attach additional tags to links. The main two attributes of a link are:

* `toPage` the page the link is linking _to_
* `page` the page the link appears on

In addition, the `snippet` attribute attempts to capture a little bit of context on where the link appears.

Here is a query that shows some links that appear in this particular page:

${query[[from index.tag "link" where page == _CTX.currentPage.name limit 5]]}

## header
Headers (lines starting with `#`, `##` etc.) are indexed as well and queriable.

${query[[from index.tag "header" where page == _CTX.currentPage.name limit 3]]}

## tag
The ultimate meta tag is _tag_ itself, which indexes for all tags used, in which page they appear and what their “parent tag” is (the context of the tag: either `page`, `item` or `task`).

Here are the tags used/defined in this page:

${query[[from index.tag "tag" where page == _CTX.currentPage.name select {name=name, parent=parent}]]}

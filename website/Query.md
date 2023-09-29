`#query` is the most widely used [[🔌 Directive]]. It can be used to query various data sources as well as [[Objects]] and render results either as a table or using a [[🔌 Template]].

### Syntax

    <!-- #query your-query-here -->
    query result materialized in place
    <!-- /query -->

It’s recommended to use the `/query` slash command to insert a query in a page.

For those comfortable reading 
[query grammar](https://github.com/silverbulletmd/silverbullet/blob/main/common/markdown_parser/query.grammar).

#### 2.1. Available query operators:

- `=` equals
- `!=` not equals
- `<` less than
- `<=` less than or equals
- `>` greater than
- `>=` greater than or equals
- `=~` to match against a regular expression
- `!=~` does not match this regular expression
- `in` member of a list (e.g. `prop in ["foo", "bar"]`)

Further, you can combine multiple of these with `and`. Example
`prop =~ /something/ and prop != “something”`.

### 3. How to run a query?
After writing the query, there are three options:

1. Open the **command palette** and run {[Directives: Update]}
2. Use shortcut: hit **Alt-q** (Windows, Linux) or **Option-q** (Mac)
3. Go to another page and come back to the page where the query is located, it always updates when a page is loaded

After using one of the options, the “body” of the query is replaced with the new results of the query data will be displayed.

### 4. Data sources

Available data sources can be categorized as:

1. Builtin data sources
2. Data that can be inserted by users
3. Plug’s data sources

The best part about data sources: there is auto-completion. 🎉

Start writing `<!— #query` or simply use `/query` slash command, it will show you all available data sources. 🤯

Additionally there are [[🔌 Template@vars|special variables]] you can use in your queries. 

For example, if you wanted a query for all the tasks from a previous day's daily note, you could use the following query: 
`<!-- #query task where page = "📅 {{yesterday}}" -->`

#### 4.1. Available data sources

- `page`: list of all pages
- `attachment`: list of all attachments
- `task`: list of all tasks (created with `[ ]`) across all pages
- `full-text`: use it with `where phrase = "SOME_TEXT"`. List of all pages where `SOME_TEXT` is mentioned
- `item`: list of ordered and unordered items such as bulleted lists across all pages
- `tag`: list of all hashtags used in all pages
- `link`: list of all pages giving a link to the page where query is written
- `data`: You can insert data using the syntax below. You can query the data using the `data` source, or define a custom data source by using `data:customdatatype` instead of plain `data`.

```data
name: John
age: 50
city: Milan
country: Italy
---
name: Jane
age: 53
city: Rome
country: Italy
---
name: Francesco
age: 28
city: Berlin
country: Germany
```

Example:
<!-- #query data where age > 20 and country = "Italy" -->
|ref       |tags|name|age|city |country|pos |page |
|----------|----|----|--|-----|-----|----|-----|
|Query@3012|data|John|50|Milan|Italy|3012|Query|
|Query@3013|data|Jane|53|Rome |Italy|3013|Query|
<!-- /query -->

#### 4.2 Plugs’ data sources

Certain plugs can also provide special data sources to query specific data. Some examples are:

- [[🔌 Github]] provides `gh-pull` to query PRs for selected repo
- [[🔌 Mattermost]] provides `mm-saved` to fetch (by default 15) saved posts in
  Mattermost

For a complete list of data sources, please check plugs’ own pages.

### 5. Templates

Templates are predefined formats to render the body of the query.

#### 5.1 How to create a template?

It is pretty easy. You just need to create a new page. However, it is
recommended to create your templates using `template/[TEMPLATE_NAME]`
convention. For this guide, we will create `template/plug` to display list of Plugs available in SilverBullet. We will use this template in the Examples section below.

#### 5.2 What is the syntax?

We are using Handlebars which is a simple templating language. It is using double curly braces and the name of the parameter to be injected. For our `template/plug`, we are using simple template like below.

    * [[{{name}}]] by **{{author}}** ([repo]({{repo}}))

Let me break it down for you

- `*` is creating a bullet point for each item in SilverBullet
- `[[{{name}}]]` is injecting the name of Plug and creating an internal link to
  the page of the Plug
- `**{{author}}**` is injecting the author of the Plug and making it bold
- `([repo]({{repo}}))` is injecting the name of the Plug and creating an
  external link to the GitHub page of the Plug

For more information on the Handlebars syntax, you can read the
[official documentation](https://handlebarsjs.com/).

#### 5.3 How to use the template?

You just need to add the `render` keyword followed by the link of the template to the query like below:

    <!-- #query page where type = "plug" render [[template/plug]] -->
    <!-- /query-->
`#query page where type = "plug" render [[template/plug]]`

You can see the usage of our template in example 6.4 below.

### 6. Examples

We will walk you through a set of examples starting from a very basic one
through one formatting the data using templates.

Our goal in this exercise is to (i) get all plug pages (ii) ordered by last modified time and (iii) display in a nice format.

For the sake of simplicity, we will use the `page` data source and limit the results not to spoil the page.

#### 6.1 Simple query without any condition

**Goal:** We would like to get the list of all pages.

**Result:** Look at the data. This is more than we need. The query even gives us template pages. Let's try to limit it in the next step.

<!-- #query page limit 3 -->
|ref       |tags|name      |size|contentType  |lastModified            |perm|pageAttribute|
|--|--|--|--|--|--|--|--|
|API       |page|API       |2200|text/markdown|2023-08-16T13:07:40.028Z|rw|     |
|Anchors   |page|Anchors   |190 |text/markdown|2023-09-28T18:48:54.138Z|rw|     |
|Attributes|page|Attributes|1596|text/markdown|2023-09-26T16:07:40.979Z|rw|hello|
<!-- /query -->


#### 6.2 Simple query with a condition

**Goal:** We would like to get all plug pages sorted by last modified time.

**Result:** Okay, this is what we wanted but there is also information such as `perm`, `type` and `lastModified` that we don't need.

<!-- #query page where type = "plug" order by lastModified desc limit 5 -->
|ref         |tags|name        |size|contentType  |lastModified            |perm|type|repo                                                    |uri                                                           |author        |share-support|
|--|--|--|--|--|--|--|--|--|--|--|--|
|🔌 Directive|page|🔌 Directive|2585|text/markdown|2023-09-28T18:53:11.738Z|rw|plug|https://github.com/silverbulletmd/silverbullet          |                                                              |              |    |
|🔌 Editor   |page|🔌 Editor   |2205|text/markdown|2023-08-29T12:49:32.016Z|rw|plug|https://github.com/silverbulletmd/silverbullet          |                                                              |              |    |
|🔌 Ghost    |page|🔌 Ghost    |1733|text/markdown|2023-08-04T08:32:02.296Z|rw|plug|https://github.com/silverbulletmd/silverbullet-ghost    |github:silverbulletmd/silverbullet-ghost/ghost.plug.js        |Zef Hemel     |true|
|🔌 Backlinks|page|🔌 Backlinks|951 |text/markdown|2023-05-26T12:32:34.899Z|rw|plug|https://github.com/silverbulletmd/silverbullet-backlinks|github:silverbulletmd/silverbullet-backlinks/backlinks.plug.js|Guillermo Vayá|    |
|🔌 Emoji    |page|🔌 Emoji    |155 |text/markdown|2023-02-11T13:16:46.528Z|rw|plug|https://github.com/silverbulletmd/silverbullet          |                                                              |              |    |
<!-- /query -->

#### 6.3 Query to select only certain fields

**Goal:** We would like to get all plug pages, selecting only `name`, `author`
and `repo` columns and then sort by last modified time.

**Result:** Okay, this is much better. However, I believe this needs a touch
from a visual perspective.

<!-- #query page select name, author, repo where type = "plug" order by lastModified desc limit 5 -->
|name        |repo                                                    |author        |
|--|--|--|
|🔌 Directive|https://github.com/silverbulletmd/silverbullet          |              |
|🔌 Editor   |https://github.com/silverbulletmd/silverbullet          |              |
|🔌 Ghost    |https://github.com/silverbulletmd/silverbullet-ghost    |Zef Hemel     |
|🔌 Backlinks|https://github.com/silverbulletmd/silverbullet-backlinks|Guillermo Vayá|
|🔌 Emoji    |https://github.com/silverbulletmd/silverbullet          |              |
<!-- /query -->

#### 6.4 Display the data in a format defined by a template

**Goal:** We would like to display the data from step 5.3 in a nice format using bullet points with links to Plug pages, with the author name and a link to their GitHub repo.

**Result:** Here you go. This is the result we would like to achieve 🎉. Did you see how I used `render` and `template/plug` in a query? 🚀

<!-- #query page where type = "plug" order by lastModified desc limit 5 render [[template/plug]] -->
* [[🔌 Directive]] 
* [[🔌 Editor]] 
* [[🔌 Ghost]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-ghost))
* [[🔌 Backlinks]] by **Guillermo Vayá** ([repo](https://github.com/silverbulletmd/silverbullet-backlinks))
* [[🔌 Emoji]]
<!-- /query -->

PS: You don't need to select only certain fields to use templates. Templates are
smart enough to get only the information needed to render the data. Therefore,
the following queries are the same in terms of end result when using the
templates.

    <!-- #query page select name author repo uri where type = "plug" order by lastModified desc limit 5 render [[template/plug]] -->

and:

    <!-- #query page where type = "plug" order by lastModified desc limit 5 render [[template/plug]] -->

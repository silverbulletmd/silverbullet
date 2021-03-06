```meta
type: plug
uri: core:query
repo: https://github.com/silverbulletmd/silverbullet
author: Silver Bullet Authors
```

### 1. What?
The query plug is a built-in plug implementing the `<!-- #query -->` mechanism. You can use query plug to automatically receive information from your pages.

### 2. Syntax
1. _start with_: `<!-- #query [QUERY GOES HERE] -->`
2. _end with_: `<!-- /query -->`
3. _write your query_: replace `[QUERY GOES HERE]` with any query you want using options below
4. _available query options_: Usage of options is similar to SQL except special `render` option. Render option is to use display the data in a format that you created in a separate template
   * `where`
   * `order by`
   * `limit`
   * `select`
   * `render`

P.S.: If you are a developer or have a technical knowledge to read a code and would like to know more about syntax, please check out [query grammar](https://github.com/silverbulletmd/silverbullet/blob/main/packages/plugs/query/query.grammar).

### 3. How to run a query?
After writing the query, there are three options:
* Open the **command palette** and run **Materialized Queries: Update**
* Use shortcut: hit **Alt-q** (Windows, Linux) or **Option-q** (Mac)
* Go to another page and come back to the page where query is located

After using one of the options, the âbodyâ of the query is replaced with the new results of the query data will be displayed.

### 4. Data sources
Available data sources can be categorized as:
1. Builtin data sources
2. Data that can be inserted by users
3. Plugâs data sources

Best part about data sources: there is an auto completion. ð 

Start writing `<!â #query ` or simply use `/query` slash command, it will show you all available data sources. ð¤¯

#### 4.1. Available data sources
* `page`: list of all pages ð
* `task`: list of all tasks created with `[]` syntax â
* `full-text`: use it with `where phrase = "SOME_TEXT"`. List of all pages where `SOME_TEXT` is mentioned âï¸
* `item`: list of ordered and unordered items such as bulleted lists âºï¸
* `tags`: list of all hashtags used in all pages â¡
* `link`: list of all pages giving a link to the page where query is written ð
* `data`: You can insert a data using the syntax below ð¥ï¸. You can query the data using `data` option. 
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
<!-- #query data where age > 20 and country = "Italy" -->
|name|age|city |country|page           |pos |
|----|--|-----|-----|---------------|----|
|John|50|Milan|Italy|ð Query       |2198|
|Jane|53|Rome |Italy|ð Query       |2244|
<!-- /query -->
 
#### 4.2 Plugsâ data sources
Certain plugs can also provide special data sources to query a certain data. Some examples are 
* [[ð Github]] provides `gh-pull` to query PRs for selected repo
* [[ð Mattermost]] provides `mm-saved` to fetch (by default 15) saved posts in Mattermost

For complete list of data sources, please check plugsâ pages.

### 5. Examples
We will walk you through a set of examples starting from very basic one until to format the data using templates. 

Our goal in this exercise is to (i) get all plug pages (ii) ordered by last modified time and (iii) display in a nice format.

For the sake of simplicity, we will use `page` data source and limit the results not to spoil the page.

#### 5.1 Simple query without any condition
**Goal:** We would like to get the list of all pages. 

**Result:** Look at the data. This is more than we need. The query even gives us template pages. Lets try to limit it in the next step.
<!-- #query page limit 10 -->
|name             |lastModified |perm|tags |type|uri                                                       |repo                                                 |author        |
|--|--|--|--|--|--|--|--|
|index            |1659178324000|rw|undefined|undefined|undefined                                                 |undefined                                            |undefined     |
|Mattermost Plugin|1659108035000|rw|undefined|undefined|undefined                                                 |undefined                                            |undefined     |
|PLUGS            |1659108634000|rw|undefined|undefined|undefined                                                 |undefined                                            |undefined     |
|Test Data Query  |1659179547000|rw|undefined|undefined|undefined                                                 |undefined                                            |undefined     |
|template/plug    |1659108035000|rw|undefined|undefined|undefined                                                 |undefined                                            |undefined     |
|template/tasks   |1659108035000|rw|#each|undefined|undefined                                                 |undefined                                            |undefined     |
|ð¡ Inspiration   |1659108035000|rw|undefined|undefined|undefined                                                 |undefined                                            |undefined     |
|ð Backlinks     |1659108035000|rw|undefined|plug|ghr:Willyfrog/silverbullet-backlinks                      |https://github.com/Willyfrog/silverbullet-backlinks  |Guillermo VayÃ¡|
|ð Ghost         |1659108035000|rw|undefined|plug|github:silverbulletmd/silverbullet-ghost/ghost.plug.json  |https://github.com/silverbulletmd/silverbullet-ghost |Zef Hemel     |
|ð Git           |1659108035000|rw|undefined|plug|github:silverbulletmd/silverbullet-github/github.plug.json|https://github.com/silverbulletmd/silverbullet-github|Zef Hemel     |
<!-- /query -->

#### 5.2 Simple query with a condition
**Goal:** We would like to get all plug pages and sorted by last modified time.

**Result:** Okay, this what we wanted but there are also information such as perm, type and lastModified that we don't need.

<!-- #query page where type = "plug" order by lastModified desc limit 5 -->
|name         |lastModified |perm|type|uri                                                               |repo                                                     |author               |
|--|--|--|--|--|--|--|
|ð Query     |1659194185345|rw|plug|core:query                                                        |https://github.com/silverbulletmd/silverbullet           |Silver Bullet Authors|
|ð Mattermost|1659111156000|rw|plug|github:silverbulletmd/silverbullet-mattermost/mattermost.plug.json|https://github.com/silverbulletmd/silverbullet-mattermost|Zef Hemel            |
|ð Backlinks |1659108035000|rw|plug|ghr:Willyfrog/silverbullet-backlinks                              |https://github.com/Willyfrog/silverbullet-backlinks      |Guillermo VayÃ¡       |
|ð Ghost     |1659108035000|rw|plug|github:silverbulletmd/silverbullet-ghost/ghost.plug.json          |https://github.com/silverbulletmd/silverbullet-ghost     |Zef Hemel            |
|ð Git       |1659108035000|rw|plug|github:silverbulletmd/silverbullet-github/github.plug.json        |https://github.com/silverbulletmd/silverbullet-github    |Zef Hemel            |
<!-- /query -->


#### 5.3 Query to select only certain fields
**Goal:** We would like to get all plug pages, select only `name`, `author` and `repo` columns and sort by last modified time.

**Result:** Okay, this is much better. However, I believe this needs a touch from a visual perspective.

<!-- #query page select name author repo uri where type = "plug" order by lastModified desc limit 5 -->
|name         |author               |repo                                                     |
|--|--|--|
|ð Query     |Silver Bullet Authors|https://github.com/silverbulletmd/silverbullet           |
|ð Mattermost|Zef Hemel            |https://github.com/silverbulletmd/silverbullet-mattermost|
|ð Backlinks |Guillermo VayÃ¡       |https://github.com/Willyfrog/silverbullet-backlinks      |
|ð Ghost     |Zef Hemel            |https://github.com/silverbulletmd/silverbullet-ghost     |
|ð Git       |Zef Hemel            |https://github.com/silverbulletmd/silverbullet-github    |
<!-- /query -->

#### 5.4 Display the data in a format defined by a template

**Goal:** We would like to display the data from step 5.3 in a nice format using bullet points with links to Plug pages, with author name and link to their GitHub repo. 

**Result:** Here you go. This is the result we would like to achieve ð. Did you see how I used `render` and `template/plug` in a query? ð 

<!-- #query page select name author repo uri where type = "plug" order by lastModified desc limit 5 render "template/plug" -->
* [[ð Query]] by **Silver Bullet Authors** ([repo](https://github.com/silverbulletmd/silverbullet))
* [[ð Mattermost]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-mattermost))
* [[ð Backlinks]] by **Guillermo VayÃ¡** ([repo](https://github.com/Willyfrog/silverbullet-backlinks))
* [[ð Ghost]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-ghost))
* [[ð Git]] by **Zef Hemel** ([repo](https://github.com/silverbulletmd/silverbullet-github))
<!-- /query -->

PS: You don't need select only certain fields to use templates. Templates are smart enough to get only the information needed to render the data. 
Therefore, following queries are same in terms of end result when using the templates.

```yaml
<!-- #query page select name author repo uri where type = "plug" order by lastModified desc limit 5 render "template/plug" -->
```

```yaml
<!-- #query page where type = "plug" order by lastModified desc limit 5 render "template/plug" -->
```

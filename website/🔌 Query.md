```meta
type: plug
uri: core:query
repo: https://github.com/silverbulletmd/silverbullet
author: Silver Bullet Authors
```

### 1. What?
The query plug is a built-in plug implementing the `<!-- #query -->` mechanism. You can use query plug to automatically receive information from your notes.

### 2. Syntax
1. start with: `<!-- #query [QUERY GOES HERE] -->`
2. end with: `<!-- /query -->`
3. write your query: replace `[QUERY GOES HERE]` with any query you want using options below
4. available query options: Usage of options is similar to general query language except special render option. Render option is to use display the data in a format that you created in a separate template
   * `where`
   * `order`
   * `limit`
   * `select`
   * `render`
5. If you are a developer or have a technical knowledge to read a code and would like to know more about syntax please check out [query grammar](https://github.com/silverbulletmd/silverbullet/blob/main/packages/plugs/query/query.grammar)

### 3. How to run a query?
After writing the query, there are two options
* Open the **command palette** and run **Materialized Queries: Update**
* Use shortcut: for windows **Alt-q** and for mac **Option-q**
* Go to another page and come back to the page where query is located

After using one of the options, the data will be displayed.

### 4. Data sources
Available data sources can be categorized as
1. Builtin data sources
2. Data that can be inserted by users
3. Plug’s data sources

Best part about data sources: there is an auto completion 🎉. Start writing `<!— #query `, it will show you all available data sources.  

#### 4.1 Builtin data sources
* `page`: list of all pages
* `task`: list of all tasks created with `[]` syntax
* `full-text`: use it with `where phrase = "SOME_TEXT"`. List of all pages where `SOME_TEXT` is mentioned
* `item`: list of ordered and unordered items such as bulleted lists
* `tags`: list of all hashtags used in all pages
* `link`: list of all pages giving a link to the page where query is written

#### 4.2 Data that can be inserted by users
* *insert the data:* You can insert a data using the syntax below
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
* *query the data:* You can query the data using `data` option
<!-- #query data where age > 20 and country = "Italy" -->
|name|age|city |country|page           |pos |
|----|--|-----|-----|---------------|----|
|John|50|Milan|Italy|Test Data Query|0   |
|Jane|53|Rome |Italy|Test Data Query|46  |
|John|50|Milan|Italy|🔌 Query       |2148|
|Jane|53|Rome |Italy|🔌 Query       |2194|
<!-- /query -->
 
#### 4.3 Plugs’ data sources
Certain plugs can also give you special options to query a certain data. Some examples are 
* [[🔌 Github]] provides `gh-pull` to query PRs for selected repo
* [[🔌 Mattermost]] provides `mm-saved` to fetch (by default 15) saved posts in Mattermost
For complete list of data sources, please check plugs’ pages

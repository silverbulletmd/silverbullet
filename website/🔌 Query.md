```meta
type: plug
uri: core:query
repo: https://github.com/silverbulletmd/silverbullet
author: Silver Bullet Authors
```

### What?
The query plug is a built-in plug implementing the `<!-- #query -->` mechanism. You can use query plug to automatically receive information from your notes.

### Syntax
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

### How to run a query
After writing the query, there are two options
* Open the **command palette** and run **Materialized Queries: Update**
* Use shortcut: for windows **Alt-q** and for mac **Option-q** 

After using one of the options, the data will be displayed.
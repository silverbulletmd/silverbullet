---
description: Answering questions about pages, tasks, tags and attributes with SLIQ queries and search, and putting a live query table in a page. Read before running a query through the lua tool, adding or fixing a query in a page, or when search results seem wrong.
tags: meta/skill
---
Use the `lua` tool to query the space's index: an expression returns its value, so `query[[...]]` on its own works. The syntax is SLIQ (Space Lua Integrated Query); a summary is at the end of this page.

# Sources
| Source | Selection |
| --- | --- |
| `index.pages("project")` | Pages tagged project (no argument: all pages) |
| `index.contentPages()` / `index.toolPages()` | Content pages / tool pages (pages under `Library/`) |
| `index.tasks("work")` | Tasks tagged work |
| `index.items("decision")` | List items tagged decision |
| `index.headers()`, `index.paragraphs()`, `index.tables()`, `index.data()` | Headings, paragraphs, table rows, data-block objects |
| `index.objects("topic")` | Any object carrying that tag |
| `index.tags()` | Tag objects |
| `index.relations("mention")` | Links (`mention`), `@name` mentions (`at-mention`), or attribute edges by key |
| `index.aspiringPages()` | Linked page names that do not exist |

Custom frontmatter is page data; inline attributes belong to the enclosing object. Explicit tags (`tags`) and inherited tags (`itags`) differ.

```lua
query[[
  from p = index.pages("project")
  where p.status == "planning"
  order by p.name
  limit 20
  select {page = p.name, owner = p.owner}
]]
```

Always write `from` with an iterator variable: `from p = index.pages("project")`, then `p.status`, `p.name`.

# Answer from the data
For a question about the space's data (counts, totals, rankings, "which"), query it: one query with `group by` beats reading pages one by one. Pages often already hold the query you need: `read` them with `rendered: true` to get the evaluated results and their links in one call, and follow those links rather than querying again.

# A live table in a page
In page Markdown, a query inside a dollar-brace expression renders as a table and updates by itself when the pages it reads change:

```markdown
${query[[from p = index.pages("book") where p.status == "unread" order by p.name select {Book = markdown.link(p), Author = p.author}]]}
```

The `markdown.link(p)` column makes each name a link to its page (for other objects it links by `ref`). Write this into the page with `write` or `edit`; it is Markdown, not a `space-lua` block. For a list instead of a table, select a template such as `templates.pageItem(p)` (see the Templates page). Reach for a widget only when the table needs a filter box, selection or actions (see Building Interfaces).

Check your work: read the result of the `write`/`edit` (it reports script load errors), then `read` the page with `rendered: true` (evaluated output plus lint problems), then take a `screenshot` when the look matters.

# Fixing a broken query or page
1. Get the actual error first: `read` the page with `rendered: true` (it lists lint problems and failing expressions), or run `space.lint("Page")` with `lua`.
2. Run the failing expression on its own with `lua`, and change one thing at a time.
3. Report the error you saw and the change that fixed it.

Do not call a construct invalid without running it. Existing pages may use forms you would not write yourself: `index.tag "topic"` and `tags.topic` are both aliases of `index.objects("topic")` and valid. Keep them unless they are the cause.

# Why a query fails or returns nothing
* Compare with `==`, never `=`: a single `=` in `where` is a syntax error. Use `~=`, `and`, `or`, `not`, not SQL or JavaScript operators.
* Sample before querying: `query[[from t = index.tasks() limit 3 select t]]` shows the real field names. Custom attributes exist only on some objects; a missing field is null, not an error.
* Always add `limit` while exploring: a bare collection such as `index.pages("book")` returns at most 1000 rows, then a `"<truncated: ...>"` entry, and functions show up as markers like `"<function>"`. Fields you do not see in a sample may exist on other objects, so sample the relevant tag or pages.
* There is no `contains`. Test a substring with `s:find("x", 1, true)` (nil when absent), prefixes and suffixes with `s:startsWith("x")` and `s:endsWith("x")`, and membership with `table.includes(t, value)`.
* Results are distinct: rows equal after `select` appear once. `select {status = t.status}` yields one row per status. Count with `group by` and `#group`, or keep an identifying field such as `ref` in the row.
* `query[[...]]` must be parenthesized before indexing: `(query[[...]])[1]`. A literal `]]` cannot appear inside the brackets; use `query[==[ ... ]==]`.
* The index updates asynchronously. Right after an edit a narrow query may miss it; an empty result from a stale index is not evidence that nothing matches.

Keep `ref` in rows so an answer can point back to its source. If you fall back to reading Markdown because the index is unavailable, say the result comes from reading files, not from an exhaustive index query. A limit gives a partial answer: if completeness matters, count first or page with `order by` plus `limit` and `offset`. Do not put mutations in a query.

# Tasks
Tasks have `done` (true when checked), `state` (the text between the brackets, for custom states) and `page`. There is no built-in due date: spaces usually add an inline attribute such as `[due: "2026-10-01"]`. ISO date strings compare as text, so `where not t.done and t.due and t.due <= date.today()` finds overdue tasks.

# Reading the source and searching
A query result is an index snippet, not the page: to answer from content, `read` the page and quote from it. The index is not full-text search: use the `search` tool for names, phrases and wording, and SLIQ for structure.

Semantic search (meaning, other wording, related pages) is a free feature of Server and Desktop, on in spaces where a model was chosen. Check `search.status()` first (it returns `{backend, model, capabilities = {modes, related}, ready, progress, reason}`, and a `reason` while `ready` is true is a warning, not a failure): semantic search is available when `capabilities.modes` contains `natural`, related pages when `capabilities.related` is true, and `reason` says why not. Do not choose a model, change settings or start a download because it is missing.

```lua
search.find("soil drainage", {mode = "natural", limit = 10})
```

`search.find` and `search.related("Garden Notes", {limit = 10})` return `{items, total, partial, notice}`; each item has `page`, `line`, `heading` and `excerpt`. `pos` is the match's position in the page, and `highlights` are `[start, end]` UTF-16 offsets into `excerpt`. `partial` or `notice` means the index is still building, which is not an empty result. `mode = "words"` (all words) and `mode = "phrase"` (exact phrase) are the full-text modes, offered when `capabilities.modes` lists them (the MCP `search` tool's `semantic` is `natural` here), better for names, codes and exact wording than `natural`; `scope` (`pages`, `meta` or `all`) narrows any of them. `search.related` returns one item per page, best first, and raises an error while related pages are unavailable or when the page is not in the semantic index yet. Always pass the page name: the runtime's current page need not be the one the user sees. Without semantic search, fall back to full-text search or SLIQ and say the coverage is narrower.

# Syntax summary
```lua
query[[
  from p = index.pages("project")      -- required; any collection, also a Lua table
  where p.status ~= "done"             -- filter rows
  group by p.owner                     -- rows become {key, group}
  having #group > 1                    -- filter groups
  order by count desc                  -- asc | desc | using cmp, nulls first|last; commas for more keys
  limit 10, 20                         -- limit n[, offset]; or a separate offset n
  select {owner = key, count = #group}
]]
```

Clauses may come in any order; only `from` is required. `order by` may use an alias from `select` only together with `group by` (as in the example above, wherever `order by` sits relative to `select`); without `group by` the alias is not visible and the sort silently does nothing, so order by the row expression instead (`order by p.size desc select {name = p.name, size = p.size}`). After `group by`, `key` is the group key (a table `{key[1], key[2]}` for several keys) and `group` the array of rows. Aggregates work in `select` and `having`, with or without `group by` (without it the whole result is one group): `count`, `sum`, `min`, `max`, `avg`, `array_agg`, `string_agg` and more (`index.aggregates()` lists them). They take an inner `order by` and a filter: `array_agg(p.name order by p.name)`, `count(p.size) filter(where p.size > 100)`. Projections: `select p.name`, `select {name = p.name}`, `select table.select(p, "name", "tags")`.

Common queries: backlinks with `from r = index.relations("mention") where r.to == "Garden Notes" select r.page`; recent pages with `from p = index.pages() order by p.lastModified desc limit 10 select p.name`. The `Space Lua/Integrated Query` page of the SilverBullet documentation (docs.silverbullet.md; edge.silverbullet.md for Edge builds) has the full reference.

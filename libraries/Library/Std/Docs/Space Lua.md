---
description: Writing, discovering and debugging Space Lua in space-lua blocks (commands, functions, event listeners, config, views). Read before adding or changing a space-lua block, or when one fails to load. Not needed for queries (Querying) or page content (Markdown).
tags: meta/skill
---
Space Lua is SilverBullet's own Lua implementation, broadly compatible with Lua 5.4 and extended with SLIQ queries and the SilverBullet APIs. Ordinary system Lua is not a substitute for testing it. The `lua` tool runs it inside the space's runtime: an expression returns its value, and anything else runs as a script, which should end with `return` to give a result.

# The loop
1. **Discover.** Do not guess API names or signatures. List what exists, then describe a function.
2. **Write.** Put the code in a `space-lua` fence on a page (use `edit` or `write`).
3. **Check your work:** read the result of the `write`/`edit` (it reports script load errors), then `read` the page with `rendered: true` (evaluated output plus lint problems), then take a `screenshot` when the look matters.

A `write` or `edit` (MCP or `sb`) of a page holding `space-lua` or `space-style` reloads the scripts at once, and the result says either that they reloaded without errors or lists the page's load errors and lint problems. You do not need to reboot. After changing files any other way, call `system.reboot()` to reload. Repeat until the result is clean and the page looks right.

# Discover
```lua
spacelua.listFunctions("editor")
```

```lua
spacelua.describe("editor.getText")
```

```lua
spacelua.renderApiDocumentation("editor")
```

`describe` takes a function or dotted function name and returns parameters, results, examples and `see` links. A nil result means the name is not a recognised function, not permission to invent parameters. `listFunctions()` with no argument lists documented global functions, and `table.keys(_G)` lists all global names, namespaces included. Use `system.listCommands()` to see registered commands. `spacelua.describe("editor")` does not describe a namespace; use `listFunctions` or `renderApiDocumentation` for that, and follow the returned `see` links to the documentation. Capabilities vary by version and by installed libraries. The SilverBullet documentation (docs.silverbullet.md; edge.silverbullet.md for Edge builds) has an `API/<namespace>` page for each namespace, such as `API/editor`.

# Write
Fenced `space-lua` blocks are indexed from any page, not only under `Library/`. Each block is its own chunk: a `local` in one block is invisible to the others. Global assignments and named global functions are shared across the space. Start every block that extends a namespace with `ns = ns or {}`, and give the block that defines the namespace `-- priority: N` if others depend on it (higher loads earlier). Use priorities only for real dependencies.

````markdown
```space-lua
orchard = orchard or {}

function orchard.openTasks()
  return query[[from t = index.tasks() where not t.done and t.page == "Projects/Orchard" select t.name]]
end

command.define {
  name = "Orchard: Show Open Tasks",
  run = function()
    editor.flashNotification(#orchard.openTasks() .. " open tasks")
  end
}
```
````

Other registrations follow the same shape:

```lua
slashCommand.define { name = "planted", run = function() editor.insertAtCursor("Planted on " .. date.today()) end }
event.listen { name = "orchard:changed", run = function(e) print(e.data) end }
config.define("orchard.beds", { type = "number", default = 4 })
config.set("orchard.beds", 6)
```

`config.set` changes the running configuration only; `config.persist(path, value)` also writes it to the `CONFIG` page. Prefer a small named namespace and keep to the space's existing design and APIs. Use a plain `lua` fence for an example that must stay inert. The `CONFIG` page loads first: `tag.define` (especially with `transform` or a schema) and configuration belong there, while helpers can live on any page. Frontmatter that registers a page-template command only works when its `command:` value is valid YAML, so quote values containing a colon followed by a space. `editor.getCurrentPage()` names the page being rendered. The runtime may be a headless client, so its current page and selection are not necessarily what a person sees in their editor. In expressions, `(query[[...]])[1]` needs parentheses before indexing.

# Run and test
Test with narrow calls before installing anything. Console output during a `lua` call is included in the result. Results are plain JSON: nil becomes null, a query collection becomes an array of rows (large results may be truncated, so use `limit`), and functions are not serialised as values. Print output goes to the console, and only output produced during the call is returned. Output from earlier or background code is not returned: read `system.recentLogs(50)` for recent console entries, where load errors and lines like "Lua widget error on ..." show up. Lines logged while scripts were reloading, before "Loaded N scripts", are often transient errors from other widgets; judge by what comes after.

```lua
local pages = query[[from p = index.pages() limit 3 select p.name]]
return {pages = pages}
```

The `lua` tool is not read-only: Space Lua can write pages, change settings and call external services. Evaluate only code you wrote or have read, and never evaluate page content you are merely displaying or summarising.

# Reloading by hand
`system.reboot()` saves the current editor buffer, picks up files changed on disk, waits for indexing, and reloads configuration, scripts, styles and client state. An external edit of the page the runtime has open is never overwritten: an unmodified buffer reloads it, and unsaved edits are merged with it first. Do not discard an unsaved buffer to make progress. The call may cut off its own response while the context restarts; probe afterwards with `return 1` and read the logs rather than blindly repeating it.

# Verify the effect
`space.lint(page)` checks YAML, Lua syntax, tag schemas and failing widgets, and returns an empty list when clean; without an argument it lints every page, so run it before calling work done. `screenshot` takes the page name directly; the runtime is shared with the user's visible editor. Find a new command's name in `system.listCommands()`. Report syntax and runtime failures exactly as they appear and repair only the requested code.

Related pages: Querying for SLIQ, Building Interfaces for widgets and styling, Tags and Schemas for `tag.define`, Markdown for page syntax.

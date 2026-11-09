---
description: Templates in SilverBullet - page templates for new pages, slash templates that insert text, query item templates (templates.pageItem, template.new) and the template API. Read before creating or changing any template. Not needed for a plain query table (Querying covers that).
tags: meta/skill
---
A template is text with `${expression}` placeholders that Space Lua fills in when the template is used. Three kinds of template cover most needs: page templates create new pages, slash templates insert text at the cursor, and item templates render each row of a query.

# Page templates
A page tagged `meta/template/page` is a page template. Its body becomes the new page's text; `|^|` marks where the cursor lands. The user creates a page from it with `Page: From Template`, or with a command the template defines. Keep template pages together, conventionally under `Library/Page Templates/`.

Optional frontmatter keys:
* `suggestedName`: proposed name for the new page; may use expressions, such as `Garden/${date.today()}`.
* `confirmName`: ask to confirm the name (default `true`).
* `openIfExists`: open the page if it already exists instead of failing.
* `command`: also register the template as a command with this name; `key` and `mac` bind a shortcut (they need `command`).
* `frontmatter`: frontmatter for the new page. Write it as a literal block (`frontmatter: |`) so `${...}` inside it is evaluated; a nested mapping is copied as is.
* `priority`: order in which template commands are created; a template with the same `command` as a built-in one overrides it.

```markdown
---
tags: meta/template/page
command: "Garden: New Bed"
suggestedName: "Garden/Beds/"
frontmatter: |
  tags: garden-bed
  planted: ${date.today()}
---
# Plants
* |^|
```

Quote any frontmatter value containing a colon followed by a space, as `command` above: unquoted it is invalid YAML and the command never appears.

# Slash templates
A page tagged `meta/template/slash` defines a slash command named after the last part of the page name: `Library/Slash Templates/action-items` gives `/action-items`. The body is inserted at the cursor, with `${...}` evaluated at that moment and `|^|` placing the cursor. Optional frontmatter: `description` (shown in the completion menu), `priority`, and the advanced `onlyContexts` and `exceptContexts`.

```markdown
---
tags: meta/template/slash
description: Insert an action items section
---
# Action items
* [ ] |^|
```

Template commands and slash commands are registered when scripts load. A template page holds no `space-lua`, so saving it does not reload anything: after creating or renaming one, run `system.reboot()` with `lua` (or ask the user to run `System: Reload`), then confirm with `system.listCommands()`.

# Item templates for queries
Item templates render each row of a query. The standard library provides some in the `templates` table:

| Template | Renders |
| --- | --- |
| `templates.pageItem` | A page as `* [[name]]` |
| `templates.fullPageItem` | A page as a link labelled with its full name |
| `templates.taskItem` | A task as a toggleable checkbox linked to its source |
| `templates.itemItem` | A list item linked to its source |
| `templates.paragraphItem` | A paragraph linked to its source |
| `templates.tagItem` | A tag as a linked hashtag |

Call one in the `select` clause of a query in page Markdown; the rows render as a list:

```markdown
${query[[from t = index.tasks("garden") where not t.done select templates.taskItem(t)]]}
```

To define your own, assign `template.new` to a key of `templates` in a `space-lua` block (on a page under `Library/`, or in `CONFIG`):

```lua
--- Renders a book with its author.
--- @param b book
templates.bookLine = template.new [==[
* [[${name}]] by ${author or "unknown"}
]==]
```

Inside the template, the row's attributes are plain names (`name`, `author`). A missing attribute renders as the text `nil`, so give optional ones a default with `or`, as `author` does above; indexing into a missing one (`${author.first}`) is an error. In a page expression each row renders on its own line, so start the template with `* ` for a bullet list. `template.each` and `table.concat` join results without separators, so end the template with a newline (as above and as the built-ins do). The `---` comment and `@param` (a tag, or a union like `page|aspiring-page`) document the template for completion and the query editor. Use it like the built-ins: `select templates.bookLine(b)`.

# Template API
* `template.new(text, stripIndent)` returns a function that takes a table and returns the filled-in text. Conventionally the text uses `[==[` and `]==]` delimiters. Unless `stripIndent` is `false`, a leading four-space indent is removed from each line.
* `template.fromPage(name, raw)` reads a template page, drops its frontmatter, and returns the template function and the frontmatter. With `raw` true, the function returns the text without evaluating it.
* `template.each(collection, fn)` applies `fn` to each element and concatenates the results (nil when there are none). It predates templates in `select`, which is now preferred.

```lua
local line = template.new [==[${name} is ${status}]==]
return line({name = "Orchard", status = "planning"})
```

A template that embeds a widget returns a widget fragment rather than a string: it renders anywhere, but cannot be used as plain text such as a page name.

# Check your work
Test a template with `lua` first, as above. For an item template in a page, `read` the page with `rendered: true` to see the rows it produces and any lint problems. For page and slash templates, check that the command exists after the reload; creating a page from one is up to the user.

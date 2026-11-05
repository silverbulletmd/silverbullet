SilverBullet is a programmable Markdown knowledge base. A *space* is a folder of Markdown *pages* (.md files), indexed into queryable objects (pages, tasks, items, tags, custom attributes) and scriptable with Space Lua. Call `help` first: it lists the spaces you can use and the skills to load before specific work.

Pages use SilverBullet Markdown: `[[wiki links]]`, `#tags`, YAML frontmatter, `[attribute: value]`, `* [ ] tasks`, and `${lua expression}` / `space-lua` blocks that render live. Load the `Markdown` skill before writing pages others will read in SilverBullet.

Operations work the same on every space:
- `read`, `write` and `edit` for pages, `search` for text search across entire space. `read` with `rendered` shows a page as it displays to the user (queries evaluated) plus its lint problems: use it to diagnose a broken page, and once to check your work. Edit from a plain `read`, not this view.
- `lua` runs Space Lua in the live space: queries (`query[[from p = index.pages("project") where p.status == "active"]]`), the data model (`index.tags()`, `index.tagSchema("task")`), API discovery (`spacelua.listFunctions()`, `spacelua.describe("space.readPage")`), commands, and anything a user can script. For questions about the data, query it rather than reading pages one by one. Load the `Querying` skill before writing a query and `Space Lua` before writing scripts; do not guess syntax. `lua` results include console output; `system.recentLogs()` shows recent errors.
- `screenshot` shows what a page actually looks like; use it to verify widgets, styles and layouts you build.

`lua` and `screenshot` need the space's runtime, which some spaces may lack; `help` shows which.

SilverBullet can be extended from inside the space: commands, slash commands, widgets, templates, tag schemas and styles are pages with Lua or CSS. If the user wants structure, dashboards, automation or a custom view of their notes, there is probably a skill for it: check `help`.

When unsure how something works, read the documentation at {docs_url} before answering.

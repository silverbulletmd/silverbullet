---
description: "Restricted page expressions and trusted library entry points."
tags: administration
references:
- client/space_lua/restricted_context.ts
- client/space_lua/restricted_env.ts
- client/space_lua/restricted_render.ts
- plug-api/lib/trusted_script_source.ts
---
Ordinary pages’ `${...}` expressions and [[Space Lua/Page Lua|Page Lua]] run with restricted APIs, regardless of whether the viewer is a Reader, Editor, Builder or administrator. This lets Editors use queries and installed widgets without installing executable extensions. See [[Dashboard#Access]] for role assignments and [[Security]] for the trust model.

# Available APIs
Expressions can use pure Lua calculations, [[Space Lua/Integrated Query|SLIQ]] (`where`, `order by`, projections and other query clauses), and explicitly exposed read APIs. These include `markdown.link`, `index.pages`, `index.contentPages`, `index.metaPages`, `index.tag`, `index.tasks`, `pageVars.get`, `space.listPages`, `space.readPage`, `space.readPageWithMeta`, `space.getPageMeta` and `space.listDocuments`. This is a subset of the full APIs, not permission to call every `index.*` or `space.*` function.

```markdown
${query[[from p = index.pages("book") where p.status == "unread" order by p.name select { Title = p.name }]]}
```

Query-source adapters materialize at most **10,000 rows**. A larger source produces an error rather than silently truncating it. Narrow the source itself, for example with `index.pages("book")`; a later `where` or `limit` does not avoid this adapter limit.

Raw `js`, DOM objects, arbitrary syscalls, shell commands and write APIs are unavailable. Results must be plain data or opaque render values returned by installed functions. Ordinary page code cannot construct its own executable HTML widget, script or DOM callback. Markdown HTML `data-onclick` command buttons are stripped; this also affects library-generated Markdown HTML. Trusted DOM widgets can attach their own event listeners.

# Exposing an installed function
A Builder can place this `space-lua` block in `Library/Custom/Cards`:

```lua
cards = {}

--- @capabilities space:read
function cards.title(name)
  return space.getPageMeta(name).name
end

--- @capabilities widget:render
function cards.badge(label)
  return widget.html(dom.span { __rawText = "Card: " .. label })
end
```

After reloading scripts, an ordinary page can use `${cards.title("index")}` or `${cards.badge("Ready")}`. The annotation must immediately precede the global function definition. Use `space:read` for functions returning plain data, `widget:render` for a rendered widget, or both, separated by spaces. Only functions defined in `Library/` or root [[CONFIG]] qualify; adding the annotation to an ordinary page does not grant trust.

Arguments cross as plain data, not callbacks or browser objects. A widget result crosses as an opaque value which only the renderer unwraps, so its caller cannot access the widget’s DOM node or window.

**The annotation is a trust declaration, not an implementation sandbox.** The installed function runs with trusted authority. Review its code and validate arguments before exposing it; do not accept arbitrary source code or use an argument as executable HTML or JavaScript.

# Migrating existing pages
Move reusable `space-lua` definitions from ordinary pages into `Library/Custom/...` or root [[CONFIG]]. Definitions outside these locations no longer load globally. Add capability annotations only to reviewed functions that ordinary expressions should call. Keep ordinary calculations and queries on their pages; move DOM construction and privileged behavior into trusted library implementations. Inline callbacks that call `pageVars.set`, `space.writePage` or other write APIs must be redesigned as installed widgets with reviewed handlers.

Restricted evaluation has cooperative execution budgets and data limits, but shares the browser process. Large allocations and non-yielding native operations remain resource-isolation limitations; see [[Security#Limits of isolation]].

The bundled `widgets.subPages(pageName)` is available as a read-only installed widget. Generic DOM, HTML, sandbox, callback-button and command-button constructors remain unavailable in restricted expressions. Builders can wrap reviewed uses in specific annotated functions.

Registered code widgets from trusted sources remain usable in ordinary fenced blocks. Registering a code widget is also a trust declaration: its renderer receives untrusted block text and must validate it before using privileged APIs.

Workbench query output supports link columns, grouping and aggregates, the bundled `templates.*` list templates, and custom `template.new` strings. Custom interpolation runs inside the same restricted environment. Table membership predicates, prefix filters and `os.date` are available for generated query filters.

#guide

This guide sets up a daily journaling workflow. Each day you get a fresh journal page where you capture what's happening throughout the day. By linking to topic pages from your journal entries, those entries automatically appear on the topic page via [[Linked Mention|Linked Mentions]] — building a timeline of activity for every topic you care about.

# 1. Create the journal template
Create a page called `Library/Page Tempaltes/Journal` (or any name you like) with the following content:

```
---
command: "Journal: Today"
key: "Ctrl-q t"
suggestedName: "Journal/${os.date('%Y-%m-%d')}"
confirmName: false
tags: meta/template/page
openIfExists: true
---
#journal

* |^|
```

This is a [[Page Template]] that:
* Registers a `Journal: Today` command (accessible from the [[Command Palette]])
* Binds it to `Ctrl-q t` (first press `Ctrl-q` then press `t`) for quick access
* Creates pages under `Journal/` named by today's date (e.g. `Journal/2026-03-04`)
* Opens the existing page if you've already started one today
* Tags the page `#journal` and places the cursor at the first bullet

Optionally, you may also create an [[^Library/Std/APIs/Action Button]] in your top bar for quick access. For this put the following in your [[CONFIG]]:
```lua
actionButton.define {
  icon = "pen-tool",
  priority = 3, -- or whatever order puts it in the spot you like
  run = function()
    editor.invokeCommand "Journal: Today"
  end
}
```

Then run the ${widgets.commandButton("System: Reload")} command to activate.

# 2. Start journaling
Press `Ctrl-q t` (or run `Journal: Today` from the Command Palette). You’ll land on today’s journal page with a bullet list ready to go. 

The real power comes from linking journal entries to topic pages. Instead of plain text, reference the pages that matter:

```markdown
* Reviewed the Q2 roadmap with [[Alice]] and [[Bob]]
  * Agreed to prioritize the API redesign
  * [[Alice]] will draft the migration plan
* Started reading [[Invisible Cities]]
* Fixed a bug in the [[Login Flow]]
  * Root cause was a missing null check in the session handler
```

Each `[[link]]` connects that journal entry (and its sub-items) to the referenced page.

# 4. Watch topic pages come alive
Navigate to Alice’s page. In the [[Linked Mention]] section at the bottom, you’ll see your journal entries that mention her — complete with the surrounding context and sub-items. Tomorrow’s journal entry mentioning Alice will appear there too.

Over time, each topic page accumulates a reverse-chronological log of every journal entry that references it. You don’t maintain this log — it builds itself from your daily writing.

This works for any kind of page: people, projects, concepts, books. Your journal becomes the connective tissue between all your topics.

# 5. Query your journal
Use [[Space Lua/Lua Integrated Query]] to pull insights from your journal pages. For example, show recent journal entries on your [[Index Page]]:

```lua
${template.each(query[[
  from j = tags.journal
  where j.tag == "page"
  order by j.name desc
  limit 7
]], templates.pageItem)}
```

# What's next?
You now have a daily journaling workflow where topic pages automatically collect every mention from your journal entries.

* [[Guide/Knowledge Base]] — build a personal knowledge base
* [[Guide/Task Management]] — track projects and tasks
* [[Guide/People Notes]] — keep track of people and conversations
* [[Manual]] — the full user manual

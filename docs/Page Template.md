---
description: "Reusable content for creating new pages."
tags: glossary
references:
- libraries/Library/Std/Infrastructure/Page Templates.md
- libraries/Library/Std/Page Templates/Page Template.md
---
Page templates create pages from a reusable blueprint. Expressions in the template run when the page is created. To insert a section into an existing page instead, use [[Slash Templates]].

# Creating a page template
1. Run the `Page: From Template` command
3. Select “Page Template”
4. Pick a name. The last component of the page name will be used as the template name. Keep templates under `Library/`, such as `Library/Page Templates/Daily Note`, so they count as [[Tool Page|tool pages]] and stay out of the page picker. A template elsewhere still works, but shows up as regular content.
5. Edit its body and frontmatter, then run `System: Reload` to register any command or shortcut.

## Cursor placement
In the template’s body text, you can optionally use `|^|` as a placeholder for where the cursor should be after creating the page.

## Configuration
Optional keys you can set in the page’s frontmatter:

* `suggestedName`: the proposed name for the new page, can use embedded Lua expressions, like `Daily/${date.today()}`.
* `confirmName`: For the template’s own command or shortcut, confirm the suggested page name before creating it (defaults to `true`). `Page: From Template` always asks for a name.
* `openIfExists`: If a page with the `suggestedName` already exists, open it rather than attempting to create it anew.
* `command`: expose the page template as a command with this name.
* `key`: Bind the snippet to a keyboard shortcut (note: this requires to _also_ specify the `command` configuration).
* `mac`: Bind the snippet to a Mac-specific keyboard shortcut.
* `frontmatter`: Frontmatter to set in the resulting page. Use a YAML literal block scalar (`frontmatter: |`) so that the value is passed as a string and `${...}` Lua interpolation works. A nested YAML mapping is also accepted (and serialized verbatim), but interpolation will be skipped in that case.
* `priority`: Controls the order in which page template commands are created, highest first (see “Overriding page templates” below).

## Example: Daily note
The following creates a page template that can be run using the `Journal: Daily Note` command, it automatically creates `Daily/today’s date` if it does not already exist with a bulleted list, putting the cursor at the first bullet. If the page already exists, it navigates there.

~~~
---
command: "Journal: Daily Note"
suggestedName: "Daily/${date.today()}"
confirmName: false
openIfExists: true
tags: meta/template/page
---
* |^|
~~~

# Currently active page templates
${query[[
  from p = index.pages("meta/template/page")
  select templates.fullPageItem(p)
]]}

# Instantiating page templates
You can create a page based on a page template via the `Page: From Template` command, or via the command name that you defined in your template’s frontmatter.

# Overriding page templates
If you would like to override an existing page template (for instance the Quick Note) template with your own, you can take advantage of the load order determined by the `priority` frontmatter. Built in page templates will have a priority set that is higher than the default. Therefore, their commands and keybindings will be set early. Therefore, by simply defining your own version of the page template _with the same command name_ will let that version override the versions that are built in.

## Example: overriding the Quick Note template
~~~
---
command: Quick Note
key: "Ctrl-q q"
suggestedName: "Quick notes/${os.date('%Y-%m-%d/%H-%M-%S')}"
confirmName: false
tags: meta/template/page
---
This is my quick note version
~~~

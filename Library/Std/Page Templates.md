#meta

Page templates can be used to automate or simplify the creation of pages based on a template.

# Creating a page template
To create a page template, create a page and tag it with `#meta/template/page`.

The last component of the page name will be used as the template name.

## Cursor placement
In the template’s body text, you can optionally use `|^|` as a placeholder for where the cursor should be after creating
the page.

## Configuration
Optional keys you can set in the page’s frontmatter:

* `suggestedName`: the proposed name for the new page, can use embedded Lua expressions, like `Daily/${date.today()}`.
* `confirmName`: Confirm the suggested page name before creating it (defaults to `true`).
* `openIfExists`: If a page with the `suggestedName` already exists, open it rather than attempting to create it anew.
* `command`: expose the page template as a command with this name.
* `key`: Bind the snippet to a keyboard shortcut (note: this requires to _also_ specify the `command` configuration).
* `mac`: Bind the snippet to a Mac-specific keyboard shortcut.
* `frontmatter`: Frontmatter (encoded as a string) to set in the resulting page.
* `priority`: Similar to how space lua scripts are loaded, this controls the order in which page template _commands_ are
  created (see "overriding page templates" below)

## Example: Daily note
The following creates a page template that can be run using the `Journal: Daily Note` command, it automatically creates
`Daily/today’s date` if it does not already exist with a bulleted list, putting the cursor at the first bullet. If the
page already exists, it navigates there.

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

${template.each(query[[
from index.tag "meta/template/page"
where _.tag == "page"
]], templates.fullPageItem)}

# Instantiating page templates

You can create a page based on a page template via the ${widgets.commandButton("Page: From Template")} command, or via
the command name that you defined in your template’s frontmatter.

# Overriding page templates

If you would like to override an existing page template (for instance the Quick Note) template with your own, you can
take advantage of the load order determined by the `priority` frontmatter. Built in page templates will have a priority
set that is higher than the default. Therefore, their commands and keybindings will be set early. Therefore, by simply
defining your own version of the page template _with the same command name_ will let that version override the versions
that are built in.

## Example: overriding the Quick Note template

~~~
---
command: Quick Note
key: "Alt-Shift-n"
suggestedName: "Quick notes/${os.date('%Y-%m-%d/%H-%M-%S')}"
confirmName: false
tags: meta/template/page
---
This is my quick note version
~~~

# Implementation
```space-lua
-- priority: 10

local function createPageFromTemplate(templatePage, pageName)
  -- Won't override an existing page
  if space.pageExists(pageName) then
    editor.flashNotification("Page " .. pageName .. " already exists", "error")
    return
  end
  local tpl, fm = template.fromPage(templatePage)
  local initialText = ""
  if fm.frontmatter then
    initialText = "---\n"
      .. string.trim(template.new(fm.frontmatter)())
      .. "\n---\n"
  end
  -- Write an empty page to start
  space.writePage(pageName, initialText)
  editor.navigate({kind = "page", page = pageName})
  -- Insert there, supporting |^| cursor placeholder
  editor.insertAtPos(tpl(), #initialText, true)
end

-- Create commands for all page templates with a command key in frontmatter
for pt in query[[
    from index.tag "meta/template/page"
    where _.tag == "page" and _.command
    order by _.priority desc
  ]] do
  command.define {
    name = pt.command,
    key = pt.key,
    mac = pt.mac,
    run = function()
      local pageName
      if pt.suggestedName then
        pageName = (template.new(pt.suggestedName))()
      end
      if pt.confirmName != false then
        pageName = editor.prompt("Page name", pageName)
      end
      if not pageName then
        return
      end
      if pt.openIfExists and space.pageExists(pageName) then
        editor.navigate({kind = "page", page = pageName})
        return
      end
      createPageFromTemplate(pt.name, pageName)
    end
  }
  print("Registered", pt.command)
end

command.define {
  name = "Page: From Template",
  run = function()
    local pageTemplates = query[[from index.tag "meta/template/page" where _.tag == "page"]]
    local selected = editor.filterBox("Page template", pageTemplates, "Pick the template you would like to instantiate")
    if not selected then
      return
    end
    local pageName
    if selected.suggestedName then
      pageName = (template.new(selected.suggestedName))()
    end
    pageName = editor.prompt("Page name", pageName)
    if not pageName then
      return
    end
    createPageFromTemplate(selected.name, pageName)
  end
}
```

---
description: A page generated dynamically by code rather than stored as a file.
tags: glossary
---

Virtual pages are read-only pages that don't exist as files in your space. Instead, they are generated dynamically when you navigate to them. This is useful for building pages whose content is computed on-the-fly — for example, pages that show all objects with a particular tag.

# How it works
You define a virtual page by calling `virtualPage.define` with a Lua pattern and a function. When someone navigates to a page name matching the pattern, SilverBullet calls your function instead of loading a file from disk.

The function receives the captured groups from the pattern as arguments, and returns the markdown content to display.

```lua
virtualPage.define {
  pattern = "greeting:(.+)",
  run = function(name)
    return "# Hello, " .. name .. "!\nWelcome to this virtual page."
  end
}
```

Navigating to `greeting:World` renders a page with the heading "Hello, World!" — but no file is created.

Virtual pages are always **read-only**. The editor disables editing controls automatically.

# Built-in virtual pages

## Tag pages
The most commonly used virtual pages are **tag pages**. When you click a hashtag like `#project`, SilverBullet navigates to `tag:project`, which is a virtual page that lists all objects with that tag — grouped by type (pages, tasks, items, data, etc.).

Tag pages are defined in the standard library and work out of the box. You can override the default tag page by defining your own `virtualPage.define` with the pattern `tag:(.+)`.

## URI pages
Navigating to a page named `uri:https://example.com/page` fetches and displays the content from that URL. This is useful for pulling in external markdown content.

# Defining your own virtual pages
Here's a more complete example that queries the object index:

```lua
virtualPage.define {
  pattern = "recent:(%d+)",
  run = function(count)
    local n = tonumber(count)
    local pages = query[[
      from index.tag "page"
      order by lastModified desc
      limit n
    ]]
    local result = "# " .. count .. " Most Recent Pages\n"
    for _, page in ipairs(pages) do
      result = result .. "* [[" .. page.name .. "]]\n"
    end
    return result
  end
}
```

Navigate to `recent:10` to see the 10 most recently modified pages.

# Multiple capture groups
Patterns can capture multiple groups, each passed as a separate argument:

```lua
virtualPage.define {
  pattern = "lookup:(.+):(.+)",
  run = function(type, id)
    return "# " .. type .. "\nLooking up: " .. id
  end
}
```

# How it works under the hood
Virtual page definitions are stored in the config system under the `virtualPages` key. When a page is being created, SilverBullet fires the `editor:pageCreating` event. The standard library's event listener checks all registered patterns against the page name. If a match is found, the corresponding `run` function is called, and its return value becomes the page content with read-only permissions.

See also: [[API/event]], [[API/config]]

The index page is the [[Pages|page]] that opens by default when either clicking the “home” button in the [[Top Bar]], or when you visit your SilverBullet’s URL without a page name in the URL.

The default index page’s name is `index`, but this is configurable via [[Install/Configuration]]’s `SB_INDEX_PAGE` variable.

# How to set a dynamic index page
Some people want to set their index page to be e.g. their daily note, and the daily note changes every... day. 

Doing this can be achieved with some [[Space Lua]] magic (in the code below we’ve set this to the `lua` language in order not to actually activate this functionality, in your own copy be sure to use `space-lua` instead):

```lua
local function redirectToCustomIndex()
  if editor.getCurrentPage() == "index" then
    -- Change this to whatever page you want your index page to be
    editor.navigate({kind = "page", page = "Daily/" .. date.today()})
  end
end

-- Trigger the above function when the editor is first loaded
event.listen {
  name = "editor:init",
  run = redirectToCustomIndex
}

-- And also when any page is loaded (because it may be the index page)
event.listen {
  name = "editor:pageLoaded",
  run = redirectToCustomIndex
}
```
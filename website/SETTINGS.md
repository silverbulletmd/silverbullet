This page contains settings for configuring SilverBullet and its Plugs. Changing any of these in most cases will go into effect immediately, except for `indexPage` which requires a reload.

```yaml
# Initial page to load when launching SB
indexPage: "[[SilverBullet]]"

# Load custom CSS styles from the following page
customStyles: "[[STYLES]]"

# Template related settings
pageTemplatePrefix: "template/page/"
snippetPrefix: "snippet/"

quickNotePrefix: "📥 "

dailyNotePrefix: "📅 "
dailyNoteTemplate: "[[template/page/Daily Note]]"

weeklyNotePrefix: "🗓️ "
weeklyNoteTemplate: "[[template/page/Weekly Note]]"
weeklyNoteMonday: false

# Markdown
previewOnRHS: true

# Defines files to ignore in a format compatible with .gitignore
spaceIgnore: |
   dist
   largefolder
   *.mp4
# Plug overrides allow you to override any property in a plug manifest at runtime
# The primary use case of this is to override or define keyboard shortcuts. You can use the . notation, to quickly "dive deep" into the structure
plugOverrides:
  core:
    # Matching this YAML structure:
    # https://github.com/silverbulletmd/silverbullet/blob/main/plugs/core/core.plug.yaml
    # and overriding the "key" for centering the cursor
    functions.centerCursor.command.key: Ctrl-Alt-p
    # However, it's even possible to define custom slash commands this way without building a plug (/today-header in this case):
    functions.todayHeader:
      redirect: insertTemplateText
      slashCommand:
        name: today-header
        value: |
          ## {{today}}
```

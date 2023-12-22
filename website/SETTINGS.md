This page contains settings for configuring SilverBullet and its Plugs. Changing any of these in most cases will go into effect immediately, except `indexPage` and `customStyles` which require a reload.

```yaml
# Initial page to load when launching SB
indexPage: "[[SilverBullet]]"

# Load custom CSS styles from the following page, can also be an array
customStyles: "[[STYLES]]"

# Template settings
quickNotePrefix: "📥 "
dailyNotePrefix: "📅 "
dailyNoteTemplate: "[[template/page/Daily Note]]"
weeklyNotePrefix: "🗓️ "
weeklyNoteTemplate: "[[template/page/Weekly Note]]"
weeklyNoteMonday: false

# Keyboard shortcut overrides take presedence over built-in shortcuts
keyboardShortcuts:
  # Using the command-link syntax
  - command: "{[Stats: Show]}"
    # Mac-specific keyboard
    mac: "Cmd-s"
    # Key binding for Windows/Linux (and Mac if not defined)
    key: "Ctrl-s"
  - command: "Navigate: Center Cursor"
    key: "Alt-x"

# Defines files to ignore in a format compatible with .gitignore
spaceIgnore: |
   dist
   largefolder
   *.mp4

```

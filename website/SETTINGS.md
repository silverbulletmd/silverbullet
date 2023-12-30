This page contains settings for configuring SilverBullet and its Plugs. Changing any of these will go into effect immediately in most cases except `indexPage` and `customStyles`, which require a reload.

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

# (Keyboard) shortcut overrides take precedence over built-in shortcuts
shortcuts:
  - mac: "Cmd-s" # Mac-specific keyboard shortcut
    key: "Ctrl-s" # Windows/Linux specific keyboard shortcut
    command: "{[Stats: Show]}" # Using the command link syntax here
  - key: "Alt-x"
    command: "Navigate: Center Cursor" # But a command name is also supported

# Defines files to ignore in a format compatible with .gitignore
spaceIgnore: |
   dist
   largefolder
   *.mp4

```

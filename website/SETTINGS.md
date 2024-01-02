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

# It is possible to override keyboard shortcuts and command priority
shortcuts:
- command: "{[Stats: Show]}" # Using the command link syntax here
  mac: "Cmd-s" # Mac-specific keyboard shortcut
  key: "Ctrl-s" # Windows/Linux specific keyboard shortcut
- command: "Navigate: Center Cursor" # But a command name is also supported 
  key: "Alt-x"
- command: "{[Upload: File]}"
  priority: 1 # Make sure this appears at the top of the list in the command palette

# Defines files to ignore in a format compatible with .gitignore
spaceIgnore: |
   dist
   largefolder
   *.mp4

```

This page contains settings for configuring SilverBullet and its Plugs. Changing any of these in most cases will go into effect immediately, except for `indexPage` which requires a reload.

```yaml
# Initial page to load when launching SB
indexPage: SilverBullet

# Template related settings
pageTemplatePrefix: "template/page/"
snippetPrefix: "snippet/"

quickNotePrefix: "📥 "

dailyNotePrefix: "📅 "
dailyNoteTemplate: "template/page/Daily Note"

weeklyNotePrefix: "🗓️ "
weeklyNoteTemplate: "template/page/Weekly Note"
weeklyNoteMonday: false

# Markdown
previewOnRHS: true

# Sync
sync:
  # Do not sync pages with a specific prefix
  excludePrefixes:
  - PLUGS
```

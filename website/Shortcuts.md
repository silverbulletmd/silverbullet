SilverBullet enables you to configure some custom shortcuts in [[SETTINGS]] via the `shortcuts` attribute that trigger [[Commands]] in various ways.

Supported types of shortcuts:
* [[Keyboard Shortcuts]] that create keyboard bindings for a given command
* [[Slash Commands]] shortcuts that enable triggering a command via a slash command
* Priority shortcuts to tweak the ordering of commands in the [[Command Palette]]

# Configuration
In [[SETTINGS]]:

```yaml
shortcuts:
# Keyboard shortcuts:
- command: "{[Navigate: Center Cursor]}"
  key: "Alt-x" # for Linux/Windows
  mac: "Alt-x" # for macOS (and other Apple devices with keyboards)
# Slash command shortcuts:
- command: "{[Outline: Move Right]}"
  slashCommand: "indent"
- command: "{[Outline: Move Left]}"
  slashCommand: "outdent"
# Priority shortcut
- command: "{[Upload: File]}"
  priority: 1
```

This page holds configuration for your SilverBullet space. See [[^Library/Std/Config]] for all options and defaults.

Run ${widgets.commandButton "System: Reload"} to reload.

## User configuration
Anything you add to the block below is yours, edit freely.

```space-lua
-- boot: true
-- Add custom configuration here, e.g.:
-- config.set("shortWikiLinks", false)
```

## Managed by the Workbench
The block below is maintained by the ${widgets.commandButton("Configuration", "Configuration: Open")} tab of the Workbench. Prefer editing it there, although simple hand edits should survive.

```space-lua
-- managed-by: configuration-manager
-- boot: true
config.set("workbench.pinnedTags", {"page", "task", "decision", "meeting", "person"})
```

```space-lua
-- managed-by: workbench-schemas
-- boot: true
-- priority: -10
tag.define {
  name = "decision",
  schema = {
    type = "object",
    properties = {
      date = schema.date(),
      status = schema.enum {"proposed", "accepted", "superseded"},
    },
  },
}
tag.define {
  name = "meeting",
  schema = {
    type = "object",
    properties = {
      date = schema.date(),
      attendees = schema.array("string"),
    },
  },
}
tag.define {
  name = "person",
  schema = {
    type = "object",
    properties = {role = schema.string()},
  },
}
config.set({"tags", "person", "icon"}, "circle-user")
config.set({"tags", "meeting", "icon"}, "users")
config.set({"tags", "decision", "icon"}, "rocket")
```
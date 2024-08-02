While SilverBullet tries to set sensible defaults, you may want to tweak a few things here and there.

This is where [[Space Config]] comes in. You can put fenced code blocks anywhere in your space (but the convention is to use [[^SETTINGS]]) with `space-config` as a language, and override the default configurations [[!silverbullet.md/SETTINGS|specified here]].

You can reload the configuration on demand using {[System: Reload]}, for some configurations a client (page) reload (Ctrl-r/Cmd-r in your browser) may be required.

An example:
```space-config
shortcuts:
- command: "{[Outline: Move Left]}"
  slashCommand: "outdent"
```

Space configs are indexed automatically and stored as [[Objects]] with `space-config` as their tag. Here are the keys defined across this space:

```query
space-config select key
```

When there are _duplicate entries_ for one configuration key, “smart” merging kicks in.

This is how it works:
* When a configuration value is a _scalar value_ (a string, number), all bets are off: you get non-deterministic behavior. Either one value will be assigned, or the other. Don’t do this.
* When a configuration value is an _object_, these objects will attempted to be merged. Recursively, if there are duplicates this same list of rules applies.
* When a configuration value is a _list_, these lists will be concatenated. In what order is non-deterministic. If you care, don’t do this, just centralize all items in one place.

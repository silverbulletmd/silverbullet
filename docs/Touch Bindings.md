# Touch Bindings

SilverBullet supports **multi‑touch gestures** for quick actions.

## Configure (Space `CONFIG`)

```lua
config.set("ui.touch.bindings", {
  { fingers = 2, command = "Navigate: Page Picker" }, -- default
  { fingers = 3, command = "Command: Open Palette" }, -- default
  -- Example override:
  -- { fingers = 2, command = "Navigate: Back", preventDefault = true },
})
```

- `preventDefault` defaults to **true**. Set **false** to allow browser/system zoom.
- Later entries override earlier ones when they use the same `fingers`.

## Developer notes

- The UI installs a single `touchstart` listener (non-passive) and resolves the gesture using:
  1. Built-in defaults
  2. `ui.touch.bindings` from config
- Handler lives in `client/input/touch_router.ts` and registry in `client/input/touch_registry.ts`.

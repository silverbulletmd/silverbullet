An attempt at documenting of the changes/new features introduced in each (pre) release.

## 0.0.29
* Added the `Link: Unfurl` command, which is scoped to only work (and be visible) when used on “naked URLs”, that is: URLs not embedded in a link or other place, such as this one: https://silverbullet.md
  * Plugs can implement their own unfurlers by responding to the `unfurl:options` event (see the [Twitter plug](https://github.com/silverbulletmd/silverbullet-twitter) for an example).
  * Core implements only one unfurl option: “Extract title” which pulls the `<title>` tag from the linked URL and replaces it with a `[bla](URL)` style link.
* Removed status bar: to further simplify the SB UI. You can still pull up the same stat on demand with the `Stats: Show` command.
* Reverted exposing an empty `window` object to sandboxes running in workers and node.js (introduced in 0.0.28)

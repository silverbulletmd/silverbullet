---
tags: api/syscall
references:
- plug-api/syscalls/system.ts
- client/plugos/syscalls/system.ts
- plugs/editor/system.ts
---

The System API provides system-level functions for interacting with the SilverBullet environment.

<!--#lua spacelua.renderApiDocumentation("system") -->
## system.cleanDatabases

`system.cleanDatabases()`

> **Deprecated:** Use system.wipeClient or the Client: Wipe command instead.

Deprecated no-op retained for compatibility.

## system.getBaseURI

`system.getBaseURI()`

Returns the browser base URI for this SilverBullet instance.

## system.getConfig

`system.getConfig(key, defaultValue?)`

Returns a configuration value, with an optional default.

## system.getEnv

`system.getEnv()`

> **Deprecated:** The environment is always the client.

Deprecated environment probe that always returns nil.

## system.getMode

`system.getMode()`

Returns rw for read-write mode or ro for read-only mode.

## system.getSpaceConfig

`system.getSpaceConfig(key, defaultValue?)`

> **Deprecated:** Use system.getConfig instead.

Deprecated alias for system.getConfig.

## system.getURLPrefix

`system.getURLPrefix()`

Returns the configured URL path prefix for this SilverBullet instance.

## system.getVersion

`system.getVersion()`

Returns the running SilverBullet version.

## system.invokeCommand

`system.invokeCommand(name, args?)`

> **Deprecated:** Use editor.invokeCommand instead.

Deprecated alias for editor.invokeCommand.

## system.invokeFunction

`system.invokeFunction(name, ...)`

Invokes a loaded plug function by its plug-qualified name.

## system.invokeFunctionOnServer

`system.invokeFunctionOnServer(name, ...)`

> **Deprecated:** Use system.invokeFunction instead.

Deprecated alias for system.invokeFunction.

## system.listCommands

`system.listCommands()`

Returns a map of every currently available command definition.

## system.listSyscalls

`system.listSyscalls()`

Lists registered syscalls with permissions, argument counts, and documentation metadata.

## system.loadPlug

`system.loadPlug(path)`

Loads or reloads one plug from a space file path.

## system.loadScripts

`system.loadScripts()`

Reloads Space Lua scripts and configuration.

## system.loadSpaceScripts

`system.loadSpaceScripts()`

> **Deprecated:** Use system.loadScripts instead.

Deprecated alias for system.loadScripts.

## system.loadSpaceStyles

`system.loadSpaceStyles()`

Reloads custom Space Style definitions.

## system.reboot

`system.reboot()`

Saves the current editor buffer, detects on-disk changes, waits for indexing, and reloads configuration, scripts, styles, and client state. Because the buffer is saved first, an external edit to the currently open page can be overwritten; edit that page through the editor or navigate away first.

## system.reloadConfig

`system.reloadConfig()`

> **Deprecated:** Configuration reloads automatically; use system.reboot when needed.

Deprecated no-op that returns the current configuration.

## system.reloadPlugs

`system.reloadPlugs()`

Reloads every plug available to the client.

## system.serverSyscall

`system.serverSyscall(name, ...)`

> **Deprecated:** Invoke the target syscall directly instead.

Deprecated helper for invoking a named syscall.

## system.unloadPlug

`system.unloadPlug(path)`

Unloads the plug loaded from a space file path.

## system.wipeClient

`system.wipeClient(logout?)`

Wipes local client state, cached files, databases, and optionally the login session.
<!--/lua-->


The SilverBullet CLI has a `sync` command that can be used to synchronize local as well as remote [[Spaces]]. This can be useful when migrating between different [[Install/Configuration$storage|storage implementations]]. It can also be used to back up content elsewhere. Under the hood, this sync mechanism uses the exact same sync engine used for the Sync [[Client Modes]].

# Use cases
* **Migration**: you hosted SilverBullet on your local device until now, but have since set up an instance via [[Install/Deno Deploy]] and want to migrate your content there.
* **Backup**: you host SilverBullet on a remote server, but would like to make backups elsewhere from time to time.

# Setup
To use `silverbullet sync` you need a [[Install/Local$deno|local deno installation of SilverBullet]].

# General use
To perform a sync between two locations:

```shell
silverbullet sync --snapshot snapshot.json <primaryPath> <secondaryPath>
```

Where both `primaryPath` and `secondaryPath` can use any [[Install/Configuration$storage]] configuration.

The `--snapshot` argument is optional; when set, it will read/write a snapshot to the given location. This snapshot will be used to speed up future synchronizations.

To synchronize two local folders (named `testspace1` and `testspace2`) (not particularly useful, you may as well use `cp` or `rsync`):

```
silverbullet sync --snapshot snapshot.json testspace testspace2
```

# Migrate
To synchronize a local folder (the current directory `.`) to a remote server (located at `https://notes.myserver.com`) for which you have setup an [[Install/Configuration$authentication|auth token]] using the `SB_AUTH_TOKEN` environment variable of `1234`:

```shell
SB_AUTH_TOKEN=1234 silverbullet sync . https://notes.myserver.com
```

If you want to perform a “wipe sync”, wiping the destination (secondary) before uploading all files from the primary path there, you can use the `--wipe-secondary` flag. You will be asked for confirmation:

```shell
SB_AUTH_TOKEN=1234 silverbullet sync --wipe-secondary . https://notes.myserver.com
```

# Backup
To perform a backup, you may simply run the `sync` commands mentioned above regularly. Be sure to always specify the `--snapshot` flag in this case, and be sure to actually back up your local copy, e.g. using git.

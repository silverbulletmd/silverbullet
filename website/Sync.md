SilverBullet now has a sync engine. It’s still early in its development, so somewhat experimental. If you decide to use it **make back-ups**.

The synchronization algorithm implemented is [pretty much the one described here](https://unterwaditzer.net/2016/sync-algorithm.html).

## Architecture
To use SilverBullet sync, you’ll use a single SilverBullet [[Server]] as your central synchronization space, then connect any other instances of SilverBullet (likely primarily [[Mobile]] and [[Desktop]] apps, but could also be other [[Server]] instances) to it. Each “client” instance keeps track of sync snapshots that it uses to figure out what files have changed where.

Let’s put this information in a graph just because we can!

```mermaid
graph TD;
    iPhone-->SB(SilverBullet Server);
    iPad-->SB;
    Desktop-->SB;
    OtherSB(Other Silver Bullet instance)-->SB;
```

## Usage
Here’s how to use SilverBullet’s sync functionality:

1. Set up a SilverBullet [[Server]] somewhere where all your other devices have access to it. This can be your local network, a VPN, or if you’re living the wild life — the public Internet (do put some SSL and authentication on it, please).
2. Connect any other SilverBullet instance (likely the [[Desktop]] or [[Mobile]] app) to it via the {[Sync: Configure]} command. This will ask for:
   * A URL to connect to (the URL of the SB server configured under (1))
   * A username and password (optional) if you run the server with the `--user myuser:mypass` flag or the `SB_USER=myuser:mypass` environment variable (as you should)

3. Now you have two options:
    1. Perform a one-time “clean sync” _wiping all local content_ and syncing down content from the sync server. For this, use the {[Sync: Wipe Local Space and Sync]} command. This is likely what you want for e.g. an initial [[Mobile]] setup.
    2. Use {[Sync: Sync]} to perform a regular sync, comparing the local and remote space and generating conflicts where appropriate.
3. Check {[Show Logs]} for sync logs.

Sync is triggered:
* Continuously when changes are made to a page in a client set up with sync, immediately after the page persists (single file sync)
* Automatically every minute (full space sync)
* Manually using the {[Sync: Sync]} command (full space sync)

## The sync process
1. The sync engine compares two file listings: the local one and the remote one, and figures out which files have been added, changed and removed on both ends. It uses timestamps to determine changes. Note this doesn’t make any assumptions about clocks being in sync, timezones etc.
2. In most cases, based on this info (together with the snapshot from the last sync), it should be obvious what to do, and it will do just do it.
3. In case of a conflict — which would happen if files on both ends have been changed since the last sync, it will first pull down both files and compare their content. If they’re the same, no issues. If they’re different: a conflicting copy will be created with a name of `page name.conflicted.timestamp`. You’ll see those appear in your page list.

## Caveats
* This is new code and has not been extremely thoroughly tested. Make backups.
* The sync engine doesn’t synchronize `_plugs` code, so to update the plug list based on your [[PLUGS]] you have to manually run {[Plugs: Update]}.

So, if you’re ready for this. Go try it. We do recommend: make regular backups in case the proverbial shit hits the fan, don’t say we didn’t warn you!

You can tweak some things in sync, such as excluding certain prefixes from sync. For this, see the [[SETTINGS]] documentation.
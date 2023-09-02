SilverBullet currently supports two modes for its client:

1. _Online mode_ (the default): keeps all content on the server
2. _Synced mode_ (offline capable): syncs all content to the client

You can toggle between these two modes by clicking the 🔄 button in the top bar.

You can switch modes anytime, so try them both to decide what works best for you.

## Online mode
In online mode, all content in your space is kept on the server, and a lot of the heavy lifting (such as indexing of pages) happens on the server.

Advantages:
* **Keeps content on the server**: this mode does not synchronize all your content to your client (browser), making this a better fit for large spaces.
* **Lighter-weight** in terms of memory and CPU use of the client

Disadvantages:
* **Requires a working network connection** to the server.
* **Higher latency**, since more interactions require calls to the server, this may be notable e.g., when completing page names.

## Synced mode
In this mode, all content is synchronized to the client, and all processing happens there. The server effectively acts as a “dumb data store.” All SilverBullet functionality is available even when there is no network connection available.

Advantages:
* **100% offline capable**: disconnect your client from the network, shutdown the server, and everything still works. Changes synchronize automatically once a network connection is re-established.
* **Lower latency**: all actions are performed locally in the client, which in most cases will be faster

Disadvantages:
* **Synchronizes all content onto your client**: using disk space and an initially large bulk of network traffic to download everything.


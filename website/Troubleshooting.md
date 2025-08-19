If things don’t work, SilverBullet doesn’t run, a few things to try:

If this doesn’t help, ask the [community for help](https://community.silverbullet.md/).

# Logs
SilverBullet logs in two places: in your browser and on the server. Most valuable logs are likely going to be in your browser’s logs:

* Client logs: Check your browser’s JavaScript console.
* Server logs: Server logs are written to the standard output of the server process. Have a look there too, to see if anything obvious is going on.

# Problems caused by plugs
In case you installed some dysfunctional plug try the following:

* Wipe the `_plug` folder in your space’s folder on the server
* Perform a [[#Full client wipe]] (below)

If you’re now back in a functional state, re-add plugs one by one.

# Full client wipe
In case your client is completely stuck and won’t load anymore, you can perform a full client reset & wipe. This will wipe all local data.

There are two ways to trigger it.

Via your browser’s JavaScript console, run:

```javascript
client.clientSystem.localSyscall("system.wipeClient", []);
```

If you do not have access to your JavaScript console (for instance, because you’re on a phone) you can trigger this by tweaking the URL:

Steps:

1. Append `#--wipe-client` to your SilverBullet URL, e.g. `http://localhost:3000#--wipe-client`.
2. Navigate to the regular URL without `#--wipe-client` after this, and reload your page. This should initiate a full client resync.
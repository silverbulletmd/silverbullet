> **warning** Experimental
> This setup is not battle-tested, use it at your own risk

You can deploy SilverBullet to [Deno Deploy](https://deno.com/deploy) for free, and store space content in [Deno KV](https://deno.com/kv).

# Steps
Sign up for a (free) [Deno Deploy account](https://dash.deno.com/projects) and “Create an empty project” there.

Jump to the “Settings”, give your project a nicer name, and configure the following environment variables:

* `SB_FOLDER`: `db://`
* `SB_PORT`: `8000`
* `SB_SYNC_ONLY`: `1` (Deno Deploy does not currently support Workers, so running indexing etc. on the server will not work)
* `SB_USER`: (e.g. `pete:letmein`) — this is **super important** otherwise your space will be open to anybody without any authentication
* `SB_AUTH_TOKEN`: (Optional) If you would like to migrate existing content from elsewhere (e.g. a local folder) using [[Sync]], you will want to configure an authentication token here (pick something secure).

Make sure you have [installed Deno locally](https://docs.deno.com/runtime/manual/getting_started/installation) on your machine.

Then, install `deployctl` via:

```shell
$ deno install -Arf https://deno.land/x/deploy/deployctl.ts
```

To deploy, run:

```shell
deployctl deploy -p=your-project --entrypoint=https://silverbullet.md/silverbullet.js --include= --prod
```

# Migrating and backing up content
If you want to migrate content _from_ or _to_ your new Deploy-based space, you can use [[Sync]]. For this be sure to also configure a `SB_AUTH_TOKEN` variable.

For backup purposes, it may be wise to synchronize your content regularly this way.

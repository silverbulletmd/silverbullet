**Note:** This is a experimental setup, take this into account.

You can deploy SilverBullet to [Deno Deploy](https://deno.com/deploy) for free, and store your meta data as well as space content in [Deno KV](https://deno.com/kv).

# Steps
Sign up for a (free) [Deno Deploy account](https://dash.deno.com/projects) and create a new “deployctl” project there.

Set these environment variables in the project (under “Settings”):

* `SB_FOLDER`: `db://`
* `SB_PORT`: `8000`
* `SB_SYNC_ONLY`: `1` (Deno Deploy does not currently supports Workers, so running indexing etc. on the server will not work)
* `SB_USER`: (e.g. `pete:letmein`) — this is **super important** otherwise your space will be open without any authentication

Make sure you [install Deno locally](https://docs.deno.com/runtime/manual/getting_started/installation) on your machine.

Then, install `deployctl` via:

```shell
$ deno install -Arf https://deno.land/x/deploy/deployctl.ts
```

To deploy, run:

```shell
deployctl deploy -p=your-project --entrypoint=https://silverbullet.md/silverbullet.js --include= --prod
```

And that’s it!
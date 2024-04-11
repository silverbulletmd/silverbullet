The SilverBullet is implemented using a JavaScript runtime called [Deno](https://deno.com/) which is a lot like node.js, just... you know, better. And we like better.

To run SilverBullet directly on your host system (so not in a [[Install/Docker]] container), you need to [install Deno](https://docs.deno.com/runtime/manual/getting_started/installation) 1.40 or later:

```shell
curl -fsSL https://deno.land/install.sh | sh
```

After having installed Deno, run:

```shell
deno install -f --name silverbullet  --unstable-kv --unstable-worker-options -A https://get.silverbullet.md
```

You only have to do this once. This will download the currently _released_ version of SilverBullet onto your machine.

This command will install `silverbullet` into your `~/.deno/bin` folder (which should already be in your `$PATH` if you followed the Deno install instructions).

While you have [[Install/Configuration|options as to where and how to store your content]], the most straightforward way is to simply use a folder on disk.

After creating a folder, run the following command in your terminal:

```shell
silverbullet <pages-path>
```

By default, SilverBullet will bind to port `3000`; to use a different port, use the `-p` flag (e.g. `-p8080`).

For security reasons, by default, SilverBullet only allows connections via `localhost` (or `127.0.0.1`). To also allow connections from the network, pass a `-L0.0.0.0` flag (0.0.0.0 for all connections, or insert a specific address to limit the host), combined with `--user username:password` to add simple [[Authentication]].

Once downloaded and booted, SilverBullet will print out a URL to open in your browser.

# Upgrading
SilverBullet is regularly updated. To get the latest and greatest, simply run:

```shell
silverbullet upgrade
```

And restart SilverBullet. You should be good to go.

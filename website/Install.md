Installing SilverBullet as a (local) web server is pretty straightforward.

The idea is simple: you run the web server (instructions below), point your browser at it, and _go, go, go_! You can access the URL via your desktop browser but also a mobile one. You could even go _full-on YOLO_ (that’s a technical term), and install it on a public cloud server somewhere and access it that way (be sure to at least enable authentication and put SSL on top of it, though).

You have two options to install and run SilverBullet as a server:

1. Installation via Deno on your host system
2. Running it with Docker

In either case, check the notes [[@tls|on using TLS]].

## Installation via Deno
This consists of two steps (unless Deno is already installed — in which case we’re down to one):

1. [Install Deno](https://deno.land/manual/getting_started/installation) (if you’re using a Raspberry Pi, follow [[Raspberry Pi Installation]]-specific instructions)
2. Installing SilverBullet itself (steps below)

### Install SilverBullet
With Deno installed, run:

```shell
deno install -f --name silverbullet -A https://get.silverbullet.md
```

This will install `silverbullet` into your `~/.deno/bin` folder (which should already be in your `$PATH` if you followed the Deno install instructions).

To run SilverBullet, create a folder for your pages (it can be empty or be an existing folder with `.md` files) and run the following command in your terminal:

```shell
silverbullet <pages-path>
```

By default, SilverBullet will bind to port `3000`; to use a different port, use the `-p` flag.

For security reasons, by default, SilverBullet only allows connections via `localhost` (or `127.0.0.1`). To also allow connections from the network, pass a `-L 0.0.0.0` flag (0.0.0.0 for all connections, or insert a specific address to limit the host), ideally combined with `--user username:password` to add BasicAuth password protection.

Once downloaded and booted, SilverBullet will print out a URL to open SB in your browser. Please make note of [[@tls|the use of HTTPs]].

## Upgrading SilverBullet
SilverBullet is regularly updated. To get the latest and greatest, simply run:

```shell
silverbullet upgrade
```

And restart SilverBullet. You should be good to go.

## Installing SilverBullet with Docker

There is a [docker image on docker hub](https://hub.docker.com/r/zefhemel/silverbullet). To use it, first create a volume to keep your space (markdown) files:

```shell
docker volume create myspace
```

Then, run the container, e.g., as follows:

```shell
docker run -p 3000:3000 -v myspace:/space -d zefhemel/silverbullet
```

To configure various things such as authentication, use [[@env|environment variables]], e.g. to enable single-user auth:

```shell
docker run -p 3000:3000 -v myspace:/space -d -e SB_USER=me:letmein zefhemel/silverbullet
```

To build your own version of the docker image, run `./scripts/build_docker.sh`.

You can also use docker-compose if you prefer. From a silverbullet check-out run:

```shell
PORT=3000 docker-compose up
```

or similar.

To upgrade, simply pull the latest docker image (rebuilt and pushed after every commit to "main") and start the new container.

```shell
docker pull zefhemel/silverbullet
```

## Running SilverBullet on your network/Internet
$tls
For SilverBullet to be offline capable (loadable without a network connection) it needs to be accessed either via `localhost` or via TLS (a `https://`) URL. The most straightforward way to do this is by using [Caddy](https://caddyserver.com/). Caddy can automatically provision an SSL certificate for you.

When you’re deploying on a public server accessible to the Internet, you can do this as follows:

```shell
$ sudo caddy reverse-proxy --to :3000 --from yourdomain.com:443
```

If you’re deploying on a local network and access your server via a VPN, this is a bit more tricky. The recommended setup here is to use [Tailscale](https://tailscale.com/) which now [supports TLS certificates for your VPN servers](https://tailscale.com/kb/1153/enabling-https/). Once you have this enabled, get a certificate via:

```shell
$ tailscale cert yourserver.yourtsdomain.ts.net
```

Caddy can automatically find these certificates once provisioned, so you can just run:

```shell
$ sudo caddy reverse-proxy --to :3000 --from yourserver.yourtsdomain.ts.net:443
```

If you access SilverBullet via plain HTTP (outside of localhost) everything _should_ still mostly work, except offline mode.

## Environment variables
$env
You can configure SB with environment variables instead of flags as well. The following environment variables are supported:

* `SB_USER`: Sets single-user credentials (like `--user`), e.g. `SB_USER=pete:1234`
* `SB_PORT`: Sets the port to listen to, e.g. `SB_PORT=1234`
* `SB_FOLDER`: Sets the folder to expose, e.g. `SB_FOLDER=/space`
* `SB_AUTH`: Loads an [[Authentication]] database from a (JSON encoded) string, e.g. `SB_AUTH=$(cat /path/to/.auth.json)`

## Using Authelia
You need to adjust a few configuration options in [[Authelia]] in order for SilverBullet to work as intended.

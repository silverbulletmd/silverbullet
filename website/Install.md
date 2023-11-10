Installing SilverBullet as a (local) web server is pretty straightforward.

The idea is simple: you run the web server (instructions below), point your browser at it, and _go, go, go_! You can access the URL via your desktop browser but also a mobile one. You could even go _full-on YOLO_ (that’s a technical term), and install it on a public cloud server somewhere and access it that way (be sure to at least enable authentication and put SSL on top of it, though).

You have two options to install and run SilverBullet as a server:

1. Installation via Deno on your host system
2. Running it with Docker

In either case, check the notes [[@tls|on using TLS]].

## Installation via Deno
$deno
This consists of two steps (unless Deno is already installed — in which case we’re down to one):

1. [Install Deno](https://deno.land/manual/getting_started/installation)
2. Installing SilverBullet itself (steps below)

### Install SilverBullet
With Deno installed, run:

```shell
deno install -f --name silverbullet --unstable -A https://get.silverbullet.md
```

This will give you (and when you use `silverbullet upgrade`) the latest stable release. If you prefer to live on the bleeding edge, you can install using the following command instead:

```shell
deno install -f --name silverbullet --unstable -A https://silverbullet.md/silverbullet.js
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
$docker
There is a [docker image on docker hub](https://hub.docker.com/r/zefhemel/silverbullet). The image comes in two flavors:

* 64-bit Intel
* 64-bit ARM (e.g. for Raspberry Pis and Macs)

There is no 32-bit version of Deno, and therefore we cannot offer a 32-bit version of SilverBullet either.

To use the docker container, first create a volume to keep your space (markdown) files:

```shell
docker volume create myspace
```

Then, run the container, e.g., as follows:

```shell
docker run -p 3000:3000 -v myspace:/space -d zefhemel/silverbullet
```

The `zefhemel/silverbullet` image will give you the latest released version. This is equivalent to `zefhemel/silverbullet:latest`. If you prefer, you can also pin to a specific release, e.g. `zefhemel/silverbullet:0.3.7`. If you prefer to live on the bleeding edge, you can use the `zefhemel/silverbullet:edge` image, which is updated on every commit to the `main` brain.

To configure various things such as authentication, use [[@env|environment variables]], e.g. to enable single-user auth:

```shell
docker run -p 3000:3000 -v myspace:/space -d -e SB_USER=me:letmein zefhemel/silverbullet
```

To build your own version of the docker image, run `./scripts/build_docker.sh`.

To upgrade, simply pull the latest docker image and start the new container.

```shell
docker pull zefhemel/silverbullet
```

## Exposing SilverBullet to your network/Internet
$tls
Running SilverBullet on your machine is cool, but you likely want to access it from elsewhere as well (other machines on your network, your mobile device), perhaps even from outside your home. For this you either need to use a VPN, or expose SB to the public Internet. In either scenario, be sure to use [[Authentication]].

To expose your SilverBullet instance to the Internet, you have a few options:

* [[Deployments/ngrok]]: the easiest solution to exposing your _locally running_ SilverBullet to the Internet
* [[Deployments/Caddy]]: the easiest solution to expose SilverBullet running on a publicly accessible server to the Internet (but local network as well using Tailscale)

If you access SilverBullet via plain HTTP (outside of localhost) everything _should_ still mostly work, except offline mode.

## Environment variables
$env
You can configure SB with environment variables instead of flags as well. The following environment variables are supported:

* `SB_USER`: Sets single-user credentials (like `--user`), e.g. `SB_USER=pete:1234`
* `SB_HOSTNAME`: Set to the hostname to bind to (defaults to `127.0.0.0`, set to `0.0.0.0` to accept outside connections)
* `SB_PORT`: Sets the port to listen to, e.g. `SB_PORT=1234`
* `SB_FOLDER`: Sets the folder to expose, e.g. `SB_FOLDER=/space`
* `SB_AUTH`: Loads an [[Authentication]] database from a (JSON encoded) string, e.g. `SB_AUTH=$(cat /path/to/.auth.json)`
* `SB_SYNC_ONLY`: Runs the server in a "dumb" space store only mode (not indexing content or keeping other state), e.g. `SB_SYNC_ONLY=1`

## Using Authelia
You need to adjust a few configuration options in [[Authelia]] in order for SilverBullet to work as intended.

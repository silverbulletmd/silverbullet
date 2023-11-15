Let’s start with the simplest, local machine setup:

## Local machine setup
Installing SilverBullet as a (local) web server is pretty straightforward, if you’re comfortable with the terminal, at least.

The setup is simple: in a terminal run the silverbullet server process on your machine, then connect to it locally from your browser.

You have two options here:

1. Installation via [Deno](https://deno.com/) (the awesome JavaScript runtime)
2. Installation via [Docker](https://www.docker.com/) (the awesome container runtime)

### Installation via Deno
$deno
This consists of two steps (unless Deno is already installed — in which case we’re down to one):

1. [Install Deno](https://deno.land/manual/getting_started/installation)
2. Install SilverBullet itself (steps below)

After having installed Deno ([instructions on its website](https://docs.deno.com/runtime/manual/getting_started/installation)) run:

```shell
deno install -f --name silverbullet --unstable -A https://get.silverbullet.md
```

You only have to do this once.

This will give you (and when you use `silverbullet upgrade`) the latest stable release. If you prefer to live on the bleeding edge, you can install using the following command instead:

```shell
deno install -f --name silverbullet --unstable -A https://silverbullet.md/silverbullet.js
```

Either command will install `silverbullet` into your `~/.deno/bin` folder (which should already be in your `$PATH` if you followed the Deno install instructions).

To run SilverBullet, create a folder for your pages (it can be empty or be an existing folder with `.md` files) and run the following command in your terminal:

```shell
silverbullet <pages-path>
```

By default, SilverBullet will bind to port `3000`; to use a different port, use the `-p` flag.

For security reasons, by default, SilverBullet only allows connections via `localhost` (or `127.0.0.1`). To also allow connections from the network, pass a `-L 0.0.0.0` flag (0.0.0.0 for all connections, or insert a specific address to limit the host), ideally combined with `--user username:password` to add simple password protection.

Once downloaded and booted, SilverBullet will print out a URL to open SB in your browser.

#### Upgrading SilverBullet
SilverBullet is regularly updated. To get the latest and greatest, simply run:

```shell
silverbullet upgrade
```

And restart SilverBullet. You should be good to go.

### Installing SilverBullet with Docker
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

The `zefhemel/silverbullet` image will give you the latest released version. This is equivalent to `zefhemel/silverbullet:latest`. If you prefer, you can also pin to a specific release, e.g. `zefhemel/silverbullet:0.5.5`. If you prefer to live on the bleeding edge, you can use the `zefhemel/silverbullet:edge` image, which is updated on every commit to the `main` brain.

To configure various things such as authentication, use [[@env|environment variables]], e.g. to enable single-user auth:

```shell
docker run -p 3000:3000 -v myspace:/space -d -e SB_USER=me:letmein zefhemel/silverbullet
```

To build your own version of the docker image, run `./scripts/build_docker.sh`.

To upgrade, simply pull the latest docker image and start a new container.

```shell
docker pull zefhemel/silverbullet
```

## Configuration
SilverBullet is partially configured via flags (run it with `--help`) or alternatively via environment variables and partially via a [[SETTINGS]] page in your space.

## Environment variables
$env
You can configure SB with environment variables instead of flags, which is probably what you want to do in a docker setup. The following environment variables are supported:

* `SB_USER`: Sets single-user credentials (like `--user`), e.g. `SB_USER=pete:1234`
* `SB_HOSTNAME`: Set to the hostname to bind to (defaults to `127.0.0.0`, set to `0.0.0.0` to accept outside connections)
* `SB_PORT`: Sets the port to listen to, e.g. `SB_PORT=1234`
* `SB_FOLDER`: Sets the folder to expose, e.g. `SB_FOLDER=/space`
* `SB_AUTH`: Loads an [[Authentication]] database from a (JSON encoded) string, e.g. `SB_AUTH=$(cat /path/to/.auth.json)`
* `SB_SYNC_ONLY`: Runs the server in a "dumb" space store only mode (not indexing content or keeping other state), e.g. `SB_SYNC_ONLY=1`

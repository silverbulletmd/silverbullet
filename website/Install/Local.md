Installing SilverBullet as a (local) web server is pretty straightforward, if you’re comfortable with the terminal, at least.

The basic setup is simple: in a terminal, run the silverbullet server process on your machine, then connect to it locally from your browser via localhost.

You have two options here:

1. Installation via [[$deno|Deno]] (the awesome JavaScript runtime)
2. Installation via [[$docker|Docker]] (the awesome container runtime)

After choose either, be sure to checkout all [[Install/Configuration]] options as well.

# Installing using Deno
$deno
This consists of two steps (unless [Deno](https://deno.com/) is already installed — in which case we’re down to one):

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

For security reasons, by default, SilverBullet only allows connections via `localhost` (or `127.0.0.1`). To also allow connections from the network, pass a `-L0.0.0.0` flag (0.0.0.0 for all connections, or insert a specific address to limit the host), combined with `--user username:password` to add simple [[Authentication]].

Once downloaded and booted, SilverBullet will print out a URL to open in your browser.

## Upgrading SilverBullet
SilverBullet is regularly updated. To get the latest and greatest, simply run:

```shell
silverbullet upgrade
```

And restart SilverBullet. You should be good to go. Also run

```shell
deno upgrade
```

Regularly, to get the latest and greatest deno.

# Installing using Docker
$docker
There is a [docker image on docker hub](https://hub.docker.com/r/zefhemel/silverbullet). The image comes in two flavors:

* 64-bit Intel
* 64-bit ARM (e.g. for Raspberry Pis and Macs)

There is no 32-bit version of Deno, and therefore we cannot offer a 32-bit version of SilverBullet either. Most people run 64-bit OSes these days, an exception may be Raspberry Pis. Recent (RPI 3 and later) can run 64-bit Linux as well, you may have to re-image, though.

A few key things to note on the SilverBullet container:
* The container binds to port `3000`, so be sure to export that, e.g. via `-p 3000:3000` (note: the first `3000` is the external port)
* The container uses whatever is volume-mapped to `/space` as the space root folder. You can connect a docker volume, or a host folder to this, e.g. `-v /home/myuser/space:/space`
* SilverBullet will, conveniently, detect the UNIX owner (UID and GID) of the folder mapped into `/space` and run the server process with the same UID and GID so that permissions will just magically work. If you’d like to override this UID, set the `PUID` and `PGID` environment variables.

To boot up the container:

```shell
docker run -p 3000:3000 -v /path/to/space/folder:/space -d zefhemel/silverbullet
```

The `zefhemel/silverbullet` image will give you the latest released version. This is equivalent to `zefhemel/silverbullet:latest`. If you prefer, you can also pin to a specific release, e.g. `zefhemel/silverbullet:0.5.5`. If you prefer to live on the bleeding edge, you can use the `zefhemel/silverbullet:edge` image, which is updated on every commit to the `main` brain.

To configure various things such as authentication, use [[@env|environment variables]], e.g. to enable single-user auth:

```shell
docker run -p 3000:3000 -v myspace:/space -d -e SB_USER=me:letmein zefhemel/silverbullet
```

## Upgrade
You can upgrade your image simply by pulling a new version of the image using `docker pull zefhemel/silverbullet`. However, it is recommended you use a tool like [watchtower](https://github.com/containrrr/watchtower) to automatically update your docker images and restart them.

## Docker compose
Here is a simple `compose.yml` that runs SilverBullet as well as [watchtower](https://github.com/containrrr/watchtower), which will check for new SilverBullet upgrades daily (the default) and upgrade automatically.

Instructions:
* Please replace the password defined in `SB_USER` with something sensible such as `admin:b3stp4ssword3vah`
* This volume uses the `notes` directory (that presumably exists) in the same directory as the `compose.yml` file as the place where SB will keep its space.

```yaml
services:
  silverbullet:
    image: zefhemel/silverbullet:edge
    restart: unless-stopped
    environment:
    - SB_USER="admin:admin"
    volumes:
      - ./notes:/space
    ports:
      - 3000:3000
  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Boot this up via:

```shell
docker-compose up -d
```

And watch for logs with:

```shell
docker-compose logs -f
```

## Building the docker image
To build your own version of the docker image, run `./scripts/build_docker.sh`.

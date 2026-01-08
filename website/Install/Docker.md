[Docker](https://www.docker.com/) is a convenient and secure way to install server applications either locally or on a server you control. If you don’t have docker already running on your machine and are macOS user, consider giving [OrbStack](https://orbstack.dev/) a try — it’s a super nice docker experience.

Conveniently, SilverBullet is published as a [docker image on GHCR](https://github.com/silverbulletmd/silverbullet/pkgs/container/silverbullet). The image comes in two flavors:

* 64-bit Intel
* 64-bit ARM (e.g. for Raspberry Pis and Apple Silicon macs)

There is no 32-bit version of SilverBullet. Most people run 64-bit OSes these days, an exception may be Raspberry Pis. Recent (RPI 3 and later) can run 64-bit Linux as well.

> **warning** Warning
> To access SilverBullet outside of `localhost` you will need to set up [[TLS]].

# Release channels
Every release version of SilverBullet is tagged with its version number, but there are two release channels you can use (they automatically update):

* `:latest` always points to the latest _release_
* `:v2` always points to the latest _edge build_ (the last commit to `main`), use this if you want to live on the bleeding edge.

# Container
* The container binds to port `3000`, so be sure to port-map that, e.g. via `-p 3000:3000` (note: the first `3000` is the external port)
* By default SilverBullet runs _unauthenticated_, this is not safe at it allows anybody on your network to access your instance freely. Therefore, in a docker setup **always** set the `SB_USER=username:password` environment variable (see below).
* The container uses whatever is volume-mapped to `/space` as the space root folder. You can connect a docker volume, or a host folder to this, e.g. `-v /home/myuser/space:/space`
* SilverBullet will detect the UNIX owner (UID and GID) of the folder mapped into `/space` and run the server process with the same UID and GID so that permissions will just magically work. If you’d like to override this UID, set the `PUID` and `PGID` environment variables (see [[Install/Configuration]] for details).
* The Docker image is based on [Alpine](https://alpinelinux.org/). If you'd like to install additional packages into it, see [[#Installing additional packages]] below.

> **note** Note
> The same docker images are both available from [GHCR](https://github.com/silverbulletmd/silverbullet/pkgs/container/silverbullet) and [Docker Hub](https://hub.docker.com/r/zefhemel/silverbullet), use whichever you prefer.

## Versions
To check the version you’re running, use the ${widgets.commandButton("Client: Version")} command. Note that after an upgrade you may have to reload your (browser) client **twice**, to fully activate the new version.

# Docker Compose
[Docker compose](https://docs.docker.com/compose/) is a simple tool to manage running of multiple containers on a server you control, it is distributed with (modern) versions of docker. It is the recommended way to manage SilverBullet.

Below is a basic `compose.yml` that runs SilverBullet, check [[Install/Configuration]] for additional configuration options.

Instructions:
* Replace the password defined in `SB_USER` with something sensible such as `admin:b3stp4ssword3vah`
* This volume uses the `./space` directory (will be auto-created if it doesn’t already exist) in the same directory as the `compose.yml` file as the place where SB will keep its space. You may replace this with whatever location you keep your notes.

```yaml
services:
  silverbullet:
    image: ghcr.io/silverbulletmd/silverbullet:latest
    restart: unless-stopped
    environment:
    - SB_USER=admin:password
    volumes:
      - ./space:/space
    ports:
      - 3000:3000
```

Boot this up via:

```shell
docker compose up -d
```

And watch for logs with:

```shell
docker compose logs -f
```

## Upgrading
To upgrade, change the specific version you point to in your `compose.yml` file (not necessary when using `:latest` or `:v2`) and then:

```shell
docker compose pull
docker compose stop
docker compose up -d
```

# Plain Docker
If you don’t want to use docker compose, you can run SilverBullet “raw” as follows:

```shell
# Create a local folder "space" to keep files in
mkdir -p space
# Run the SilverBullet docker container in the foreground
docker run -it --rm -p 3000:3000 \
  --name silverbullet \
  -v ./space:/space \
  -e SB_USER=user:password \
  ghcr.io/silverbulletmd/silverbullet:latest
```

This will run SilverBullet in the foreground, interactively, so you can see the logs and instructions. Replace `user` and `password` with something more sensible.

If this all works fine, you can stop the container with `Ctrl-c`.

You probably want to run the container in daemon (background) mode, give it a name, and automatically have it restart after you e.g. reboot your machine:

```shell
docker run -d --restart unless-stopped \
  --name silverbullet \
  -p 3000:3000 \
  -v ./space:/space \
  -e SB_USER=user:password \
  ghcr.io/silverbulletmd/silverbullet:latest
```

There you go!

## Upgrades
To upgrade your version of SilverBullet, first pull the new image:

```shell
docker pull ghcr.io/silverbulletmd/silverbullet:latest
# Then stop the current container
docker stop silverbullet
# Remove the existing container
docker rm silverbullet
```

Then start the container again as before.

# Installing additional packages
If you would like to install additional packages into your docker container (e.g. to call via [[API/shell]]), you can do so by creating a [[CONTAINER_BOOT]] page in your space. Whatever you put in this page, will be run as a bash script upon container boot (hence its name).

In practice, you’ll likely want to put `apk add` commands install the (Alpine) packages you would like to install.

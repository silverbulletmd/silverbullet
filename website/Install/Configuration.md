SilverBullet is primarily configured via environment variables. This page gives a comprehensive overview of all configuration options. You can set these ad-hoc when running the SilverBullet server, or e.g. in your [[Install/Docker|docker-compose file]].

# General configuration

* `SB_INDEX_PAGE`: Sets the default page to load, defaults to `index`.
* `SB_SPACE_IGNORE`: Ignore certain path patterns based on a .gitignore style format, e.g. `SB_SPACE_IGNORE="IgnoreMe/*"`.

# Network
* `SB_HOSTNAME`: Set to the hostname to bind to (defaults to `127.0.0.0`, set to `0.0.0.0` to accept outside connections for the local deno setup, defaults to `0.0.0.0` for docker)
* `SB_PORT`: Sets the port to listen to, e.g. `SB_PORT=1234`, default is `3000` * `SB_URL_PREFIX`: Host SilverBullet on a particular URL prefix, e.g. `SB_URL_PREFIX=/notes`

# Authentication
SilverBullet supports basic authentication for a single user.

* `SB_USER`: Sets single-user credentials, e.g. `SB_USER=pete:1234` allows you to login with username “pete” and password “1234”.
* `SB_AUTH_TOKEN`: Enables `Authorization: Bearer <token>` style authentication on the [[HTTP API]].
* `SB_LOCKOUT_LIMIT`: Specifies the number of failed login attempt before locking the user out (for a `SB_LOCKOUT_TIME` specified amount of seconds), defaults to `10`
* `SB_LOCKOUT_TIME`: Specifies the amount of time (in seconds) a client will be blocked until attempting to log back in.

# Storage
SilverBullet supports storage backends for keeping your [[Spaces]] content. Right now the only supported backend is to use your local disk.

## Disk storage
This is the default and simplest backend to use: a folder on disk. It is configured as follows:

* `SB_FOLDER`: Sets the folder to expose. In the docker container, this defaults to `/space`.


# Run mode
* `SB_READ_ONLY` (==Experimental==): If you want to run the SilverBullet client and server in read-only mode (you get the full SilverBullet client, but all edit functionality and commands are disabled), you can do this by setting this environment variable to `true`. Upon the server start a full space index will happen, after which all write operations will be disabled.

# Security
SilverBullet enables plugs to run shell commands. This is potentially unsafe. If you don’t need this, you can disable this functionality:

* `SB_SHELL_BACKEND`: Enable/disable running of shell commands from plugs, defaults to `local` (enabled), set to `off` to disable. It is only enabled when using a local folder for [[#Storage]].

# Docker
Configuration only relevant to docker deployments:

* `PUID`: Runs the server process with the specified UID (default: whatever user owns the `/space` mapped folder)
* `PGID`: Runs the server process with the specified GID (default: whatever group owns the `/space` mapped folder)\
* `SB_APT_PACKAGES`: will install additional (ubuntu) packages inside the container upon boot. Example: `SB_APT_PACKAGES="ripgrep pandoc"`
  **Note:** This installation happens asynchronously in the background (you can see it happen in the server output) unless `SB_APT_SYNC` is set (see bellow)
* `SB_APT_SYNC`: when set, will _first_ install APT packages configured with `SB_APT_PACKAGES` before booting SilverBullet itself.

# Web app manifest
Configure aspects of web app appearance:

* `SB_NAME`: Sets `name` and `short_name` members of web app manifest to whatever specified in `SB_NAME`
* `SB_DESCRIPTION`: Sets `description` member of web app manifest to whatever specified in `SB_DESCRIPTION`

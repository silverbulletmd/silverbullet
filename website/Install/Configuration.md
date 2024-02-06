SilverBullet is primarily configured via environment variables. This page gives a comprehensive overview of all configuration options. You can set these ad-hoc when running the SilverBullet server, or e.g. in your [[Install/Docker|docker-compose file]].

# Network
Note: these options are primarily useful for [[Install/Deno]] deployments, not so much for [[Install/Docker]].

* `SB_HOSTNAME`: Set to the hostname to bind to (defaults to `127.0.0.0`, set to `0.0.0.0` to accept outside connections for the local deno setup, defaults to `0.0.0.0` for docker)
* `SB_PORT`: Sets the port to listen to, e.g. `SB_PORT=1234`, default is `3000`

# Authentication
SilverBullet supports basic authentication for a single user.

* `SB_USER`: Sets single-user credentials, e.g. `SB_USER=pete:1234` allows you to login with username “pete” and password “1234”.
* `SB_AUTH_TOKEN`: Enables `Authorization: Bearer <token>` style authentication on the [[API]] (useful for [[Sync]] and remote HTTP storage backends).

# Storage
SilverBullet supports multiple storage backends for keeping your [[Spaces]] content.

## Disk storage
This is the default and simplest backend to use: a folder on disk. It is configured as follows:

* `SB_FOLDER`: Sets the folder to expose. In the docker container, this defaults to `/space`.

## AWS S3 bucket storage
It is also possible to use an S3 bucket as storage. For this, you need to create a bucket, create an IAM user and configure access to it appropriately.

Since S3 doesn’t support an efficient way to store custom metadata, this mode does require a [[#Database]] configuration (see below) to keep all file metadata.

S3 is configured as follows:

* `SB_FOLDER`: Set to `s3://prefix`. `prefix` can be empty, but if set, this will prefix all files with `prefix/` to support multiple spaces being connected to a single bucket.
* `AWS_ACCESS_KEY_ID`: an AWS access key with read/write permissions to the S3 bucket
* `AWS_SECRET_ACCESS_KEY`: an AWS secret access key with read/write permissions to the S3 bucket
* `AWS_BUCKET`: the name of the S3 bucket to use (e.g `my-sb-bucket`)
* `AWS_ENDPOINT`: e.g. `s3.eu-central-1.amazonaws.com`
* `AWS_REGION`: e.g. `eu-central-1`

## Database storage
It is also possible to store space content in the [[#Database]]. While not necessarily recommended, it is a viable way to set up a simple deployment of SilverBullet on e.g. [[Install/Deno Deploy]]. Large files will automatically be chunked to avoid limits the used database may have on value size.

This mode is configured as follows:

* `SB_FOLDER`: set to `db://`

The database configured via [[#Database]] will be used.

## HTTP storage
While not particularly useful stand-alone (primarily for [[Sync]]), it is possible to store space content on _another_ SilverBullet installation via its [[API]].

This mode is configured as follows:

* `SB_FOLDER`: set to the URL of the other SilverBullet server, e.g. `https://mynotes.mydomain.com`
* `SB_AUTH_TOKEN`: matching the authorization token (configured via [[#Authentication]] on the other end) to use for authorization.

# Database
SilverBullet requires a database backend to (potentially) keep various types of data:

* Indexes for e.g. [[Objects]]
* Storing some encryption-related secrets (for [[Authentication]])
* Space content, when the “Database storage” storage backend is used

Currently, only two databases are supported: [Deno KV](https://deno.com/kv) and a dummy in-memory database.

## Deno KV database
When self-hosting SilverBullet (that is, on any server other than on [[Install/Deno Deploy]]), KV uses a local SQLite file to keep data. This is efficient and performant.

KV can be configured as follows:

* `SB_DB_BACKEND`: `kv` (default, so can be omitted)
* `SB_KV_DB`: path to the file name of the (SQLite) database to store data in, defaults to `.silverbullet.db` in the space’s folder (when kept on disk).

When SilverBullet runs on [[Install/Deno Deploy]] it automatically uses its cloud implementation of KV.

## Memory database
The in-memory database is only useful for testing. 

* `SB_DB_BACKEND`: `memory`

# Run mode
* `SB_SYNC_ONLY`: If you want to run SilverBullet in a mode where the server purely functions as a simple file store and doesn’t index or process content on the server, you can do so by setting this environment variable to `true`. As a result, the client will always run in the Sync [[Client Modes|client mode]].
* `SB_READ_ONLY` (==Experimental==): If you want to run the SilverBullet client and server in read-only mode (you get the full SilverBullet client, but all edit functionality and commands are disabled), you can do this by setting this environment variable to `true`. Upon the server start a full space index will happen, after which all write operations will be disabled.

# Security
SilverBullet enables plugs to run shell commands. This is used by e.g. the [[Plugs/Git]] plug to perform git commands. This is potentially unsafe. If you don’t need this, you can disable this functionality:

* `SB_SHELL_BACKEND`: Enable/disable running of shell commands from plugs, defaults to `local` (enabled), set to `off` to disable. It is only enabled when using a local folder for [[#Storage]].
* `SB_SPACE_SCRIPT`: Enable/disables [[Space Script]]. Defaults to `on`, set to `off` to disable this feature altogether.


# Docker
Configuration only relevant to docker deployments:

* `PUID`: Runs the server process with the specified UID (default: whatever user owns the `/space` mapped folder)
* `GUID`: Runs the server process with the specified GID (default: whatever group owns the `/space` mapped folder)

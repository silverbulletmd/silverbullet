#getting-started

To be secure it is recommended you enable authentication. Here are the options.

# Default: no authentication
Out of the box, SilverBullet runs **unauthenticated** — anyone who can reach the server’s port can read and write your entire space. There are no built-in default credentials. This is intentional: for `localhost` use it’s the simplest possible setup. As soon as your server is reachable from anywhere else, you need to turn authentication on yourself.

# Single-user authentication
SilverBullet’s built-in auth is a single set of credentials, set via the `SB_USER` environment variable in `username:password` form. There is intentionally no notion of multiple users or signup flow — a SilverBullet [[Space]] is a personal space.

If you need multi-user style access control (different people, SSO, MFA, …), put SilverBullet behind an [[Authentication Proxy]] (Authelia, Authentik, Cloudflare Access, etc.) and let that handle identity.

# Enabling authentication
Set `SB_USER` when starting the server. For the [[Install/Binary]]:

```shell
SB_USER=pete:1234 ./silverbullet my-space
```

For [[Install/Docker]]:

```shell
docker run -e SB_USER=pete:1234 ...
```

This allows `pete` to log in with password `1234`. When authentication is enabled, SilverBullet shows a login page on first access.

## Changing the user or password
There’s nothing to “reset” — just restart the server with a different `SB_USER`. Existing browser sessions get invalidated on the next request and you (or whoever) will be prompted to log in again.

# Remember me
The login page has a "Remember me" checkbox. When checked, the session persists across browser restarts. The session duration defaults to 7 days and can be configured:

* `SB_REMEMBER_ME_HOURS`: Sets session duration in hours (default: 168, i.e. 7 days)

# Lockout protection
To prevent brute-force attacks, SilverBullet locks out clients after too many failed login attempts:

* `SB_LOCKOUT_LIMIT`: Number of failed attempts before lockout (default: 10)
* `SB_LOCKOUT_TIME`: Duration of lockout in seconds (default: 60)

# API authentication
For programmatic access via the [[HTTP API]], you can use bearer token authentication:

* `SB_AUTH_TOKEN`: Sets a token for `Authorization: Bearer <token>` style authentication

This is useful for scripts, automation, or integrating SilverBullet with other tools.

# Authentication proxy
Alternatively, or in addition, you can use an [[Authentication Proxy]] to delegate authentication to an external system (like Authelia, Authentik, or a reverse proxy's built-in auth). This is common in more complex self-hosted setups.

For all authentication-related configuration options, see [[Install/Configuration#Authentication]].

#getting-started

SilverBullet supports simple authentication for a single user.

# User authentication
Set the `SB_USER` environment variable with a `username:password` combination to enable authentication:

```shell
docker run -e SB_USER=pete:1234 ...
```

This allows `pete` to log in with password `1234`. When authentication is enabled, SilverBullet shows a login page on first access.

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

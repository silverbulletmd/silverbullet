# SilverBullet deployment examples
Below you'll find **user examples** on how to deploy SilverBullet using different alternatives.

**NOTE**: paths, usernames and passwords are just examples and should be updated to your own personal environment

**NOTE**: These deployments are based in a Linux environment though they may perfectly work in Windows and/or MacOS with minimal changes

## How to Deploy Silverbullet with Docker

This example will work both if you use `docker-compose.yml` files or a management tool like [portainer](https://www.portainer.io/).

We will configure SilverBullet with [caddy](https://caddyserver.com/) as reverse proxy, [redis](https://redis.io/) to store and share certificates and [authelia](https://www.authelia.com/) for authentication.

### Docker compose file

**IMPORTANT**: Some volumes configured below are **bind mounts** which need to be configured providing a physical folder from your machine. Don't forget to create them before turning up the containers.

**NOTE**: We are configuring SilverBullet with basic auth assuming there may be more users and applications in the server. Feel free to remove it if that is not the case, to avoid a double login requirement.

```yml
  silverbullet:
    container_name: silverbullet
    image: zefhemel/silverbullet
    volumes:
      - /media/silverbullet/space:/space
    ports:
      - 3000:3000
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - SB_USER=${USERNAME}:${PASSWORD} #feel free to remove this if not needed

  redis:
    container_name: redis
    image: "redis:alpine"
    command: redis-server --save "" --appendonly "no"
    restart: always
    networks:
      - searxng
    tmpfs:
      - /var/lib/redis
    cap_drop:
      - ALL
    cap_add:
      - SETGID
      - SETUID
      - DAC_OVERRIDE

  caddy:
    container_name: caddy
    image: caddy:latest
    network_mode: host
    restart: always
    volumes:
      - /media/caddy/config/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data:rw
      - caddy-config:/config:rw
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
      - DAC_OVERRIDE

  authelia:
    image: authelia/authelia
    container_name: authelia
    volumes:
      - /media/authelia/config:/config 
    ports:
      - 9091:9091
    environment:
      - PUID=1000
      - PGID=1000

volumes:
  caddy-data:
  caddy-config:
```

In case you use SilverBullet basic auth feature, you'll need to provide the following `env` file

```shell
USERNAME=User
PASSWORD=REDACTED
```

### authelia

authelia requires two configuration files: `users_databases.yml` and `configuration.yml`
Please check the official [documentation](https://www.authelia.com/configuration/prologue/introduction) for all the possibilities.
Below you can find a very simple example that will work for our use case.

#### User configuration

Run the following command in `/media/authelia/config/` folder in order to generate the argon2id password

```shell
docker run -v ./configuration.yml:/configuration.yml -it authelia/authelia:latest authelia crypto hash generate --config /configuration.yml
```

Then copy the password in the `/media/authelia/config/users_database.yml` file

- users_database.yml

```yml
users:
  User:
    disabled: false
    displayname: "User"
    password: "$argon2id$v=19$m=65536,t=3,p=4$blahblahblah"
    email: User@domain.com
    groups:
      - admins
```

#### configuration.yml

Simplified version, with a lot of boilerplate removed. Official template can be found [here](https://github.com/authelia/authelia/blob/master/config.template.yml)

`/media/authelia/config/configuration.yml`

```yml
# yamllint disable rule:comments-indentation
---
###############################################################################
#                           Authelia Configuration                            #
###############################################################################

## The theme to display: light, dark, grey, auto.
theme: dark

## The secret used to generate JWT tokens when validating user identity by email confirmation. JWT Secret can also be
## set using a secret: https://www.authelia.com/c/secrets
jwt_secret: 78sfdgg3t3gwv7avjheh43

## Default redirection URL
##
## If user tries to authenticate without any referer, Authelia does not know where to redirect the user to at the end
## of the authentication process. This parameter allows you to specify the default redirection URL Authelia will use
## in such a case.
##
## Note: this parameter is optional. If not provided, user won't be redirected upon successful authentication.
default_redirection_url: https://google.com/

##
## Server Configuration
##
server:
  ## The address to listen on.
  host: 0.0.0.0
  ## The port to listen on.
  port: 9091
  ## Enables the pprof endpoint.
  enable_pprof: false
  ## Enables the expvars endpoint.
  enable_expvars: false
  ## Disables writing the health check vars to /app/.healthcheck.env which makes healthcheck.sh return exit code 0.
  ## This is disabled by default if either /app/.healthcheck.env or /app/healthcheck.sh do not exist.
  disable_healthcheck: false

  ## Authelia by default doesn't accept TLS communication on the server port. This section overrides this behaviour.
  tls:
    ## The path to the DER base64/PEM format private key.
    key: ""
    ## The path to the DER base64/PEM format public certificate.
    certificate: ""
    ## The list of certificates for client authentication.
    client_certificates: []


##
## Log Configuration
##
log:
  ## Level of verbosity for logs: info, debug, trace.
  level: debug

##
## Telemetry Configuration
##
telemetry:
  ##
  ## Metrics Configuration
  ##
  metrics:
    ## Enable Metrics.
    enabled: false
    ## The address to listen on for metrics. This should be on a different port to the main server.port value.
    address: tcp://0.0.0.0:9959

##
## TOTP Configuration
##
## Parameters used for TOTP generation.
totp:
  ## Disable TOTP.
  disable: false

  ## The issuer name displayed in the Authenticator application of your choice.
  issuer: authelia.com

  ## The TOTP algorithm to use.
  ## It is CRITICAL you read the documentation before changing this option:
  ## https://www.authelia.com/c/totp#algorithm
  algorithm: sha1

  ## The number of digits a user has to input. Must either be 6 or 8.
  ## Changing this option only affects newly generated TOTP configurations.
  ## It is CRITICAL you read the documentation before changing this option:
  ## https://www.authelia.com/c/totp#digits
  digits: 6

  ## The period in seconds a one-time password is valid for.
  ## Changing this option only affects newly generated TOTP configurations.
  period: 30

  ## The skew controls number of one-time passwords either side of the current one that are valid.
  ## Warning: before changing skew read the docs link below.
  skew: 1
  ## See: https://www.authelia.com/c/totp#input-validation to read
  ## the documentation.

  ## The size of the generated shared secrets. Default is 32 and is sufficient in most use cases, minimum is 20.
  secret_size: 32

##
## WebAuthn Configuration
##
## Parameters used for WebAuthn.
webauthn:
  ## Disable Webauthn.
  disable: false
  ## Adjust the interaction timeout for Webauthn dialogues.
  timeout: 60s
  ## The display name the browser should show the user for when using Webauthn to login/register.
  display_name: Authelia
  ## Conveyance preference controls if we collect the attestation statement including the AAGUID from the device.
  ## Options are none, indirect, direct.
  attestation_conveyance_preference: indirect
  ## User verification controls if the user must make a gesture or action to confirm they are present.
  ## Options are required, preferred, discouraged.
  user_verification: preferred


##
## NTP Configuration
##
## This is used to validate the servers time is accurate enough to validate TOTP.
ntp:
  ## NTP server address.
  address: "time.cloudflare.com:123"
  ## NTP version.
  version: 4
  ## Maximum allowed time offset between the host and the NTP server.
  max_desync: 3s
  ## Disables the NTP check on startup entirely. This means Authelia will not contact a remote service at all if you
  ## set this to true, and can operate in a truly offline mode.
  disable_startup_check: false
  ## The default of false will prevent startup only if we can contact the NTP server and the time is out of sync with
  ## the NTP server more than the configured max_desync. If you set this to true, an error will be logged but startup
  ## will continue regardless of results.
  disable_failure: false

authentication_backend:
    ## Password Reset Options.
  password_reset:
    ## Disable both the HTML element and the API for reset password functionality.
    disable: false
  refresh_interval: 5m
  file:
    path: /config/users_database.yml #this is where your authorized users are stored
    password:
      algorithm: argon2id
      iterations: 1
      key_length: 32
      salt_length: 16
      memory: 1024
      parallelism: 8

##
## Password Policy Configuration.
##
password_policy:
  ## The standard policy allows you to tune individual settings manually.
  standard:
    enabled: false
    ## Require a minimum length for passwords.
    min_length: 8
    ## Require a maximum length for passwords.
    max_length: 0
    ## Require uppercase characters.
    require_uppercase: true
    ## Require lowercase characters.
    require_lowercase: true
    ## Require numeric characters.
    require_number: true
    ## Require special characters.
    require_special: true
  ## zxcvbn is a well known and used password strength algorithm. It does not have tunable settings.
  zxcvbn:
    enabled: false
    ## Configures the minimum score allowed.
    min_score: 3

##
## Access Control Configuration
##
## Access control is a list of rules defining the authorizations applied for one resource to users or group of users.
##
access_control:
  ## Default policy can either be 'bypass', 'one_factor', 'two_factor' or 'deny'. It is the policy applied to any
  ## resource if there is no policy to be applied to the user.
  default_policy: deny

  rules:
    ## bypass rule
    - domain: 'auth.domain.com' #This should be your authentication URL
      policy: bypass
    - domain: 'silverbullet.domain.com'
      resources:
        - '/.client/manifest.json$'
        - '/.client/[a-zA-Z0-9_-]+.png$'
        - '/service_worker.js$'
      policy: bypass
    - domain: 'silverbullet.domain.com'
      subject:
        - 'group:admins'
      policy: one_factor


##
## Session Provider Configuration
##
## The session cookies identify the user once logged in.
## The available providers are: `memory`, `redis`. Memory is the provider unless redis is defined.
session:
  ## The name of the session cookie.
  name: authelia_session
  ## The domain to protect.
  ## Note: the authenticator must also be in that domain.
  ## If empty, the cookie is restricted to the subdomain of the issuer.
  domain: domain.com
  ## Sets the Cookie SameSite value. Possible options are none, lax, or strict.
  ## Please read https://www.authelia.com/c/session#same_site
  same_site: lax
  ## The secret to encrypt the session data. This is only used with Redis / Redis Sentinel.
  ## Secret can also be set using a secret: https://www.authelia.com/c/secrets
  secret: 3sdffgsdgs33452j2jhgjs9gdfg
  ## The value for expiration, inactivity, and remember_me_duration are in seconds or the duration notation format.
  ## See: https://www.authelia.com/c/common#duration-notation-format
  ## All three of these values affect the cookie/session validity period. Longer periods are considered less secure
  ## because a stolen cookie will last longer giving attackers more time to spy or attack.
  ## The time before the cookie expires and the session is destroyed if remember me IS NOT selected.
  expiration: 1h
  ## The inactivity time before the session is reset. If expiration is set to 1h, and this is set to 5m, if the user
  ## does not select the remember me option their session will get destroyed after 1h, or after 5m since the last time
  ## Authelia detected user activity.
  inactivity: 5m
  ## The time before the cookie expires and the session is destroyed if remember me IS selected.
  ## Value of -1 disables remember me.
  remember_me_duration: 1M

##
## Regulation Configuration
##
## This mechanism prevents attackers from brute forcing the first factor. It bans the user if too many attempts are made
## in a short period of time.
regulation:
  ## The number of failed login attempts before user is banned. Set it to 0 to disable regulation.
  max_retries: 3
  ## The time range during which the user can attempt login before being banned. The user is banned if the
  ## authentication failed 'max_retries' times in a 'find_time' seconds window. Find Time accepts duration notation.
  ## See: https://www.authelia.com/c/common#duration-notation-format
  find_time: 2m
  ## The length of time before a banned user can login again. Ban Time accepts duration notation.
  ## See: https://www.authelia.com/c/common#duration-notation-format
  ban_time: 5m

##
## Storage Provider Configuration
##
## The available providers are: `local`, `mysql`, `postgres`. You must use one and only one of these providers.
storage:
  local:
    path: /config/db.sqlite3 #this is your databse. You could use a mysql database if you wanted, but we're going to use this one.
  encryption_key: 345f2f5v6c54vg2ewesd

##
## Notification Provider
##
## Notifications are sent to users when they require a password reset, a Webauthn registration or a TOTP registration.
## The available providers are: filesystem, smtp. You must use only one of these providers.
notifier:
  ## You can disable the notifier startup check by setting this to true.
  disable_startup_check: true #true/false
  smtp:
    username: user@gmail.com #your email address
    password: apppassword #your email password
    host: smtp.gmail.com #email smtp server
    port: 587 #email smtp port
    sender: user@gmail.com
    subject: "[Authelia] {title}" #email subject
...
```

### caddy (reverse proxy)

Example of `/media/caddy/config/Caddyfile`

```yml
{
  admin off
}


## It is important to read the following document before enabling this section:
##     https://www.authelia.com/integration/proxies/caddy/#forwarded-header-trust#trusted-proxies
(trusted_proxy_list) {
       ## Uncomment & adjust the following line to configure specific ranges which should be considered as trustworthy.
      trusted_proxies 192.168.0.0/16
}


# Authelia Portal.
auth.domain.com {
        reverse_proxy localhost:9091 {
                ## This import needs to be included if you're relying on a trusted proxies configuration.
                import trusted_proxy_list
        }
}

silverbullet.domain.com {
        forward_auth localhost:9091 {
                uri /api/verify?rd=https://auth.domain.com/
                copy_headers Remote-User Remote-Groups Remote-Name Remote-Email

                ## This import needs to be included if you're relying on a trusted proxies configuration.
                import trusted_proxy_list
        }
        reverse_proxy localhost:3000 {
                ## This import needs to be included if you're relying on a trusted proxies configuration.
                import trusted_proxy_list
        }
}
```

### Syncing SilverBullet with Git

- Once the server is up and running we can install git [Plug](https://github.com/silverbulletmd/silverbullet/blob/main/website/%F0%9F%94%8C%20Plugs.md) (if not installed by default)

```yaml
- github:silverbulletmd/silverbullet-git/git.plug.js
```

- we need to create a git repository to sync automatically
  - Example: `https://github.com/user/silverbullet`
- Create a [github token](https://github.com/settings/tokens) to run `git pull` and `git push` within silverbullet
  - Example token: ghp_sdfasdfsdfZFwJGHFGDSF554a
- Now we initialize the repo and create a first push

```shell
cd /media/silverbullet/space
git init
git add index.md
git commit -m "first commit"
git branch -M main
git remote add origin https://ghp_sdfasdfsdfZFwJGHFGDSF554a@github.com/user/silverbullet.git
git push -u origin main
git branch --set-upstream-to=origin/main main
```

- Once we confirm github sync works from the terminal, we need to add our github identity inside the container
- Connect through portainer or the command line to the silverbullet console

```shell
docker exec -it silverbullet /bin/sh
cd /space
git config user.email "user@gmail.com"
git config --global user.name "user"
```

And we are **DONE**!
We can now use SilverBullet and run `Git Sync` everytime we would like to commit and sync our changes to github.

## How to Deploy Silverbullet with Deno

- We will use **cargo** to install deno for this use case

```shell
cargo install deno --locked
```

**NOTE**: Please refer to the [official documentation](https://deno.land/manual@v1.7.5/getting_started/setup_your_environment) to set up properly your environment.

- Now we proceed to install SilverBullet

```shell
deno install -f --name silverbullet -A https://get.silverbullet.md
```

### How to run SilverBullet at boot with systemd

- Based on: [Start SilverBullet on boot using systemctl](https://github.com/silverbulletmd/silverbullet/pull/388)
- Create `/usr/local/bin/silverbullet.sh` file and make it executable:

```sh
#!/bin/bash
## Script to start SilverBullet through Deno

/home/user/.cargo/bin/deno run --allow-all --no-config https://get.silverbullet.md/ /home/user/silverbullet > /home/user/sb.log 2> /home/user/sb.err
```

- Create `/etc/systemd/system/silverbullet.service` file:

```sh
[Unit]
Description=SilverBullet

[Service]
User=user
Type=simple
ExecStart=/usr/local/bin/silverbullet.sh

[Install]
WantedBy=multi-user.target
```

- Enable and start the service

```shell
sudo systemctl enable silverbullet.service
sudo systemctl start silverbullet.service
```

- Once SilverBullet is up and running, you'll have access to the logs and errors through the `sb.log` and `sb.err` files located in `/home/user`

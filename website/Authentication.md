SilverBullet supports simple authentication for a single user.

By setting the `SB_USER` environment variable with a username:password combination, you enable authentication for a single user. For instance:

```shell
docker run -e SB_USER=pete:1234 ...
```

Will let `pete` authenticate with password `1234`. 

For more options see [[Install/Configuration]].

Alternatively, or in addition, you can also use an [[Authentication Proxy]].
SilverBullet supports simple authentication for a single user.

By simply passing the `--user` flag with a username:password combination, you enable authentication for a single user. For instance:

```shell
silverbullet --user pete:1234 .
```

Will let `pete` authenticate with password `1234`. 

Alternatively, the same information can be passed in via the `SB_USER` environment variable, e.g. 

```shell
SB_USER=pete:1234 silverbullet .
```

This is especially convenient when deploying using Docker

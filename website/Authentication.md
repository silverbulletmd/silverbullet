SilverBullet supports simple authentication for a single user.

By passing the `--user` flag with a username:password combination, you enable authentication for a single user. For instance:

```shell
silverbullet --user pete:1234 .
```

Will let `pete` authenticate with password `1234`. 

Authentication can also be configured via environment variables (which offer a bit more flexibility), see [[Install/Configuration#Authentication]].

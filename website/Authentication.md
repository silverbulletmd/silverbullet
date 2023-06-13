SilverBullet supports simple authentication for one or many users.

**Note**: This feature is experimental and will likely change significantly over time.

## Single User
By simply passing the `--user` flag with a username:password combination, you enable authentication for a single user. For instance:

```shell
silverbullet --user pete:1234 .
```

Will let `pete` authenticate with password `1234`. 

## Multiple users
Although multi-user support is still rudimentary, it is possible to have multiple users authenticate. These users can be configured using an JSON authentication file that SB can generate for you. It is usually named `.auth.json`. 

You can enable authentication as follows:

```shell
silverbullet --auth /path/to/.auth.json
```

To create and manage an `.auth.json` file you can use the following commands:

* `silverbullet user:add --auth /path/to/.auth.json [username]` to add a user
* `silverbullet user:delete --auth /path/to/.auth.json [username]` to delete a user
* `silverbullet user:passwd --auth /path/to/.auth.json [username]` to update a password

If the `.auth.json` file does not yet exist, it will be created.

When SB is run with a `--auth` flag, this fill will automatically be reloaded upon change.

### Group management
While this functionality is not yet used, users can also be added to groups, which can be arbitrarily named. Likely the `admin` group will have special meaning down the line. 

When adding a user, you can add one more `-G` or `--group` flags:

```shell
silverbullet user:add --auth /path/to/.auth.json -G admin pete
```

And you can update these groups later with `silverbullet user:chgrp`:

```shell
silverbullet user:chgrp --auth /path/to/.auth.json -G admin pete
```

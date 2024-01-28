#!/bin/bash -e

# Check if UID and GID are passed as environment variables, if not, extract from the space folder owner
if [ -z "$PUID" ] && [ "$UID" == "0" ] ; then
    # Get the UID of the folder owner
    PUID=$(stat -c "%u" "$SB_FOLDER")
    echo "Will run SilverBullet with UID $PUID, inferred from the owner of $SB_FOLDER (set PUID environment variable to override)"
fi
if [ -z "$PGID" ]; then
    # Get the GID of the folder owner
    PGID=$(stat -c "%g" "$SB_FOLDER")
fi

if [ "$PUID" == "0" ] || [ "$UID" != "0" ]; then
    # Will run SilverBullet as default user
    deno run -A --unstable-kv --unstable-worker-options /silverbullet.js $@
else
    # Create silverbullet user and group ad-hoc mapped to PUID and PGID
    getent group $PGID &> /dev/null || groupadd -g $PGID silverbullet
    getent passwd $PUID &> /dev/null || useradd -M -u $PUID -g $PGID silverbullet
    # And make sure /deno-dir (Deno cache) is accessible
    chown -R $PUID:$PGID /deno-dir
    args="$@"
    # And run via su as requested PUID, usually this will be 'silverbullet' but if a user with this idea already exists, we will use that
    USERNAME=$(getent passwd $PUID | cut -d ":" -f 1)
    echo "Running SilverBullet as $USERNAME (configured as PUID $PUID and PGID $PGID)"
    su $USERNAME -s /bin/bash -c "deno run -A --unstable-kv --unstable-worker-options /silverbullet.js $args"
fi


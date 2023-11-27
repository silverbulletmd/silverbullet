#!/bin/bash

# Check if UID and GID are passed as environment variables
if [ -z "$UID" ]; then
    # Get the UID of the folder owner
    UID=$(stat -c "%u" "$SB_FOLDER")
fi

if [ -z "$GID" ]; then
    # Get the GID of the folder owner
    GID=$(stat -c "%g" "$SB_FOLDER")
fi

echo "Doing this as $UID, $GID"

ls -l /space

if [ "$UID" -eq 0 ]; then
    # If the UID is 0, the user is root
    deno run -A --unstable /silverbullet.js $@
    exit
else
    useradd -M -u $UID -g $GID silverbullet
    su silverbullet -s /bin/bash -c "deno run -A --unstable /silverbullet.js $@"
fi

#!/bin/bash -e
# /space is the legacy mount point: still honored, but /data wins when both are mounted.
space_in_use() {
    mountpoint -q /space 2>/dev/null || [ -n "$(ls -A /space 2>/dev/null)" ]
}
if [ -z "$SB_FOLDER" ]; then
    if mountpoint -q /data 2>/dev/null; then
        SB_FOLDER=/data
        if space_in_use; then
            echo "Note: both /data and /space are mounted, using /data, ignoring /space"
        fi
    elif space_in_use; then
        SB_FOLDER=/space
        echo "Warning: mounting your space at /space is deprecated, mount the data folder at /data instead"
    else
        SB_FOLDER=/data
    fi
fi
export SB_FOLDER
mkdir -p "$SB_FOLDER"

# If a CONTAINER_BOOT.md file exists in the data folder, execute it as a bash script upon boot
if [ -f "$SB_FOLDER/CONTAINER_BOOT.md" ]; then
    echo "Executing CONTAINER_BOOT.md script"
    bash "$SB_FOLDER/CONTAINER_BOOT.md" &
fi

# Check if UID and GID are passed as environment variables, if not, extract from the data folder owner
if [ -z "$PUID" ] && [ "$UID" == "0" ] ; then
    # Get the UID of the folder owner
    PUID=$(stat -c "%u" "$SB_FOLDER")
    echo "Will run SilverBullet with UID $PUID, inferred from the owner of $SB_FOLDER (set PUID environment variable to override)"
fi
if [ -z "$PGID" ]; then
    # Get the GID of the folder owner
    PGID=$(stat -c "%g" "$SB_FOLDER")
fi

# The folder always comes from SB_FOLDER: passing it first makes the server reject a folder argument.
if [ "$PUID" == "0" ] || [ "$UID" != "0" ]; then
    exec /silverbullet "$SB_FOLDER" "$@"
else
    echo "Creating 'silverbullet' group (with GID $PGID) and 'silverbullet' user (with UID $PUID) inside container"
    # A passwd entry is required: ssh (used by git sync) refuses to run for an unknown UID
    getent group silverbullet > /dev/null || addgroup -g $PGID silverbullet
    getent passwd silverbullet > /dev/null || adduser -D -G silverbullet -u $PUID silverbullet
    echo "Running SilverBullet as user configured with PUID $PUID and PGID $PGID"
    # `--` stops su from parsing the server's arguments as its own options
    exec su -s /bin/sh -c 'exec /silverbullet "$@"' -- silverbullet silverbullet "$SB_FOLDER" "$@"
fi

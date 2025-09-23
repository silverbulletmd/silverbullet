#!/bin/bash -e

# Run last-minute package installs, DEPRECATED
if [ -n "$SB_APT_PACKAGES" ]; then
    if [ "$UID" == "0" ]; then
        if [ -n "$SB_APT_SYNC" ]; then
            apt update -y
            apt install -y $SB_APT_PACKAGES
        else
            (apt update -y && apt install -y $SB_APT_PACKAGES) &
        fi
    else
        echo "Cannot install packages selected via SB_APT_PACKAGES unless run as root"
    fi
fi

# If a /space/CONTAINER_BOOT.md file exists, execute it as a bash script upon boot
if [ -f "/space/CONTAINER_BOOT.md" ]; then
    echo "Executing CONTAINER_BOOT.md script"
    bash /space/CONTAINER_BOOT.md &
fi

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
    /silverbullet $@
else
    # Create silverbullet user and group ad-hoc mapped to PUID and PGID
    getent group $PGID &> /dev/null || addgroup -g $PGID silverbullet
    getent passwd $PUID &> /dev/null || adduser -D -H -u $PUID silverbullet silverbullet
    args="$@"
    # And run via su as requested PUID, usually this will be 'silverbullet' but if a user with this idea already exists, we will use that
    USERNAME=$(getent passwd $PUID | cut -d ":" -f 1)
    echo "Running SilverBullet as $USERNAME (configured as PUID $PUID and PGID $PGID)"
    su $USERNAME -s /bin/bash -c "/silverbullet $args"
fi

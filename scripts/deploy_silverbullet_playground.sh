#!/bin/bash -e

cd $(realpath $(dirname $(dirname $0)))

IMAGE_NAME="zefhemel/silverbullet:edge"
PLAYGROUND_SPACE="/tmp/silverbullet-playground"
PLAYGROUND_PORT=3001
SB_USER=silverbullet:silverbullet

# Now do the same for the playground
echo "Now resetting the playground"

# Check if a silverbullet container is running already
if [ "$(docker ps -q -f name=silverbullet-playground)" ]; then
    echo "A playground container is running, let's stop it."
    docker kill silverbullet-playground
    docker rm silverbullet-playground
fi

# Remove the old space
echo "Removing old playground space"
rm -rf $PLAYGROUND_SPACE

echo "Creating fresh playground space"
mkdir -p $PLAYGROUND_SPACE
cp -r scripts/playground_space/* $PLAYGROUND_SPACE/
# Let's copy in the default libraries
cp -r website/Library $PLAYGROUND_SPACE/

echo "Starting new playground container"
docker run -d --name silverbullet-playground --restart unless-stopped -v $PLAYGROUND_SPACE:/space -e SB_SHELL_BACKEND=off -e SB_USER=$SB_USER -p $PLAYGROUND_PORT:3000 $IMAGE_NAME

echo "Waiting for the server to start"

until $(curl --output /dev/null --silent --head --fail http://localhost:$PLAYGROUND_PORT/); do
    printf '.'
    sleep 1
done
echo
echo "We're back up!"
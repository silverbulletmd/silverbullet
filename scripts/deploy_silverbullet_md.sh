#!/bin/bash -e

cd $(realpath $(dirname $(dirname $0)))

IMAGE_NAME="zefhemel/silverbullet:edge"
WEBSITE_SPACE="./website"
WEBSITE_PORT=3000

# Get the current image ID
BEFORE_PULL=$(docker images -q $IMAGE_NAME)

# Pull the Docker image
docker pull $IMAGE_NAME

# Get the new image ID
AFTER_PULL=$(docker images -q $IMAGE_NAME)

# Compare the image IDs
if [ "$BEFORE_PULL" == "$AFTER_PULL" ]; then
    echo "The Docker image has not been updated. Done!"
    exit 0
fi

echo "The Docker image has been updated, let's update the website content."
git pull

# Check if a silverbullet container is running already
if [ "$(docker ps -q -f name=silverbullet)" ]; then
    echo "A silverbullet container is running, let's stop it."
    docker kill silverbullet
    docker rm silverbullet
fi

# Remove the old database
echo "Removing old databases"
rm -f $WEBSITE_SPACE/.silverbullet.db*

echo "Starting new silverbullet container"
docker run -d --name silverbullet --restart unless-stopped -v $WEBSITE_SPACE:/space -e SB_READ_ONLY=1 -p $WEBSITE_PORT:3000 $IMAGE_NAME


echo "Waiting for the servers to start"

# Repeatedly try to connect to the server until it responds
until $(curl --output /dev/null --silent --head --fail http://localhost:$WEBSITE_PORT/); do
    printf '.'
    sleep 1
done
echo
echo "We're back up!"
FROM alpine:3.17.3

RUN adduser -D -H -u 1000 silverbullet && apk add tini

# The volume that will keep the space data
# Create a volume first:
#   docker volume create myspace
# Then bind-mount it when running the container with the -v flag, e.g.:
#   docker run -v myspace:/space -it zefhemel/silverbullet
VOLUME /space

# Copy the bundled version of silverbullet into the container
ADD ./bin/silverbullet /silverbullet

# Make sure the deno user has access to the space volume
RUN mkdir -p /space
RUN chown -R silverbullet /space

# deno user id is 1000 in alpine image
USER silverbullet

# Expose port 3000
# Port map this when running, e.g. with -p 3002:3000 (where 3002 is the host port)
EXPOSE 3000

# Run the server, allowing to pass in additional argument at run time, e.g.
#   docker run -p 3002:3000 -v myspace:/space -it zefhemel/silverbullet --user me:letmein
ENTRYPOINT ["tini", "--", "/silverbullet", "--hostname", "0.0.0.0", "/space"]
# Stage 1: Build the silverbullet binary
FROM denoland/deno:2.6.5 AS builder
RUN apt update && apt install -y git wget make

ARG TARGETARCH
ENV GO_VERSION=1.25.1

RUN set -e; actual_arch=${TARGETARCH:-$(dpkg --print-architecture)}; wget -P /tmp "https://dl.google.com/go/go${GO_VERSION}.linux-${actual_arch}.tar.gz"; tar -C /usr/local -xzf "/tmp/go${GO_VERSION}.linux-${actual_arch}.tar.gz"; rm "/tmp/go${GO_VERSION}.linux-${actual_arch}.tar.gz"

ENV GOPATH=/go
ENV PATH=$GOPATH/bin:/usr/local/go/bin:$PATH

WORKDIR /app
ADD . /app

# This will produce the `silverbullet` self-contained binary in /app/silverbullet
RUN deno task build-production
RUN go build

# Stage 2: Create the runtime from the build
FROM alpine:latest

# The volume that will keep the space data
VOLUME /space

# Either create a volume:
#   docker volume create myspace
# Then bind-mount it when running the container with the -v flag, e.g.:
#   docker run -v myspace:/space -p3000:3000 -it ghcr.io/silverbulletmd/silverbullet
# Or simply mount an existing folder into the container:
#   docker run -v /path/to/my/folder:/space -p3000:3000 -it ghcr.io/silverbulletmd/silverbullet

RUN apk add --no-cache git curl bash tini

HEALTHCHECK CMD curl --fail http://localhost:$SB_PORT$SB_URL_PREFIX/.ping || exit 1

# Expose port 3000
# Port map this when running, e.g. with -p 3002:3000 (where 3002 is the host port)
EXPOSE 3000

# Always binding to this IP, otherwise the server wouldn't be available
ENV SB_HOSTNAME=0.0.0.0
ENV SB_FOLDER=/space

# Reset /etc/group and /etc/passwd
RUN echo "" > /etc/group && echo "root:x:0:0:root:/root:/bin/sh" > /etc/passwd

# As well as the docker-entrypoint.sh script
ADD ./docker-entrypoint.sh /docker-entrypoint.sh

# Copy the bundled version of silverbullet into the container
COPY --from=builder /app/silverbullet /silverbullet

# Run the server, allowing to pass in additional argument at run time, e.g.
#   docker run -p 3002:3000 -v myspace:/space -it ghcr.io/silverbulletmd/silverbullet --user me:letmein
ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]

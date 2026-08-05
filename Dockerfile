# Base Alpine image for the SilverBullet server.
# Copies a PRE-CROSS-COMPILED, statically-linked musl binary built on the CI
# runner via native `cargo build --target` + installed musl cross-toolchains
# (see .github/workflows/ci.yml). Because there is no in-image compilation,
# multi-arch `buildx` is fast (it only emulates the small Alpine layers). The
# binary is static, so it runs on bare Alpine.
#
# This is the BASE variant: no Chromium, so `/.runtime/*` returns 503.
# `Dockerfile.runtime-api` layers Chromium on top to enable the runtime API.
#
# Published by `.github/workflows/ci.yml`.

FROM alpine:latest

# `buildx` sets TARGETARCH to `amd64` / `arm64`; pick the matching pre-built
# binary (silverbullet-amd64 / silverbullet-arm64, built on the CI runner).
ARG TARGETARCH

RUN apk add --no-cache git curl bash tini openssh-client

ENV SB_HOSTNAME=0.0.0.0 \
    SB_FOLDER=/space \
    SB_PORT=3000

EXPOSE 3000
HEALTHCHECK CMD curl --fail "http://localhost:$SB_PORT/.instance" || exit 1

# Wipe the stock Alpine accounts so `docker-entrypoint.sh` can create the
# `silverbullet` user/group at an arbitrary PUID/PGID without colliding with a
# built-in entry at the same id (busybox `adduser`/`addgroup` fail on collision).
RUN echo "" > /etc/group && echo "root:x:0:0:root:/root:/bin/sh" > /etc/passwd

# Drops privileges to PUID/PGID (defaulting to the owner of $SB_FOLDER) and
# runs /space/CONTAINER_BOOT.md if present.
ADD ./docker-entrypoint.sh /docker-entrypoint.sh

COPY silverbullet-${TARGETARCH} /silverbullet
RUN chmod +x /silverbullet /docker-entrypoint.sh

# Extra args (e.g. `--user me:letmein`) are appended to the binary invocation.
ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]

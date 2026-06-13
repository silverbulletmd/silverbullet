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

RUN apk add --no-cache git curl bash tini

ENV SB_HOSTNAME=0.0.0.0 \
    SB_FOLDER=/space \
    SB_PORT=3000

EXPOSE 3000
HEALTHCHECK CMD curl --fail "http://localhost:$SB_PORT$SB_URL_PREFIX/.ping" || exit 1

COPY silverbullet-${TARGETARCH} /silverbullet
RUN chmod +x /silverbullet

# Extra args (e.g. `--user me:letmein`) are appended to the binary invocation.
ENTRYPOINT ["/sbin/tini", "--", "/silverbullet"]

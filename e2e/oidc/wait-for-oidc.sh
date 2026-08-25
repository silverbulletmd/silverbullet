#!/bin/sh
# wait-for-oidc.sh — block until the OIDC provider's discovery endpoint is
# reachable, then exec into the real entrypoint.
#
# Usage: COPY into the SB image and set as ENTRYPOINT wrapper:
#   ENTRYPOINT ["/sbin/tini", "--", "/wait-for-oidc.sh"]
#   CMD ["/docker-entrypoint.sh"]

set -e

OIDC_DISCOVERY="${SB_OIDC_DISCOVERY_URL:-http://localhost:5556/dex/.well-known/openid-configuration}"
TIMEOUT="${OIDC_TIMEOUT:-60}"
INTERVAL=2

if [ -z "$SB_OIDC_ISSUER" ]; then
  echo "SB_OIDC_ISSUER not set — skipping OIDC wait, exec into $*"
  exec "$@"
fi

echo "Waiting for OIDC provider at ${OIDC_DISCOVERY} (timeout ${TIMEOUT}s)..."
deadline=$(($(date +%s) + TIMEOUT))

while true; do
  if curl -sf "$OIDC_DISCOVERY" >/dev/null 2>&1; then
    echo "OIDC provider ready."
    break
  fi
  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    echo "ERROR: OIDC provider not ready after ${TIMEOUT}s — aborting."
    exit 1
  fi
  echo "  not ready, retrying in ${INTERVAL}s..."
  sleep "$INTERVAL"
done

exec "$@"

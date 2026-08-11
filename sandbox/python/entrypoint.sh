#!/bin/sh
set -eu

# Seed the writable bytecode cache from the read-only warm cache baked into
# the image, so a run reuses pre-compiled stdlib/venv bytecode instead of
# recompiling it against the 10-second limit.
if [ -d /warm-cache ] && [ -n "$(ls -A /warm-cache 2>/dev/null || true)" ]; then
  mkdir -p /cache/pycache
  cp -a /warm-cache/. /cache/pycache/
fi

exec "$@"

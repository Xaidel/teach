#!/bin/sh
set -eu

# Seed the writable build cache from the read-only warm cache baked into the
# image, so a run only compiles the learner's own submission against
# already-compiled dependencies.
if [ -d /warm-cache ] && [ -n "$(ls -A /warm-cache 2>/dev/null || true)" ]; then
  mkdir -p /cache/go-build
  cp -a /warm-cache/. /cache/go-build/
fi

exec "$@"

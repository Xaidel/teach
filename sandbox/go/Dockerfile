FROM golang:1.24.13-bookworm

# The sandbox enforces a 64-pid cgroup limit (PRD 5.1 / ADR-0005); Go spawns
# one runtime thread per core plus concurrent tool subprocesses, so cap its
# parallelism to stay well inside the limit.
ENV GOTOOLCHAIN=local
ENV GOMAXPROCS=2
ENV GOFLAGS=-p=2
ENV GOCACHE=/warm-cache

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1001 --user-group sandbox

WORKDIR /skeleton
COPY skeleton/ /skeleton/
RUN go test ./... \
    && chmod -R a+rX /warm-cache

# At runtime the sandbox user builds into /cache/go-build (a tmpfs seeded by
# the entrypoint from the read-only warm cache above).
ENV GOCACHE=/cache/go-build

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

WORKDIR /project
USER sandbox
ENV HOME=/cache
ENTRYPOINT ["/entrypoint.sh"]

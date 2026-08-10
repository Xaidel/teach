FROM rust:1.90.0-slim-bookworm

ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH
ENV CARGO_TARGET_DIR=/warm-cache

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ARG NEXTEST_VERSION=0.9.143
ARG NEXTEST_SHA256=6d891c18105ec2d33f6e441a4f92b7ccab47ba263e22055c8bb66884243f3389
RUN curl -fsSL --retry 5 -o /tmp/nextest.tar.gz \
        "https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-${NEXTEST_VERSION}/cargo-nextest-${NEXTEST_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    && echo "${NEXTEST_SHA256}  /tmp/nextest.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/nextest.tar.gz -C /usr/local/cargo/bin \
    && rm /tmp/nextest.tar.gz

RUN useradd --create-home --uid 1001 --user-group sandbox

WORKDIR /skeleton
COPY skeleton/ /skeleton/
RUN cargo nextest run --no-run \
    && chmod -R a+rX /warm-cache

# At runtime the sandbox user compiles into /cache/target (a tmpfs seeded by
# the entrypoint from the read-only warm cache above).
ENV CARGO_TARGET_DIR=/cache/target

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

WORKDIR /project
USER sandbox
ENV HOME=/cache
ENTRYPOINT ["/entrypoint.sh"]

FROM python:3.13.15-slim-bookworm

ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1001 --user-group sandbox

WORKDIR /skeleton
COPY skeleton/ /skeleton/

RUN python -m venv /venv
ENV PATH=/venv/bin:$PATH
RUN pip install --no-cache-dir pytest==9.1.1 \
    && pip install --no-cache-dir -r requirements.txt

# Warm the bytecode cache at build time (ADR-0011): the entrypoint seeds the
# writable runtime cache from this read-only prefix on every run.
ENV PYTHONPYCACHEPREFIX=/warm-cache/pycache
RUN python -m compileall -q /venv /usr/local/lib/python3.13 \
    && pytest -q -p no:cacheprovider --junit-xml=/tmp/warmup-junit.xml \
    && chmod -R a+rX /warm-cache

ENV PYTHONPYCACHEPREFIX=/cache/pycache

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

WORKDIR /project
USER sandbox
ENV HOME=/cache
ENTRYPOINT ["/entrypoint.sh"]

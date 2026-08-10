# ADR-0006: TypeScript full-stack: Next.js + Node backend

- **Date**: 2026-08-10
- **Status**: Superseded
- **Deciders**: Xaidel (sole maintainer)
- **Superseded by**: [ADR-0009](./0009-tanstack-start-single-app-stack.md)

> This record is retained for history. The specific framework and backend-shape choice below (Next.js frontend, separate Node backend) is no longer authoritative — see [ADR-0009](./0009-tanstack-start-single-app-stack.md) for the current decision and why it changed. The original rationale for TypeScript end-to-end (one shared language, sandboxed languages indifferent to the host) is not overturned — only the specific framework and backend shape are.

## Original Decision

Considered a Python/FastAPI or Go backend, which would sit closer to two of the three sandboxed languages (Go, Python). Chose TypeScript end-to-end — Next.js frontend with a Node backend orchestrating the Docker sandboxes — for one shared language across dashboard, API, and orchestration layer. The sandboxed languages (Rust/Go/Python) run in isolated containers regardless of what the platform itself is written in, so there's no coupling benefit to writing the backend in one of them.

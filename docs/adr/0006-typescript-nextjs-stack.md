# TypeScript full-stack: Next.js + Node backend

Considered a Python/FastAPI or Go backend, which would sit closer to two of the three sandboxed languages (Go, Python). Chose TypeScript end-to-end — Next.js frontend with a Node backend orchestrating the Docker sandboxes — for one shared language across dashboard, API, and orchestration layer. The sandboxed languages (Rust/Go/Python) run in isolated containers regardless of what the platform itself is written in, so there's no coupling benefit to writing the backend in one of them.

# Multi-language support from v1

Considered scoping the sandbox, Concept Graph, and exercise generation to Rust only for v1, since every PRD example is Rust. Rejected: the sandbox execution layer, Concept Graph schema, and exercise generation/pre-flight pipeline must support multiple languages from v1, not a single hardcoded one. Concept IDs are namespaced by language (e.g. `rust.async.send`) per the PRD's own example, which already anticipates this. This means the sandbox needs a per-language runtime/toolchain abstraction (not just a Rust+cargo container) from the start.

v1 languages: **Rust, Go, Python** — a compiled/ownership language, a compiled/GC language, and a dynamic language, so the abstraction is proven across genuinely different toolchains rather than three flavors of the same thing.

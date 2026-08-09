# Single-user MVP on a multi-user-ready data model

The platform is built primarily for the author's own use, but is expected to serve other learners with the same problem eventually. For MVP, we skip auth, billing, and per-tenant isolation entirely — but every domain entity that would need to be scoped to a learner (Learner Model, progress, hint history, exercise attempts) is modeled with that scoping from the start, so multi-user support later is additive rather than a schema rewrite.

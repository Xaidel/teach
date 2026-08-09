# Postgres for all persistent storage

Considered a graph database for the Concept Graph, since it's explicitly modeled as a graph (prerequisites, related concepts). Rejected — the graph is small (dozens to low hundreds of nodes across Rust/Go/Python) and shallow enough that adjacency-table queries in Postgres are simpler to operate than running a second database technology. Postgres holds the Concept Graph, the Learner Model (mastery state, attempt history, hint usage), and the Retrieval Queue, paired with the Node/Next.js backend via Drizzle ORM.

# Repo Index — Schema Design

One SQLite file per repo (e.g. `.repo-index/index.db`). SQLite holds the
graph tables; embeddings are stored as BLOBs in the same file so there's
a single artifact to back up / gitignore. If a repo gets large enough that
brute-force cosine search over embeddings gets slow (a few hundred thousand
chunks), swap the `chunks` table's storage for Qdrant/pgvector without
touching the graph tables.

## Graph tables

### `nodes`
One row per addressable code unit: a file, a class, a method/function.

| column          | type    | notes                                             |
|-----------------|---------|----------------------------------------------------|
| id              | INTEGER | primary key                                        |
| repo            | TEXT    | repo name, for multi-repo indexes                  |
| path            | TEXT    | file path relative to repo root                    |
| kind            | TEXT    | 'file' \| 'class' \| 'interface' \| 'method' \| 'function' |
| name            | TEXT    | short name, e.g. `GetUserAsync`                    |
| qualified_name  | TEXT    | e.g. `MyApp.Services.UserService.GetUserAsync`     |
| start_line      | INTEGER |                                                     |
| end_line        | INTEGER |                                                     |
| git_blob_sha    | TEXT    | sha of the *file* this node came from, for staleness checks |
| updated_at      | TEXT    | ISO timestamp of last (re)index                    |

Indexes: `(repo, path)`, `(qualified_name)`, `(kind)`

### `edges`
Directed relationships between nodes.

| column     | type    | notes                                                       |
|------------|---------|--------------------------------------------------------------|
| id         | INTEGER | primary key                                                   |
| src_id     | INTEGER | FK -> nodes.id                                                |
| dst_id     | INTEGER | FK -> nodes.id (nullable if target is external/unresolved)   |
| dst_ref    | TEXT    | raw unresolved name, kept even if dst_id is null              |
| kind       | TEXT    | 'calls' \| 'imports' \| 'inherits' \| 'implements' \| 'references' |

Indexes: `(src_id)`, `(dst_id)` — this is what makes "who calls this" /
"what does this call" / "blast radius" queries cheap graph walks instead
of repo-wide greps.

### `file_state`
Drives incremental re-indexing.

| column          | type | notes                                    |
|-----------------|------|--------------------------------------------|
| path            | TEXT | primary key                                |
| git_blob_sha    | TEXT | sha of file content at last index          |
| last_indexed_at | TEXT |                                             |

On nightly `git fetch && git pull`: diff `HEAD@{before}` vs `HEAD@{after}`
via `git diff --name-status <old> <new>`, then only re-parse/re-embed the
changed paths and delete nodes/edges/chunks whose `path` was removed.

## Vector table

### `chunks`
Chunk boundaries follow the **graph nodes**, not fixed token windows —
each method/function body is one chunk (its own semantic unit). Anything
too large (>~300 lines) is split with a modest line-overlap so a match
doesn't cut a concept in half. File-level docstrings/comments get their
own chunk tied to the `file` node.

| column        | type    | notes                                            |
|---------------|---------|----------------------------------------------------|
| id            | INTEGER | primary key                                        |
| node_id       | INTEGER | FK -> nodes.id (which symbol this chunk belongs to)|
| path          | TEXT    |                                                     |
| start_line    | INTEGER |                                                     |
| end_line      | INTEGER |                                                     |
| content_hash  | TEXT    | sha256 of chunk text — skip re-embedding if unchanged |
| text          | TEXT    | raw source, kept for returning to Copilot as context |
| embedding     | BLOB    | Float32Array serialized to bytes                   |

Why hash at the chunk level and not just the file level: a one-line change
in a 400-line file should only re-embed the one changed method, not the
whole file's chunks.

## Why graph nodes double as chunk boundaries

This is the key design choice: **the graph and the vector index share the
same unit of granularity.** When a vector search returns a chunk, you
already have its `node_id`, so a single MCP tool call can return "here's
the semantically relevant code, and here's its callers/callees" in one
shot — no second round-trip needed for Copilot to get both the *what* and
the *how it connects*.

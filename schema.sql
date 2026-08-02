-- Repo Index schema. See SCHEMA.md for the design rationale.

CREATE TABLE IF NOT EXISTS nodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo            TEXT NOT NULL,
  path            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'file','class','interface','record','struct','method','function',
                    'component','service','module','directive','pipe','config'
                  )),
  name            TEXT NOT NULL,
  qualified_name  TEXT NOT NULL,
  start_line      INTEGER,
  end_line        INTEGER,
  git_blob_sha    TEXT,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_repo_path ON nodes(repo, path);
CREATE INDEX IF NOT EXISTS idx_nodes_qualified ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);

CREATE TABLE IF NOT EXISTS edges (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  src_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst_id   INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  dst_ref  TEXT,
  kind     TEXT NOT NULL CHECK (kind IN ('calls','imports','inherits','implements','references','injects','registers'))
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);

CREATE TABLE IF NOT EXISTS file_state (
  path             TEXT PRIMARY KEY,
  git_blob_sha     TEXT NOT NULL,
  last_indexed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id       INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  start_line    INTEGER,
  end_line      INTEGER,
  content_hash  TEXT NOT NULL,
  text          TEXT NOT NULL,
  embedding     BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_node ON chunks(node_id);
CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);

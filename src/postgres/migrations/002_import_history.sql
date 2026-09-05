CREATE TABLE legacy_imports (
  id TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL UNIQUE CHECK(length(source_sha256)=64),
  source_migrations JSONB NOT NULL,
  row_counts JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

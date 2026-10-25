CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  cursor_block INTEGER,
  monitoring INTEGER NOT NULL DEFAULT 0,
  scan_lock INTEGER NOT NULL DEFAULT 0,
  last_scan_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, event_id)
);
CREATE INDEX IF NOT EXISTS observations_workspace_block ON observations(workspace_id, block_number DESC);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_workspace_created ON reports(workspace_id, created_at DESC);

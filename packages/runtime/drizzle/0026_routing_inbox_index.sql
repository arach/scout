CREATE INDEX IF NOT EXISTS idx_deliveries_target_status_created_id ON deliveries (target_id, status, created_at, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS broker_history_anchors (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  location_json TEXT NOT NULL,
  PRIMARY KEY(kind, id)
);

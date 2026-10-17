-- Migration 005: Add consecutive_missed_scans for stale/closed job detection

ALTER TABLE jobs ADD COLUMN consecutive_missed_scans INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_jobs_missed_scans ON jobs(consecutive_missed_scans);

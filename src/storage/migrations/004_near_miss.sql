-- Migration 004: Add near_miss flag to jobs table

ALTER TABLE jobs ADD COLUMN near_miss INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_jobs_near_miss ON jobs(near_miss);

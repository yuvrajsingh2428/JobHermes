-- Migration 001: Core Jobs, Applications, and Runs Schema

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT    NOT NULL,
  company             TEXT    NOT NULL,
  location            TEXT    NOT NULL DEFAULT '',
  is_remote           INTEGER NOT NULL DEFAULT 0,
  url                 TEXT    NOT NULL UNIQUE,
  description         TEXT    NOT NULL DEFAULT '',
  salary              TEXT,
  job_type            TEXT,
  experience_required TEXT,
  skills              TEXT,         -- JSON array
  posted_at           TEXT,
  scraped_at          TEXT    NOT NULL,
  source              TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'new',
  score               REAL,
  score_breakdown     TEXT,         -- JSON object
  stretch             INTEGER NOT NULL DEFAULT 0,
  reasons             TEXT,         -- JSON array
  is_applied          INTEGER NOT NULL DEFAULT 0,
  applied_at          TEXT,
  notes               TEXT,
  external_id         TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_company   ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_score     ON jobs(score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_scraped   ON jobs(scraped_at);
CREATE INDEX IF NOT EXISTS idx_jobs_is_applied ON jobs(is_applied);

CREATE TABLE IF NOT EXISTS applications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  applied_at        TEXT    NOT NULL,
  resume_path       TEXT,
  cover_letter_path TEXT,
  notes             TEXT,
  follow_up_date    TEXT,
  outcome           TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);

CREATE TABLE IF NOT EXISTS scan_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  jobs_scraped  INTEGER DEFAULT 0,
  jobs_filtered INTEGER DEFAULT 0,
  companies     TEXT,   -- JSON array
  status        TEXT NOT NULL DEFAULT 'running',
  error         TEXT
);

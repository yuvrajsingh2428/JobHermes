-- Migration 006: Add company_scan_states for empty scan confirmation tracking

CREATE TABLE IF NOT EXISTS company_scan_states (
  company                 TEXT    PRIMARY KEY,
  consecutive_empty_scans INTEGER NOT NULL DEFAULT 0,
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_states_company ON company_scan_states(company);

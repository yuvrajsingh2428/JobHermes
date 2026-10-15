-- Migration 003: Outreach Engine & Signal Sources

ALTER TABLE signals ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS outreach (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  job_id           INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  type             TEXT    NOT NULL DEFAULT 'cold', -- 'cold' | 'follow_up_1' | 'referral_ask' | 'thank_you'
  variant          TEXT    NOT NULL DEFAULT 'A',    -- 'A' | 'B'
  subject          TEXT    NOT NULL,
  body             TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'draft',-- 'draft' | 'approved' | 'sent' | 'replied' | 'bounced' | 'skipped'
  sent_at          TEXT,
  follow_up_due_at TEXT,
  reply_at         TEXT,
  outcome          TEXT    DEFAULT 'none',
  source           TEXT    DEFAULT 'manual',
  error            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_contact ON outreach(contact_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status  ON outreach(status);
CREATE INDEX IF NOT EXISTS idx_outreach_job     ON outreach(job_id);

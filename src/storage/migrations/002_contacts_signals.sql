-- Migration 002: Companies, Contacts, Signals, Suppression, and API Usage

CREATE TABLE IF NOT EXISTS companies (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL UNIQUE,
  domain             TEXT    NOT NULL DEFAULT '',
  size_bucket        TEXT    NOT NULL DEFAULT 'mid', -- 'startup' | 'mid' | 'large'
  ats                TEXT    NOT NULL DEFAULT 'custom',
  slug               TEXT,
  notes              TEXT,
  research_brief     TEXT,   -- JSON object: { whatTheyBuild, recentSpecificThing, whyIFit }
  last_researched_at TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);

CREATE TABLE IF NOT EXISTS contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name    TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  contact_type TEXT    NOT NULL DEFAULT 'generic_careers', -- 'recruiter' | 'qa_manager' | 'eng_manager' | 'founder_cto' | 'generic_careers' | 'referral'
  linkedin_url TEXT,
  email        TEXT,
  email_status TEXT    NOT NULL DEFAULT 'unknown', -- 'unknown' | 'guessed' | 'verified' | 'bounced' | 'invalid'
  timezone     TEXT    NOT NULL DEFAULT 'Asia/Kolkata', -- Contact's timezone for business-hours send window
  source       TEXT    DEFAULT 'manual',
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);

CREATE TABLE IF NOT EXISTS signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  signal_type TEXT    NOT NULL, -- 'funding' | 'hiring_post' | 'multiple_qa_roles' | 'product_launch' | 'other'
  detail      TEXT    NOT NULL,
  url         TEXT,
  seen_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signals_company ON signals(company_id);

CREATE TABLE IF NOT EXISTS suppression_list (
  email    TEXT PRIMARY KEY,
  reason   TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_usage (
  service        TEXT NOT NULL,
  metric_month   TEXT NOT NULL, -- 'YYYY-MM'
  call_count     INTEGER NOT NULL DEFAULT 0,
  last_called_at TEXT,
  PRIMARY KEY (service, metric_month)
);

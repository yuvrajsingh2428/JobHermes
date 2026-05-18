// ============================================================
// SQLite Storage Service – Schema, CRUD, queries
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { JobPosting, ApplicationRecord, ScoreBreakdown, ApplicationStatus } from '../types';
import { logger } from '../utils/logger';

export class StorageService {
  private db: Database.Database;

  constructor(databasePath: string) {
    const resolved = path.resolve(databasePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    logger.info('StorageService initialized', { path: resolved });
  }

  // ─── Schema ────────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        title            TEXT    NOT NULL,
        company          TEXT    NOT NULL,
        location         TEXT    NOT NULL DEFAULT '',
        url              TEXT    NOT NULL UNIQUE,
        description      TEXT    NOT NULL DEFAULT '',
        salary           TEXT,
        job_type         TEXT,
        experience_required TEXT,
        skills           TEXT,         -- JSON array
        posted_at        TEXT,
        scraped_at       TEXT    NOT NULL,
        source           TEXT    NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'new',
        score            REAL,
        score_breakdown  TEXT,         -- JSON object
        is_applied       INTEGER NOT NULL DEFAULT 0,
        applied_at       TEXT,
        notes            TEXT,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
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

      CREATE TABLE IF NOT EXISTS report_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        generated_at TEXT NOT NULL,
        report_path  TEXT NOT NULL,
        jobs_count   INTEGER DEFAULT 0
      );
    `);

    logger.debug('Database schema initialized');
  }

  // ─── Job CRUD ──────────────────────────────────────────────

  upsertJob(job: Omit<JobPosting, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        title, company, location, url, description, salary, job_type,
        experience_required, skills, posted_at, scraped_at, source,
        status, score, score_breakdown, is_applied, applied_at, notes
      ) VALUES (
        @title, @company, @location, @url, @description, @salary, @jobType,
        @experienceRequired, @skills, @postedAt, @scrapedAt, @source,
        @status, @score, @scoreBreakdown, @isApplied, @appliedAt, @notes
      )
      ON CONFLICT(url) DO UPDATE SET
        title            = excluded.title,
        description      = excluded.description,
        salary           = excluded.salary,
        job_type         = excluded.job_type,
        scraped_at       = excluded.scraped_at,
        updated_at       = datetime('now')
    `);

    const result = stmt.run({
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      description: job.description,
      salary: job.salary || null,
      jobType: job.jobType || null,
      experienceRequired: job.experienceRequired || null,
      skills: job.skills ? JSON.stringify(job.skills) : null,
      postedAt: job.postedAt || null,
      scrapedAt: job.scrapedAt,
      source: job.source,
      status: job.status || 'new',
      score: job.score || null,
      scoreBreakdown: job.scoreBreakdown ? JSON.stringify(job.scoreBreakdown) : null,
      isApplied: job.isApplied ? 1 : 0,
      appliedAt: job.appliedAt || null,
      notes: job.notes || null,
    });

    return Number(result.lastInsertRowid) || this.getJobByUrl(job.url)?.id || 0;
  }

  updateJobScore(id: number, score: number, breakdown: ScoreBreakdown): void {
    this.db
      .prepare(
        `UPDATE jobs SET score = ?, score_breakdown = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(score, JSON.stringify(breakdown), id);
  }

  updateJobStatus(id: number, status: ApplicationStatus, notes?: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`
      )
      .run(status, notes || null, id);
  }

  markApplied(id: number, appliedAt: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET is_applied = 1, applied_at = ?, status = 'applied', updated_at = datetime('now') WHERE id = ?`
      )
      .run(appliedAt, id);
  }

  getJobById(id: number): JobPosting | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToJob(row) : undefined;
  }

  getJobByUrl(url: string): JobPosting | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE url = ?').get(url) as Record<string, unknown> | undefined;
    return row ? this.rowToJob(row) : undefined;
  }

  getTopJobs(limit: number = 10, minScore: number = 0): JobPosting[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE score >= ? AND status NOT IN ('skipped', 'rejected')
         ORDER BY score DESC
         LIMIT ?`
      )
      .all(minScore, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToJob(r));
  }

  getTodaysJobs(): JobPosting[] {
    const today = new Date().toISOString().split('T')[0];
    const rows = this.db
      .prepare(`SELECT * FROM jobs WHERE scraped_at LIKE ? ORDER BY score DESC`)
      .all(`${today}%`) as Record<string, unknown>[];
    return rows.map((r) => this.rowToJob(r));
  }

  getAllJobs(filters?: {
    status?: ApplicationStatus;
    minScore?: number;
    company?: string;
    limit?: number;
  }): JobPosting[] {
    let query = 'SELECT * FROM jobs WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.status) { query += ' AND status = ?'; params.push(filters.status); }
    if (filters?.minScore !== undefined) { query += ' AND score >= ?'; params.push(filters.minScore); }
    if (filters?.company) { query += ' AND company LIKE ?'; params.push(`%${filters.company}%`); }

    query += ' ORDER BY score DESC, scraped_at DESC';

    if (filters?.limit) { query += ' LIMIT ?'; params.push(filters.limit); }

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToJob(r));
  }

  countJobs(since?: string): number {
    if (since) {
      return (this.db.prepare('SELECT COUNT(*) as c FROM jobs WHERE scraped_at >= ?').get(since) as { c: number }).c;
    }
    return (this.db.prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number }).c;
  }

  // ─── Applications ──────────────────────────────────────────

  addApplication(record: Omit<ApplicationRecord, 'id'>): number {
    const result = this.db
      .prepare(
        `INSERT INTO applications (job_id, applied_at, resume_path, cover_letter_path, notes, follow_up_date, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.jobId,
        record.appliedAt,
        record.resumePath || null,
        record.coverLetterPath || null,
        record.notes || null,
        record.followUpDate || null,
        record.outcome || null
      );
    return Number(result.lastInsertRowid);
  }

  getApplications(jobId?: number): ApplicationRecord[] {
    const query = jobId
      ? 'SELECT * FROM applications WHERE job_id = ? ORDER BY applied_at DESC'
      : 'SELECT * FROM applications ORDER BY applied_at DESC';
    const rows = jobId
      ? (this.db.prepare(query).all(jobId) as Record<string, unknown>[])
      : (this.db.prepare(query).all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: r['id'] as number,
      jobId: r['job_id'] as number,
      appliedAt: r['applied_at'] as string,
      resumePath: r['resume_path'] as string | undefined,
      coverLetterPath: r['cover_letter_path'] as string | undefined,
      notes: r['notes'] as string | undefined,
      followUpDate: r['follow_up_date'] as string | undefined,
      outcome: r['outcome'] as string | undefined,
    }));
  }

  // ─── Scan Runs ─────────────────────────────────────────────

  startScanRun(): number {
    const result = this.db
      .prepare(`INSERT INTO scan_runs (started_at, status) VALUES (datetime('now'), 'running')`)
      .run();
    return Number(result.lastInsertRowid);
  }

  completeScanRun(id: number, jobsScraped: number, jobsFiltered: number, companies: string[]): void {
    this.db
      .prepare(
        `UPDATE scan_runs SET completed_at = datetime('now'), jobs_scraped = ?, jobs_filtered = ?, companies = ?, status = 'done' WHERE id = ?`
      )
      .run(jobsScraped, jobsFiltered, JSON.stringify(companies), id);
  }

  failScanRun(id: number, error: string): void {
    this.db
      .prepare(`UPDATE scan_runs SET completed_at = datetime('now'), status = 'failed', error = ? WHERE id = ?`)
      .run(error, id);
  }

  // ─── Report Log ────────────────────────────────────────────

  logReport(reportPath: string, jobsCount: number): void {
    this.db
      .prepare(`INSERT INTO report_log (generated_at, report_path, jobs_count) VALUES (datetime('now'), ?, ?)`)
      .run(reportPath, jobsCount);
  }

  // ─── Row Mappers ───────────────────────────────────────────

  private rowToJob(row: Record<string, unknown>): JobPosting {
    return {
      id: row['id'] as number,
      title: row['title'] as string,
      company: row['company'] as string,
      location: row['location'] as string,
      url: row['url'] as string,
      description: row['description'] as string,
      salary: row['salary'] as string | undefined,
      jobType: row['job_type'] as string | undefined,
      experienceRequired: row['experience_required'] as string | undefined,
      skills: row['skills'] ? (JSON.parse(row['skills'] as string) as string[]) : undefined,
      postedAt: row['posted_at'] as string | undefined,
      scrapedAt: row['scraped_at'] as string,
      source: row['source'] as string,
      status: row['status'] as ApplicationStatus,
      score: row['score'] as number | undefined,
      scoreBreakdown: row['score_breakdown']
        ? (JSON.parse(row['score_breakdown'] as string) as ScoreBreakdown)
        : undefined,
      isApplied: Boolean(row['is_applied']),
      appliedAt: row['applied_at'] as string | undefined,
      notes: row['notes'] as string | undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}

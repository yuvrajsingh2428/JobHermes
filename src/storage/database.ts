// ============================================================
// SQLite Storage Service – Schema, Migrations, CRUD, Queries
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  JobPosting,
  ApplicationRecord,
  ScoreBreakdown,
  ApplicationStatus,
  CompanyRecord,
  ContactRecord,
  SignalRecord,
  SuppressionRecord,
} from '../types';
import { runMigrations } from './migrations';
import { logger } from '../utils/logger';

export class StorageService {
  private db: Database.Database;

  constructor(databasePath: string, migrationsDir?: string) {
    const resolved = path.resolve(databasePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Run versioned migrations
    runMigrations(this.db, migrationsDir);

    logger.info('StorageService initialized with migrations', { path: resolved });
  }

  // ─── Job CRUD ──────────────────────────────────────────────

  upsertJob(job: Omit<JobPosting, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        title, company, location, is_remote, url, description, salary, job_type,
        experience_required, skills, posted_at, scraped_at, source,
        status, score, score_breakdown, stretch, reasons, is_applied, applied_at, notes, external_id
      ) VALUES (
        @title, @company, @location, @isRemote, @url, @description, @salary, @jobType,
        @experienceRequired, @skills, @postedAt, @scrapedAt, @source,
        @status, @score, @scoreBreakdown, @stretch, @reasons, @isApplied, @appliedAt, @notes, @externalId
      )
      ON CONFLICT(url) DO UPDATE SET
        title            = excluded.title,
        description      = excluded.description,
        salary           = excluded.salary,
        job_type         = excluded.job_type,
        scraped_at       = excluded.scraped_at,
        score            = excluded.score,
        score_breakdown  = excluded.score_breakdown,
        stretch          = excluded.stretch,
        reasons          = excluded.reasons,
        updated_at       = datetime('now')
    `);

    const result = stmt.run({
      title: job.title,
      company: job.company,
      location: job.location,
      isRemote: job.isRemote ? 1 : 0,
      url: job.url,
      description: job.description,
      salary: job.salary || job.rawSalary || null,
      jobType: job.jobType || null,
      experienceRequired: job.experienceRequired || null,
      skills: job.skills ? JSON.stringify(job.skills) : null,
      postedAt: job.postedAt || null,
      scrapedAt: job.scrapedAt,
      source: job.source,
      status: job.status || 'new',
      score: job.score || null,
      scoreBreakdown: job.scoreBreakdown ? JSON.stringify(job.scoreBreakdown) : null,
      stretch: job.stretch ? 1 : 0,
      reasons: job.reasons ? JSON.stringify(job.reasons) : null,
      isApplied: job.isApplied ? 1 : 0,
      appliedAt: job.appliedAt || null,
      notes: job.notes || null,
      externalId: job.externalId || null,
    });

    return Number(result.lastInsertRowid) || this.getJobByUrl(job.url)?.id || 0;
  }

  updateJobScore(id: number, score: number, breakdown: ScoreBreakdown): void {
    this.db
      .prepare(
        `UPDATE jobs SET score = ?, score_breakdown = ?, stretch = ?, reasons = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(score, JSON.stringify(breakdown), breakdown.stretch ? 1 : 0, JSON.stringify(breakdown.reasons), id);
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

  getTopJobs(limit = 10, minScore = 0): JobPosting[] {
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

  // ─── Applications (Preserved for direct application tracking) ─

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

  // ─── Companies ─────────────────────────────────────────────

  upsertCompany(company: Omit<CompanyRecord, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO companies (name, domain, size_bucket, ats, slug, notes, research_brief, last_researched_at)
      VALUES (@name, @domain, @sizeBucket, @ats, @slug, @notes, @researchBrief, @lastResearchedAt)
      ON CONFLICT(name) DO UPDATE SET
        domain             = COALESCE(NULLIF(excluded.domain, ''), companies.domain),
        size_bucket        = excluded.size_bucket,
        ats                = excluded.ats,
        slug               = COALESCE(excluded.slug, companies.slug),
        notes              = COALESCE(excluded.notes, companies.notes),
        research_brief     = COALESCE(excluded.research_brief, companies.research_brief),
        last_researched_at = COALESCE(excluded.last_researched_at, companies.last_researched_at)
    `);

    const result = stmt.run({
      name: company.name,
      domain: company.domain || '',
      sizeBucket: company.sizeBucket || 'mid',
      ats: company.ats || 'custom',
      slug: company.slug || null,
      notes: company.notes || null,
      researchBrief: company.researchBrief || null,
      lastResearchedAt: company.lastResearchedAt || null,
    });

    return Number(result.lastInsertRowid) || this.getCompanyByName(company.name)?.id || 0;
  }

  getCompanyByName(name: string): CompanyRecord | undefined {
    const row = this.db.prepare('SELECT * FROM companies WHERE LOWER(name) = LOWER(?)').get(name) as Record<string, unknown> | undefined;
    return row ? this.rowToCompany(row) : undefined;
  }

  getCompanyById(id: number): CompanyRecord | undefined {
    const row = this.db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToCompany(row) : undefined;
  }

  getAllCompanies(): CompanyRecord[] {
    const rows = this.db.prepare('SELECT * FROM companies ORDER BY name ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToCompany(r));
  }

  updateCompanyResearchBrief(companyId: number, brief: string): void {
    this.db
      .prepare(`UPDATE companies SET research_brief = ?, last_researched_at = datetime('now') WHERE id = ?`)
      .run(brief, companyId);
  }

  getCompaniesWithoutContacts(): CompanyRecord[] {
    const rows = this.db.prepare(`
      SELECT c.* FROM companies c
      LEFT JOIN contacts ct ON c.id = ct.company_id
      WHERE ct.id IS NULL
      ORDER BY c.name ASC
    `).all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToCompany(r));
  }

  // ─── Contacts ──────────────────────────────────────────────

  addContact(contact: Omit<ContactRecord, 'id'>): number {
    const result = this.db
      .prepare(`
        INSERT INTO contacts (
          company_id, full_name, title, contact_type, linkedin_url,
          email, email_status, timezone, source, notes
        ) VALUES (
          @companyId, @fullName, @title, @contactType, @linkedinUrl,
          @email, @emailStatus, @timezone, @source, @notes
        )
      `)
      .run({
        companyId: contact.companyId,
        fullName: contact.fullName,
        title: contact.title,
        contactType: contact.contactType || 'generic_careers',
        linkedinUrl: contact.linkedinUrl || null,
        email: contact.email || null,
        emailStatus: contact.emailStatus || 'unknown',
        timezone: contact.timezone || 'Asia/Kolkata',
        source: contact.source || 'manual',
        notes: contact.notes || null,
      });

    return Number(result.lastInsertRowid);
  }

  getContactsForCompany(companyId: number): ContactRecord[] {
    const rows = this.db.prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY id ASC').all(companyId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToContact(r));
  }

  getAllContacts(filters?: { companyId?: number; emailStatus?: string }): ContactRecord[] {
    let query = 'SELECT * FROM contacts WHERE 1=1';
    const params: unknown[] = [];
    if (filters?.companyId) { query += ' AND company_id = ?'; params.push(filters.companyId); }
    if (filters?.emailStatus) { query += ' AND email_status = ?'; params.push(filters.emailStatus); }
    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToContact(r));
  }

  getContactById(id: number): ContactRecord | undefined {
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToContact(row) : undefined;
  }

  updateContactEmail(id: number, email: string, status: string): void {
    this.db.prepare('UPDATE contacts SET email = ?, email_status = ? WHERE id = ?').run(email, status, id);
  }

  // ─── Signals ───────────────────────────────────────────────

  addSignal(signal: Omit<SignalRecord, 'id'>): number {
    const result = this.db
      .prepare(`INSERT INTO signals (company_id, signal_type, detail, url) VALUES (?, ?, ?, ?)`)
      .run(signal.companyId, signal.signalType, signal.detail, signal.url || null);
    return Number(result.lastInsertRowid);
  }

  getSignalsForCompany(companyId: number): SignalRecord[] {
    const rows = this.db.prepare('SELECT * FROM signals WHERE company_id = ? ORDER BY seen_at DESC').all(companyId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r['id'] as number,
      companyId: r['company_id'] as number,
      signalType: r['signal_type'] as any,
      detail: r['detail'] as string,
      url: r['url'] as string | undefined,
      seenAt: r['seen_at'] as string,
    }));
  }

  hasSignalsForCompany(companyName: string): boolean {
    const company = this.getCompanyByName(companyName);
    if (!company || !company.id) return false;
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM signals WHERE company_id = ?').get(company.id) as { c: number }).c;
    return count > 0;
  }

  // ─── Suppression List ──────────────────────────────────────

  addToSuppressionList(email: string, reason: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO suppression_list (email, reason, added_at) VALUES (?, ?, datetime("now"))')
      .run(email.toLowerCase().trim(), reason);
  }

  isSuppressed(email: string): boolean {
    const row = this.db.prepare('SELECT email FROM suppression_list WHERE email = ?').get(email.toLowerCase().trim());
    return Boolean(row);
  }

  getSuppressionList(): SuppressionRecord[] {
    const rows = this.db.prepare('SELECT * FROM suppression_list ORDER BY added_at DESC').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      email: r['email'] as string,
      reason: r['reason'] as string,
      addedAt: r['added_at'] as string,
    }));
  }

  // ─── API Usage (for Hunter.io and other rate-capped APIs) ──

  getApiUsage(service: string, metricMonth: string): number {
    const row = this.db.prepare('SELECT call_count FROM api_usage WHERE service = ? AND metric_month = ?').get(service, metricMonth) as { call_count: number } | undefined;
    return row ? row.call_count : 0;
  }

  incrementApiUsage(service: string, metricMonth: string): number {
    this.db.prepare(`
      INSERT INTO api_usage (service, metric_month, call_count, last_called_at)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(service, metric_month) DO UPDATE SET
        call_count = call_count + 1,
        last_called_at = datetime('now')
    `).run(service, metricMonth);

    return this.getApiUsage(service, metricMonth);
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

  // ─── Row Mappers ───────────────────────────────────────────

  private rowToJob(row: Record<string, unknown>): JobPosting {
    return {
      id: row['id'] as number,
      title: row['title'] as string,
      company: row['company'] as string,
      location: row['location'] as string,
      isRemote: Boolean(row['is_remote'] ?? (/remote/i.test(String(row['location'] || '')) || /remote/i.test(String(row['title'] || '')))),
      url: row['url'] as string,
      description: row['description'] as string,
      salary: row['salary'] as string | undefined,
      rawSalary: row['salary'] as string | undefined,
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
      stretch: Boolean(row['stretch']),
      reasons: row['reasons'] ? (JSON.parse(row['reasons'] as string) as string[]) : undefined,
      isApplied: Boolean(row['is_applied']),
      appliedAt: row['applied_at'] as string | undefined,
      notes: row['notes'] as string | undefined,
      externalId: row['external_id'] as string | undefined,
    };
  }

  private rowToCompany(row: Record<string, unknown>): CompanyRecord {
    return {
      id: row['id'] as number,
      name: row['name'] as string,
      domain: row['domain'] as string,
      sizeBucket: (row['size_bucket'] as any) || 'mid',
      ats: (row['ats'] as any) || 'custom',
      slug: row['slug'] as string | undefined,
      notes: row['notes'] as string | undefined,
      researchBrief: row['research_brief'] as string | undefined,
      lastResearchedAt: row['last_researched_at'] as string | undefined,
      createdAt: row['created_at'] as string,
    };
  }

  private rowToContact(row: Record<string, unknown>): ContactRecord {
    return {
      id: row['id'] as number,
      companyId: row['company_id'] as number,
      fullName: row['full_name'] as string,
      title: row['title'] as string,
      contactType: (row['contact_type'] as any) || 'generic_careers',
      linkedinUrl: row['linkedin_url'] as string | undefined,
      email: row['email'] as string | undefined,
      emailStatus: (row['email_status'] as any) || 'unknown',
      timezone: (row['timezone'] as string) || 'Asia/Kolkata',
      source: row['source'] as string | undefined,
      notes: row['notes'] as string | undefined,
      createdAt: row['created_at'] as string,
    };
  }

  close(): void {
    this.db.close();
  }
}

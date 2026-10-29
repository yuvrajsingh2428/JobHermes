// ============================================================
// Unit Tests: Database Backup & Data Export Service
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { StorageService } from '../../src/storage/database';
import {
  createDatabaseBackup,
  exportData,
  escapeCsvField,
  objectsToCsv,
} from '../../src/utils/backup-export';

describe('Backup & Export Service', () => {
  const testDbDir = path.resolve(__dirname, '../fixtures/test-backup-export');
  const testDbPath = path.join(testDbDir, 'test.db');
  const backupDir = path.join(testDbDir, 'backups');
  const exportDir = path.join(testDbDir, 'exports');
  let storage: StorageService;

  beforeEach(() => {
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDbDir, { recursive: true });

    storage = new StorageService(testDbPath);

    // Seed test jobs
    storage.upsertJob({
      title: 'Senior SDET Lead',
      company: 'Postman',
      location: 'Bangalore, India',
      isRemote: true,
      url: 'https://postman.com/jobs/1',
      description: 'Playwright and TypeScript automated testing frameworks.',
      salary: '25-35 LPA',
      score: 88,
      status: 'new',
      isApplied: false,
      source: 'greenhouse',
      scrapedAt: new Date().toISOString(),
    });

    storage.upsertJob({
      title: 'QA Engineer in Test',
      company: 'HackerRank',
      location: 'Remote',
      isRemote: true,
      url: 'https://hackerrank.com/jobs/2',
      description: 'API testing with REST Assured.',
      salary: '20-28 LPA',
      score: 75,
      status: 'interview',
      isApplied: true,
      source: 'lever',
      scrapedAt: new Date().toISOString(),
    });

    // Seed test contact
    const compId = storage.upsertCompany({
      name: 'Postman',
      domain: 'postman.com',
      ats: 'greenhouse',
    });

    storage.addContact({
      companyId: compId,
      fullName: 'Priya Sharma',
      title: 'QA Manager',
      email: 'priya@postman.com',
      emailStatus: 'verified',
      timezone: 'Asia/Kolkata',
      source: 'manual',
    });

    // Seed test application
    storage.addApplication({
      jobId: 1,
      company: 'Postman',
      jobTitle: 'Senior SDET Lead',
      status: 'submitted',
      appliedAt: new Date().toISOString(),
    });

    // Seed test outreach
    storage.addOutreach({
      contactId: 1,
      jobId: 1,
      type: 'cold',
      variant: 'A',
      subject: 'SDET role at Postman',
      body: 'Hi Priya, testing outreach.',
      status: 'approved',
    });
  });

  afterEach(() => {
    storage.close();
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
  });

  describe('RFC 4180 CSV Escaping', () => {
    it('escapes strings with commas, quotes, and newlines', () => {
      expect(escapeCsvField('normal text')).toBe('normal text');
      expect(escapeCsvField('hello, world')).toBe('"hello, world"');
      expect(escapeCsvField('he said "hello"')).toBe('"he said ""hello"""');
      expect(escapeCsvField('line 1\nline 2')).toBe('"line 1\nline 2"');
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(undefined)).toBe('');
      expect(escapeCsvField(42)).toBe('42');
    });

    it('converts objects array to standard CSV lines', () => {
      const rows = [
        { name: 'John Doe', role: 'SDET, Automation', active: true },
        { name: 'Jane "Ace" Smith', role: 'QA Lead', active: false },
      ];
      const csv = objectsToCsv(rows);
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('name,role,active');
      expect(lines[1]).toBe('John Doe,"SDET, Automation",true');
      expect(lines[2]).toBe('"Jane ""Ace"" Smith",QA Lead,false');
    });
  });

  describe('createDatabaseBackup', () => {
    it('creates a valid snapshot with timestamp in the specified directory', () => {
      const res = createDatabaseBackup(testDbPath, backupDir);
      expect(res.success).toBe(true);
      expect(fs.existsSync(res.backupPath)).toBe(true);
      expect(res.sizeBytes).toBeGreaterThan(0);
      expect(res.backupPath).toContain('jobhermes-');
      expect(res.backupPath.endsWith('.db')).toBe(true);
    });

    it('throws when the database file does not exist', () => {
      expect(() => createDatabaseBackup('/non/existent/path.db', backupDir)).toThrow(
        /Database file not found/
      );
    });
  });

  describe('exportData', () => {
    it('exports jobs to CSV format', () => {
      const res = exportData(storage, 'jobs', 'csv', exportDir);
      expect(res.entity).toBe('jobs');
      expect(res.format).toBe('csv');
      expect(res.recordCount).toBe(2);
      expect(fs.existsSync(res.filePath)).toBe(true);

      const content = fs.readFileSync(res.filePath, 'utf-8');
      expect(content).toContain('Senior SDET Lead');
      expect(content).toContain('Postman');
      expect(content).toContain('HackerRank');
    });

    it('exports jobs to JSON format', () => {
      const res = exportData(storage, 'jobs', 'json', exportDir);
      expect(res.entity).toBe('jobs');
      expect(res.format).toBe('json');
      expect(res.recordCount).toBe(2);

      const content = JSON.parse(fs.readFileSync(res.filePath, 'utf-8'));
      expect(Array.isArray(content)).toBe(true);
      expect(content.length).toBe(2);
      expect(content[0].title).toBe('Senior SDET Lead');
    });

    it('exports contacts to CSV format', () => {
      const res = exportData(storage, 'contacts', 'csv', exportDir);
      expect(res.recordCount).toBe(1);
      const content = fs.readFileSync(res.filePath, 'utf-8');
      expect(content).toContain('Priya Sharma');
      expect(content).toContain('priya@postman.com');
    });

    it('exports applications and outreach records', () => {
      const appRes = exportData(storage, 'applications', 'json', exportDir);
      expect(appRes.recordCount).toBe(1);

      const outreachRes = exportData(storage, 'outreach', 'csv', exportDir);
      expect(outreachRes.recordCount).toBe(1);
      const content = fs.readFileSync(outreachRes.filePath, 'utf-8');
      expect(content).toContain('SDET role at Postman');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { StorageService } from '../../src/storage/database';

describe('Stale Jobs Reconcile & Empty Response Threshold', () => {
  const testDbPath = path.resolve(__dirname, '../fixtures/test-stale-reconcile.db');
  let storage: StorageService;
  let jobId: number;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
    storage = new StorageService(testDbPath);

    jobId = storage.upsertJob({
      title: 'Senior SDET',
      company: 'Acme Corp',
      url: 'https://acme.com/jobs/sdet-1',
      description: 'Test Automation',
      source: 'greenhouse',
      location: 'Remote',
      isRemote: true,
      scrapedAt: new Date().toISOString(),
      status: 'new',
      isApplied: false,
    });
  });

  afterEach(() => {
    try {
      storage.close();
    } catch {}
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  it('defers miss counting on transient empty responses under threshold', () => {
    // Scan 1: empty response
    const scan1 = storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
      emptyResponseThreshold: 3,
    });

    expect(scan1.skipped).toBe(true);
    expect(scan1.reason).toBe('empty_response_with_existing_jobs');
    expect(scan1.consecutiveEmptyScans).toBe(1);
    expect(storage.getCompanyEmptyScans('Acme Corp')).toBe(1);

    const jobAfter1 = storage.getJobById(jobId);
    expect(jobAfter1?.status).toBe('new');
    expect(jobAfter1?.consecutiveMissedScans).toBe(0);

    // Scan 2: empty response
    const scan2 = storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
      emptyResponseThreshold: 3,
    });

    expect(scan2.skipped).toBe(true);
    expect(scan2.consecutiveEmptyScans).toBe(2);
    expect(storage.getCompanyEmptyScans('Acme Corp')).toBe(2);

    const jobAfter2 = storage.getJobById(jobId);
    expect(jobAfter2?.status).toBe('new');
    expect(jobAfter2?.consecutiveMissedScans).toBe(0);
  });

  it('confirms empty response and closes absent jobs once threshold is reached', () => {
    // Scan 1 & 2: empty responses (skipped)
    storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
      emptyResponseThreshold: 3,
    });
    storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
      emptyResponseThreshold: 3,
    });

    // Scan 3: reaches threshold 3 -> confirms persistent empty response, counts 1st miss
    const scan3 = storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
      emptyResponseThreshold: 3,
    });

    expect(scan3.skipped).toBe(false);
    expect(scan3.newlyClosed).toHaveLength(0);

    const jobAfter3 = storage.getJobById(jobId);
    expect(jobAfter3?.status).toBe('new');
    expect(jobAfter3?.consecutiveMissedScans).toBe(1);

    // Scan 4: persistent empty response -> 2nd miss triggers auto-close
    const scan4 = storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
      emptyResponseThreshold: 3,
    });

    expect(scan4.skipped).toBe(false);
    expect(scan4.newlyClosed).toContain(jobId);

    const jobAfter4 = storage.getJobById(jobId);
    expect(jobAfter4?.status).toBe('closed');
    expect(jobAfter4?.consecutiveMissedScans).toBe(2);
  });

  it('resets consecutive empty scans count when jobs reappear', () => {
    // 2 empty scans
    storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
      emptyResponseThreshold: 3,
    });
    storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
      emptyResponseThreshold: 3,
    });
    expect(storage.getCompanyEmptyScans('Acme Corp')).toBe(2);

    // Job reappears in scan 3
    storage.recordJobSightings('Acme Corp', new Set(['https://acme.com/jobs/sdet-1']), {
      fetchSucceeded: true,
      skipIfEmptyWhenHadJobs: true,
    });
    expect(storage.getCompanyEmptyScans('Acme Corp')).toBe(0);
  });

  it('forceReconcile immediately counts misses bypassing empty guard threshold', () => {
    // 1st scan with forceReconcile: true counts miss immediately
    const scan1 = storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      forceReconcile: true,
    });

    expect(scan1.skipped).toBe(false);

    const jobAfter1 = storage.getJobById(jobId);
    expect(jobAfter1?.consecutiveMissedScans).toBe(1);

    // 2nd scan with forceReconcile: true closes the job
    const scan2 = storage.recordJobSightings('Acme Corp', new Set(), {
      fetchSucceeded: true,
      forceReconcile: true,
    });

    expect(scan2.newlyClosed).toContain(jobId);
    const jobAfter2 = storage.getJobById(jobId);
    expect(jobAfter2?.status).toBe('closed');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { SourceCache } from '../../src/sources/cache';
import { HttpClient } from '../../src/sources/http-client';
import { HermesAgent } from '../../src/agent/hermes-agent';
import { HermesConfig } from '../../src/types';
import * as sources from '../../src/sources';
import {
  cleanCanonicalUrl,
  normalizeJobTitle,
  deduplicateJobs,
  getSourceAdapter,
  fetchAllTargets,
} from '../../src/sources';
import {
  stripHtml,
  getTodayString,
  getTimestampString,
  sanitizeFilename,
  truncate,
  readJsonFile,
  writeJsonFile,
  calculateSetOverlap,
  formatBytes,
  parseSalaryLPA,
  withRetry,
  runConcurrent,
} from '../../src/utils/helpers';

describe('Coverage Booster: Cache, HttpClient, Sources, HermesAgent & Helpers', () => {
  describe('SourceCache (cache.ts)', () => {
    const testCacheDir = path.resolve(__dirname, '../fixtures/test-cache');
    let cache: SourceCache;

    beforeEach(() => {
      if (fs.existsSync(testCacheDir)) {
        fs.rmSync(testCacheDir, { recursive: true, force: true });
      }
      cache = new SourceCache(testCacheDir, 500); // 500ms TTL
    });

    afterEach(() => {
      if (fs.existsSync(testCacheDir)) {
        fs.rmSync(testCacheDir, { recursive: true, force: true });
      }
    });

    it('sets and gets entries from memory and filesystem', () => {
      cache.set('test-key', { foo: 'bar' });

      // First read: from memory
      const memVal = cache.get<{ foo: string }>('test-key');
      expect(memVal).toEqual({ foo: 'bar' });

      // Create new instance pointing to same directory to test disk read
      const freshCache = new SourceCache(testCacheDir, 500);
      const diskVal = freshCache.get<{ foo: string }>('test-key');
      expect(diskVal).toEqual({ foo: 'bar' });
    });

    it('expires entries after TTL', async () => {
      cache.set('expiring-key', 'value', 50); // 50ms TTL
      expect(cache.get('expiring-key')).toBe('value');

      await new Promise((r) => setTimeout(r, 80));
      expect(cache.get('expiring-key')).toBeNull();
    });

    it('clears all memory entries and cache files on disk', () => {
      cache.set('key1', 'val1');
      cache.set('key2', 'val2');

      cache.clear();

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      const files = fs.readdirSync(testCacheDir);
      expect(files.length).toBe(0);
    });

    it('handles non-existent or corrupted cache files gracefully', () => {
      expect(cache.get('non-existent')).toBeNull();

      // Write corrupted JSON to cache file
      const fakeKey = 'corrupt-key';
      cache.set(fakeKey, 'before');
      const files = fs.readdirSync(testCacheDir);
      expect(files.length).toBeGreaterThan(0);
      fs.writeFileSync(path.join(testCacheDir, files[0]), '{ invalid json');

      // Create fresh instance so memory map doesn't have it
      const fresh = new SourceCache(testCacheDir, 500);
      expect(fresh.get(fakeKey)).toBeNull();
    });
  });

  describe('HttpClient (http-client.ts)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates client with custom options and performs successful GET', async () => {
      const client = new HttpClient({
        minHostDelayMs: 0,
        maxRetries: 1,
        userAgent: 'TestAgent/1.0',
      });

      const mockAxiosInstance = {
        get: vi.fn().mockResolvedValue({
          data: { success: true },
          status: 200,
          headers: {},
        }),
      };
      (client as any).client = mockAxiosInstance;

      const res = await client.get<{ success: boolean }>('https://api.example.com/jobs', {
        useCache: false,
      });
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ success: true });
      expect(res.fromCache).toBe(false);
    });

    it('retries on HTTP 429 and parses retry-after header', async () => {
      const client = new HttpClient({
        minHostDelayMs: 0,
        maxRetries: 2,
      });

      const mockAxiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            data: { error: 'Rate limit' },
            status: 429,
            headers: { 'retry-after': '0' },
          })
          .mockResolvedValueOnce({
            data: { success: true },
            status: 200,
            headers: {},
          }),
      };
      (client as any).client = mockAxiosInstance;

      const res = await client.get<{ success: boolean }>('https://api.example.com/ratelimit', {
        useCache: false,
      });
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ success: true });
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('retries on network error and throws after maxRetries', async () => {
      const client = new HttpClient({
        minHostDelayMs: 0,
        maxRetries: 1,
      });

      const mockAxiosInstance = {
        get: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };
      (client as any).client = mockAxiosInstance;

      await expect(client.get('https://api.example.com/fail', { useCache: false })).rejects.toThrow(
        'Connection refused'
      );
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('returns non-200 4xx statuses without throwing if within validateStatus range', async () => {
      const client = new HttpClient({
        minHostDelayMs: 0,
        maxRetries: 0,
      });

      const mockAxiosInstance = {
        get: vi.fn().mockResolvedValue({
          data: { error: 'Not found' },
          status: 404,
          headers: {},
        }),
      };
      (client as any).client = mockAxiosInstance;

      const res = await client.get('https://api.example.com/404', { useCache: false });
      expect(res.status).toBe(404);
      expect(res.data).toEqual({ error: 'Not found' });
    });
  });

  describe('Sources & Normalization Utilities (sources/index.ts, types.ts)', () => {
    it('cleans tracking parameters and trailing slashes from URLs', () => {
      const raw =
        'https://boards.greenhouse.io/company/jobs/123/?utm_source=linkedin&gh_src=custom#section';
      const clean = cleanCanonicalUrl(raw);
      expect(clean).toBe('https://boards.greenhouse.io/company/jobs/123#section');
      expect(clean).not.toContain('utm_source');
      expect(clean).not.toContain('gh_src');
    });

    it('handles malformed URLs in cleanCanonicalUrl gracefully', () => {
      expect(cleanCanonicalUrl('not-a-url')).toBe('not-a-url');
    });

    it('normalizes job titles', () => {
      expect(normalizeJobTitle('Sr. SDET II - (Automation / QA!)')).toBe(
        'sr sdet ii automation qa'
      );
    });

    it('deduplicates jobs by canonical URL and compound key', () => {
      const jobs = [
        {
          title: 'SDET II',
          company: 'Acme',
          location: 'Bangalore',
          url: 'https://acme.com/jobs/1?utm_source=twitter/',
          source: 'greenhouse',
        },
        {
          title: 'sdet  ii',
          company: 'acme',
          location: 'Bangalore',
          url: 'https://acme.com/jobs/1',
          source: 'greenhouse',
        },
        {
          title: 'QA Lead',
          company: 'Acme',
          location: 'Bangalore',
          url: 'https://acme.com/jobs/2',
          source: 'greenhouse',
        },
      ];

      const deduped = deduplicateJobs(jobs as any);
      expect(deduped.length).toBe(2);
    });

    it('fetches all targets via fetchAllTargets wrapper', async () => {
      const jobs = await fetchAllTargets([]);
      expect(jobs).toEqual([]);
    });

    it('returns undefined for unknown ATS source adapter', () => {
      expect(getSourceAdapter('unknown_ats_type')).toBeUndefined();
    });
  });

  describe('HermesAgent Workflow Methods (agent/hermes-agent.ts)', () => {
    let testDbPath: string;
    let agent: HermesAgent;

    beforeEach(() => {
      testDbPath = path.resolve(__dirname, '../fixtures/test-hermes-agent.db');
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

      const config: HermesConfig = {
        openaiApiKey: 'mock-key',
        openaiModel: 'gpt-4o',
        temperature: 0.1,
        databasePath: testDbPath,
        reportsDir: './reports',
        documentsDir: './documents',
        logLevel: 'error',
        logDir: './logs',
        cronSchedule: '30 8 * * *',
        timezone: 'Asia/Kolkata',
        scrapeConcurrency: 1,
        requestDelayMs: 0,
        maxRetries: 1,
        candidateProfilePath: './config/candidate-profile.json',
        companyTargetsPath: './config/company-targets.json',
        minScoreThreshold: 60,
        topJobsCount: 5,
        userAgent: 'JobHermes/1.0',
        requestTimeoutMs: 5000,
      };

      agent = new HermesAgent(config);
    });

    afterEach(() => {
      if (agent) agent.shutdown();
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('executes resume and cover letter workflows for a job in storage', async () => {
      const storage = agent.getStorage();
      const jobId = storage.upsertJob({
        title: 'Lead SDET',
        company: 'Postman',
        location: 'Bangalore',
        description: 'TypeScript, Playwright, CI/CD, Jenkins automation',
        url: 'https://postman.com/jobs/lead',
        score: 85,
        status: 'new',
        isApplied: false,
        scrapedAt: new Date().toISOString(),
        source: 'greenhouse',
      });

      const resumePath = await agent.generateResume(jobId);
      expect(resumePath).toBeDefined();
      expect(fs.existsSync(resumePath)).toBe(true);

      const coverLetterPath = await agent.generateCoverLetter(jobId);
      expect(coverLetterPath).toBeDefined();
      expect(fs.existsSync(coverLetterPath)).toBe(true);

      const pack = await agent.generateApplicationPack(jobId);
      expect(pack.resumePath).toBeDefined();
      expect(pack.coverLetterPath).toBeDefined();

      expect(agent.getTopJobs().length).toBeGreaterThanOrEqual(1);
      expect(agent.getAllJobs().length).toBeGreaterThanOrEqual(1);
      expect(agent.getJobById(jobId)?.title).toBe('Lead SDET');
      expect(agent.getTasks().length).toBeGreaterThan(0);
      expect(agent.isCurrentlyScanning()).toBe(false);

      agent.updateJobStatus(jobId, 'applied', 'Submitted via portal');
      expect(agent.getJobById(jobId)?.status).toBe('applied');
    });

    it('scans QA titles and handles non-existent job in document generation', async () => {
      vi.spyOn(sources, 'fetchAllTargets').mockResolvedValueOnce([
        {
          title: 'Senior SDET',
          company: 'Acme',
          location: 'Bangalore',
          url: 'https://acme.com/jobs/1',
          source: 'greenhouse',
          description: 'Automation',
        },
        {
          title: 'Product Manager',
          company: 'Acme',
          location: 'Bangalore',
          url: 'https://acme.com/jobs/2',
          source: 'greenhouse',
          description: 'PM',
        },
      ]);

      const qaTitles = await agent.scanAllQaTitles();
      expect(qaTitles.length).toBe(1);
      expect(qaTitles[0].title).toBe('Senior SDET');
      expect(qaTitles[0].isSdetMatch).toBe(true);

      // Error handling on non-existent job
      await expect(agent.generateResume(99999)).rejects.toThrow();
      await expect(agent.generateCoverLetter(99999)).rejects.toThrow();
    });
  });

  describe('Helper Utilities (utils/helpers.ts)', () => {
    it('strips HTML tags and collapses spaces', () => {
      expect(stripHtml('<p>Hello world <b>SDET</b></p>')).toBe('Hello world SDET');
    });

    it('generates date and timestamp strings and sanitizes filenames', () => {
      expect(getTodayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(getTimestampString()).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(sanitizeFilename('Test / File : Name')).toBe('test-file-name');
      expect(truncate('Hello world this is a test', 15)).toBe('Hello world ...');
    });

    it('calculates set overlap, formatBytes and parseSalaryLPA', () => {
      const overlap = calculateSetOverlap(['Java', 'Selenium'], ['Selenium', 'Playwright']);
      expect(overlap).toBeCloseTo(0.333, 2);

      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(500)).toBe('500.0 B');

      expect(parseSalaryLPA('24 LPA')).toBe(24);
      expect(parseSalaryLPA('1.5 Cr')).toBe(150);
      expect(parseSalaryLPA('unknown')).toBeNull();
    });

    it('executes withRetry and runConcurrent successfully', async () => {
      let attempts = 0;
      const res = await withRetry(
        async () => {
          attempts++;
          if (attempts < 2) throw new Error('First try fails');
          return 'ok';
        },
        3,
        10
      );
      expect(res).toBe('ok');
      expect(attempts).toBe(2);

      const concurrentRes = await runConcurrent([1, 2, 3], async (n) => n * 2, 2);
      expect(concurrentRes).toEqual([2, 4, 6]);
    });

    it('reads and writes JSON files safely', () => {
      const tmpJson = path.resolve(__dirname, '../fixtures/test-helpers.json');
      writeJsonFile(tmpJson, { key: 'value' });
      const readBack = readJsonFile<{ key: string }>(tmpJson);
      expect(readBack.key).toBe('value');
      fs.unlinkSync(tmpJson);
    });
  });
});

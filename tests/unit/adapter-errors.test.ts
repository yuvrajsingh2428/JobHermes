import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { httpClient } from '../../src/sources/http-client';
import { fetchJobsForTargetDetailed } from '../../src/sources';
import { HermesAgent } from '../../src/agent/hermes-agent';
import { StorageService } from '../../src/storage/database';
import { CompanyTarget, HermesConfig } from '../../src/types';

describe('Real Adapter Error Path End-to-End Tests', () => {
  const adapters: Array<{
    ats: 'greenhouse' | 'lever' | 'ashby' | 'workable';
    slug: string;
    companyName: string;
    emptyPayload: any;
  }> = [
    {
      ats: 'greenhouse',
      slug: 'hackerrank',
      companyName: 'HackerRank',
      emptyPayload: { jobs: [] },
    },
    {
      ats: 'lever',
      slug: 'spotify',
      companyName: 'Spotify',
      emptyPayload: [],
    },
    {
      ats: 'ashby',
      slug: 'notion',
      companyName: 'Notion',
      emptyPayload: { jobs: [] },
    },
    {
      ats: 'workable',
      slug: 'delivery-hero',
      companyName: 'Delivery Hero',
      emptyPayload: { jobs: [] },
    },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const { ats, slug, companyName, emptyPayload } of adapters) {
    describe(`Adapter: ${ats} (${companyName})`, () => {
      const target: CompanyTarget = {
        name: companyName,
        domain: `${slug}.com`,
        ats,
        slug,
        sizeBucket: 'large',
        enabled: true,
        verified: true,
      };

      it(`handles timeout error via fetchJobsForTargetDetailed with fetchSucceeded=false`, async () => {
        const timeoutErr = Object.assign(new Error('timeout of 15000ms exceeded'), {
          code: 'ECONNABORTED',
        });
        vi.spyOn(httpClient, 'get').mockRejectedValueOnce(timeoutErr);

        const res = await fetchJobsForTargetDetailed(target);

        expect(res.fetchSucceeded).toBe(false);
        expect(res.success).toBe(false);
        expect(res.errorType).toBe('timeout');
        expect(res.jobs).toEqual([]);
      });

      it(`handles HTTP 404 via fetchJobsForTargetDetailed with fetchSucceeded=false`, async () => {
        vi.spyOn(httpClient, 'get').mockResolvedValueOnce({
          data: { error: 'Not Found' },
          status: 404,
          fromCache: false,
        });

        const res = await fetchJobsForTargetDetailed(target);

        expect(res.fetchSucceeded).toBe(false);
        expect(res.success).toBe(false);
        expect(res.errorType).toBe('http_error');
        expect(res.statusCode).toBe(404);
        expect(res.jobs).toEqual([]);
      });

      it(`handles HTTP 500 via fetchJobsForTargetDetailed with fetchSucceeded=false`, async () => {
        vi.spyOn(httpClient, 'get').mockRejectedValueOnce(
          new Error(`HTTP 500 from API endpoint after 3 retries`)
        );

        const res = await fetchJobsForTargetDetailed(target);

        expect(res.fetchSucceeded).toBe(false);
        expect(res.success).toBe(false);
        expect(res.errorType).toBe('http_error');
        expect(res.statusCode).toBe(500);
        expect(res.jobs).toEqual([]);
      });

      it(`handles malformed JSON / invalid payload via fetchJobsForTargetDetailed with fetchSucceeded=false`, async () => {
        vi.spyOn(httpClient, 'get').mockResolvedValueOnce({
          data: { unexpectedStructure: true, invalid: 'yes' },
          status: 200,
          fromCache: false,
        });

        const res = await fetchJobsForTargetDetailed(target);

        expect(res.fetchSucceeded).toBe(false);
        expect(res.success).toBe(false);
        expect(res.errorType).toBe('parse_error');
        expect(res.jobs).toEqual([]);
      });

      it(`handles empty-after-nonempty: fetchSucceeded=true with empty jobs`, async () => {
        vi.spyOn(httpClient, 'get').mockResolvedValueOnce({
          data: emptyPayload,
          status: 200,
          fromCache: false,
        });

        const res = await fetchJobsForTargetDetailed(target);

        expect(res.fetchSucceeded).toBe(true);
        expect(res.success).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(res.jobs).toEqual([]);
      });
    });
  }

  describe('Full Scan Run: No Job Misses Incremented on Adapter Failures or Empty Responses', () => {
    let testDbPath: string;
    let testTargetsPath: string;
    let storage: StorageService;
    let agent: HermesAgent;

    beforeEach(() => {
      testDbPath = path.resolve(__dirname, '../fixtures/test-adapter-errors.db');
      testTargetsPath = path.resolve(__dirname, '../fixtures/test-targets.json');
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

      const testTargets: CompanyTarget[] = adapters.map(({ ats, slug, companyName }) => ({
        name: companyName,
        domain: `${slug}.com`,
        ats,
        slug,
        sizeBucket: 'large',
        enabled: true,
        verified: true,
      }));
      fs.writeFileSync(testTargetsPath, JSON.stringify(testTargets, null, 2));

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
        scrapeConcurrency: 2,
        requestDelayMs: 0,
        maxRetries: 1,
        candidateProfilePath: './config/candidate-profile.json',
        companyTargetsPath: testTargetsPath,
        minScoreThreshold: 60,
        topJobsCount: 10,
        userAgent: 'JobHermes/1.0',
        requestTimeoutMs: 5000,
      };

      agent = new HermesAgent(config);
      storage = agent.getStorage();

      // Seed 1 active job for each test company with 0 consecutive misses
      for (const { companyName } of adapters) {
        storage.upsertJob({
          title: 'Senior SDET',
          company: companyName,
          location: 'Bangalore, India',
          description: 'Senior SDET test automation with Playwright and Java',
          url: `https://${companyName.toLowerCase().replace(/\s+/g, '')}.com/jobs/sdet-1`,
          score: 80,
          status: 'discovered',
          isApplied: false,
          scrapedAt: new Date().toISOString(),
          source: 'greenhouse',
        });
      }
    });

    afterEach(() => {
      if (agent) agent.shutdown();
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(testTargetsPath)) fs.unlinkSync(testTargetsPath);
    });

    it('asserts no job misses are incremented across full scan run when all adapters encounter timeout, 404, 500, or malformed JSON', async () => {
      // Mock httpClient to simulate errors for all targets
      let callCount = 0;
      vi.spyOn(httpClient, 'get').mockImplementation(async () => {
        callCount++;
        if (callCount % 4 === 1) {
          throw Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
        } else if (callCount % 4 === 2) {
          return { data: { error: 'Not Found' }, status: 404, fromCache: false };
        } else if (callCount % 4 === 3) {
          throw new Error('HTTP 500 from API endpoint after 3 retries');
        } else {
          return { data: { corrupt: true }, status: 200, fromCache: false };
        }
      });

      // Execute full scan run
      await agent.runDailyScan();

      // Verify that NO job misses were incremented for ANY company
      for (const { companyName } of adapters) {
        const jobs = storage.getAllJobs({ company: companyName });
        expect(jobs.length).toBe(1);
        expect(jobs[0].consecutiveMissedScans).toBe(0);
        expect(jobs[0].status).toBe('discovered');
      }
    });

    it('asserts no job misses are incremented across full scan run on empty-after-nonempty response', async () => {
      // Mock httpClient to return empty payload for all 4 targets (empty-after-nonempty)
      vi.spyOn(httpClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('greenhouse'))
          return { data: { jobs: [] }, status: 200, fromCache: false };
        if (url.includes('lever')) return { data: [], status: 200, fromCache: false };
        if (url.includes('ashby')) return { data: { jobs: [] }, status: 200, fromCache: false };
        if (url.includes('workable')) return { data: { jobs: [] }, status: 200, fromCache: false };
        return { data: [], status: 200, fromCache: false };
      });

      // Execute full scan run
      await agent.runDailyScan();

      // Verify that NO job misses were incremented for ANY company due to empty-after-nonempty guard
      for (const { companyName } of adapters) {
        const jobs = storage.getAllJobs({ company: companyName });
        expect(jobs.length).toBe(1);
        expect(jobs[0].consecutiveMissedScans).toBe(0);
        expect(jobs[0].status).toBe('discovered');
      }
    });
  });
});

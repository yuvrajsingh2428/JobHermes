// ============================================================
// Contract Tests – ATS Adapters with Recorded JSON Fixtures
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { httpClient } from '../../src/sources/http-client';
import { greenhouseSource } from '../../src/sources/greenhouse';
import { leverSource } from '../../src/sources/lever';
import { ashbySource } from '../../src/sources/ashby';
import { workableSource } from '../../src/sources/workable';
import { remotiveSource } from '../../src/sources/remotive';
import { remoteOKSource } from '../../src/sources/remoteok';
import { adzunaSource } from '../../src/sources/adzuna';
import { playwrightFallbackSource } from '../../src/sources/playwright-fallback';
import { RawJobSchema } from '../../src/types';

function loadFixture<T>(filename: string): T {
  const filePath = path.resolve(__dirname, '../fixtures/sources', filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('ATS Source Contract Tests (Fixture-based, no live network)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Greenhouse adapter correctly normalizes Greenhouse payload', async () => {
    const fixture = loadFixture('greenhouse.json');
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: fixture,
      status: 200,
      fromCache: false,
    });

    const target = {
      name: 'Postman',
      domain: 'postman.com',
      ats: 'greenhouse' as const,
      slug: 'postman',
      sizeBucket: 'large' as const,
      locations: ['Bangalore'],
      enabled: true,
      verified: true,
    };

    const jobs = await greenhouseSource.fetchJobs(target);
    expect(jobs.length).toBe(2);

    // Validate against RawJobSchema
    for (const job of jobs) {
      expect(RawJobSchema.safeParse(job).success).toBe(true);
    }

    const sdetJob = jobs.find((j) => j.title.includes('SDET'));
    expect(sdetJob).toBeDefined();
    expect(sdetJob?.company).toBe('Postman');
    expect(sdetJob?.location).toBe('Bangalore, India');
    expect(sdetJob?.source).toBe('greenhouse');
    expect(sdetJob?.externalId).toBe('101');
    expect(sdetJob?.description).toContain('Java, Selenium, REST Assured');
  });

  it('Lever adapter correctly normalizes Lever payload', async () => {
    const fixture = loadFixture('lever.json');
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: fixture,
      status: 200,
      fromCache: false,
    });

    const target = {
      name: 'CRED',
      domain: 'cred.club',
      ats: 'lever' as const,
      slug: 'cred',
      sizeBucket: 'mid' as const,
      locations: ['Bangalore'],
      enabled: true,
      verified: true,
    };

    const jobs = await leverSource.fetchJobs(target);
    expect(jobs.length).toBe(2);

    for (const job of jobs) {
      expect(RawJobSchema.safeParse(job).success).toBe(true);
    }

    const qaJob = jobs[0];
    expect(qaJob.title).toBe('Quality Assurance Automation Engineer');
    expect(qaJob.company).toBe('CRED');
    expect(qaJob.location).toBe('Bangalore');
    expect(qaJob.source).toBe('lever');
    expect(qaJob.externalId).toBe('lever-sdet-1');
    expect(qaJob.description).toContain('Playwright, TypeScript');
  });

  it('Ashby adapter correctly normalizes Ashby payload', async () => {
    const fixture = loadFixture('ashby.json');
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: fixture,
      status: 200,
      fromCache: false,
    });

    const target = {
      name: 'Wingify',
      domain: 'wingify.com',
      ats: 'ashby' as const,
      slug: 'wingify',
      sizeBucket: 'mid' as const,
      locations: ['Delhi NCR'],
      enabled: true,
      verified: true,
    };

    const jobs = await ashbySource.fetchJobs(target);
    expect(jobs.length).toBe(1);

    const sdetJob = jobs[0];
    expect(RawJobSchema.safeParse(sdetJob).success).toBe(true);
    expect(sdetJob.title).toBe('Software Engineer in Test (SDET)');
    expect(sdetJob.company).toBe('Wingify');
    expect(sdetJob.location).toBe('Delhi NCR, India');
    expect(sdetJob.isRemote).toBe(true);
    expect(sdetJob.source).toBe('ashby');
    expect(sdetJob.url).toBe('https://jobs.ashbyhq.com/wingify/ashby-job-1');
  });

  it('Workable adapter correctly normalizes Workable payload', async () => {
    const fixture = loadFixture('workable.json');
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: fixture,
      status: 200,
      fromCache: false,
    });

    const target = {
      name: 'LeadSquared',
      domain: 'leadsquared.com',
      ats: 'workable' as const,
      slug: 'leadsquared',
      sizeBucket: 'large' as const,
      locations: ['Bangalore'],
      enabled: true,
      verified: true,
    };

    const jobs = await workableSource.fetchJobs(target);
    expect(jobs.length).toBe(1);

    const sdetJob = jobs[0];
    expect(RawJobSchema.safeParse(sdetJob).success).toBe(true);
    expect(sdetJob.title).toBe('SDET - Test Automation Engineer');
    expect(sdetJob.company).toBe('LeadSquared');
    expect(sdetJob.location).toContain('Bangalore');
    expect(sdetJob.source).toBe('workable');
  });

  it('Remotive adapter filters for QA keywords and normalizes payload', async () => {
    const fixture = loadFixture('remotive.json');
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: fixture,
      status: 200,
      fromCache: false,
    });

    const target = {
      name: 'Remotive Feed',
      domain: 'remotive.com',
      ats: 'remotive' as const,
      slug: 'remotive-qa',
      sizeBucket: 'large' as const,
      locations: ['Remote'],
      enabled: true,
      verified: true,
    };

    const jobs = await remotiveSource.fetchJobs(target);
    // Should filter out Product Manager and keep only SDET
    expect(jobs.length).toBe(1);
    expect(jobs[0].title).toBe('Senior SDET - Automation');
    expect(jobs[0].company).toBe('TestCorp Remote');
    expect(jobs[0].isRemote).toBe(true);
    expect(jobs[0].rawSalary).toBe('$70k - $90k');
    expect(RawJobSchema.safeParse(jobs[0]).success).toBe(true);
  });

  it('RemoteOK adapter skips legal meta and filters for QA keywords', async () => {
    const fixture = loadFixture('remoteok.json');
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: fixture,
      status: 200,
      fromCache: false,
    });

    const target = {
      name: 'RemoteOK Feed',
      domain: 'remoteok.com',
      ats: 'remoteok' as const,
      slug: 'remoteok-qa',
      sizeBucket: 'large' as const,
      locations: ['Remote'],
      enabled: true,
      verified: true,
    };

    const jobs = await remoteOKSource.fetchJobs(target);
    // Should filter out meta item and Rust engineer, keeping only QA Automation
    expect(jobs.length).toBe(1);
    expect(jobs[0].title).toBe('SDET / QA Automation Engineer');
    expect(jobs[0].company).toBe('AutomateHQ');
    expect(jobs[0].isRemote).toBe(true);
    expect(RawJobSchema.safeParse(jobs[0]).success).toBe(true);
  });

  it('Adzuna adapter normalizes search results when API keys are present', async () => {
    process.env.ADZUNA_APP_ID = 'test-id';
    process.env.ADZUNA_APP_KEY = 'test-key';

    const fixture = loadFixture('adzuna.json');
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: fixture,
      status: 200,
      fromCache: false,
    });

    const target = {
      name: 'Adzuna In',
      domain: 'adzuna.com',
      ats: 'custom' as const,
      slug: 'adzuna-in',
      sizeBucket: 'large' as const,
      locations: ['India'],
      enabled: true,
      verified: true,
    };

    const jobs = await adzunaSource.fetchJobs(target);
    expect(jobs.length).toBe(1);
    expect(jobs[0].title).toBe('Senior SDET Automation');
    expect(jobs[0].company).toBe('Fintech Innovations');
    expect(jobs[0].rawSalary).toContain('INR');
    expect(RawJobSchema.safeParse(jobs[0]).success).toBe(true);

    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
  });

  it('Playwright fallback adapter parses jobs from saved HTML fixture', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/sources/custom-careers.html');
    const fileUrl = pathToFileURL(fixturePath).href;

    const target = {
      name: 'CustomTech',
      domain: 'customtech.com',
      ats: 'custom' as const,
      slug: 'customtech',
      customUrl: fileUrl,
      listSelector: '.job-card',
      titleSelector: '.title',
      linkSelector: '.apply-link',
      sizeBucket: 'mid' as const,
      locations: ['India'],
      enabled: true,
      verified: true,
    };

    const jobs = await playwrightFallbackSource.fetchJobs(target);
    expect(jobs.length).toBe(3);

    for (const job of jobs) {
      expect(RawJobSchema.safeParse(job).success).toBe(true);
      expect(job.company).toBe('CustomTech');
      expect(job.source).toBe('playwright_custom');
    }

    const sdetJob = jobs.find((j) => j.title.includes('Lead SDET'));
    expect(sdetJob).toBeDefined();
    expect(sdetJob?.url).toBe('https://customtech.com/careers/lead-sdet');
  });
});

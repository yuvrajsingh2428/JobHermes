// ============================================================
// Unit Tests – Add Company ATS URL Detection
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { detectAtsFromUrl, addCompanyFromUrl } from '../../src/sources/add-company';
import { verifyTargetSlug } from '../../src/sources/verify-targets';
import { fetchJobsForTarget } from '../../src/sources';
import { httpClient } from '../../src/sources/http-client';

describe('Add Company ATS URL Detection Unit Tests', () => {
  it('detects Greenhouse URLs and extracts slug correctly', () => {
    expect(detectAtsFromUrl('https://boards.greenhouse.io/postman')).toEqual({
      ats: 'greenhouse',
      slug: 'postman',
      isCustom: false,
    });
    expect(detectAtsFromUrl('https://groww.greenhouse.io')).toEqual({
      ats: 'greenhouse',
      slug: 'groww',
      isCustom: false,
    });
  });

  it('detects Lever URLs and extracts slug correctly', () => {
    expect(detectAtsFromUrl('https://jobs.lever.co/cred')).toEqual({
      ats: 'lever',
      slug: 'cred',
      isCustom: false,
    });
  });

  it('detects Ashby URLs and extracts slug correctly', () => {
    expect(detectAtsFromUrl('https://jobs.ashbyhq.com/wingify')).toEqual({
      ats: 'ashby',
      slug: 'wingify',
      isCustom: false,
    });
  });

  it('detects Workable URLs and extracts slug correctly', () => {
    expect(detectAtsFromUrl('https://apply.workable.com/leadsquared')).toEqual({
      ats: 'workable',
      slug: 'leadsquared',
      isCustom: false,
    });
  });

  it('falls back to custom for unrecognized career URLs', () => {
    const res = detectAtsFromUrl('https://careers.google.com/jobs');
    expect(res.ats).toBe('custom');
    expect(res.isCustom).toBe(true);
  });
});

describe('verifyTargetSlug Error Handling across ATS Types', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const atsTypes: Array<{
    ats: 'greenhouse' | 'lever' | 'ashby' | 'workable';
    slug: string;
    name: string;
  }> = [
    { ats: 'greenhouse', slug: 'hackerrank', name: 'HackerRank' },
    { ats: 'lever', slug: 'spotify', name: 'Spotify' },
    { ats: 'ashby', slug: 'notion', name: 'Notion' },
    { ats: 'workable', slug: 'delivery-hero', name: 'Delivery Hero' },
  ];

  for (const { ats, slug, name } of atsTypes) {
    it(`handles network/timeout errors gracefully for ${ats} (${name})`, async () => {
      vi.spyOn(httpClient, 'get').mockRejectedValueOnce(
        new Error(`Connection refused to ${ats} API endpoint`)
      );

      const result = await verifyTargetSlug({
        name,
        ats,
        slug,
        domain: `${slug}.com`,
        sizeBucket: 'large',
        enabled: true,
      });

      expect(result.status).toBe('error');
      expect(result.name).toBe(name);
      expect(result.ats).toBe(ats);
      expect(result.slug).toBe(slug);
      expect(result.message).toContain(`Connection refused to ${ats} API endpoint`);
    });

    it(`handles HTTP 500 error responses gracefully for ${ats} (${name})`, async () => {
      vi.spyOn(httpClient, 'get').mockResolvedValueOnce({
        status: 500,
        data: { error: 'Internal Server Error' },
        fromCache: false,
      });

      const result = await verifyTargetSlug({
        name,
        ats,
        slug,
        domain: `${slug}.com`,
        sizeBucket: 'large',
        enabled: true,
      });

      expect(result.status).toBe('error');
      expect(result.statusCode).toBe(500);
      expect(result.message).toContain('HTTP 500');
    });
  }
});

describe('addCompanyFromUrl & Caller Error Handling', () => {
  const tmpConfig = path.resolve(__dirname, '../fixtures/test-add-company-tmp.json');

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tmpConfig)) {
      fs.unlinkSync(tmpConfig);
    }
  });

  it('handles verification errors gracefully when adding a company from URL', async () => {
    // Simulate network error during verification
    vi.spyOn(httpClient, 'get').mockRejectedValueOnce(new Error('Network unreachable'));

    const entry = await addCompanyFromUrl('https://boards.greenhouse.io/postman', tmpConfig);

    expect(entry).toBeDefined();
    expect(entry.name).toBe('Postman');
    expect(entry.ats).toBe('greenhouse');
    expect(entry.slug).toBe('postman');
    // Error was caught; target created with verified: false
    expect(entry.verified).toBe(false);

    // Verify written to config
    expect(fs.existsSync(tmpConfig)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(tmpConfig, 'utf-8'));
    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe('Postman');
    expect(saved[0].verified).toBe(false);
  });

  it('fetchJobsForTarget handles adapter thrown errors and returns empty array', async () => {
    vi.spyOn(httpClient, 'get').mockRejectedValueOnce(new Error('ATS API down'));

    const jobs = await fetchJobsForTarget({
      name: 'HackerRank',
      ats: 'greenhouse',
      slug: 'hackerrank',
      domain: 'hackerrank.com',
      sizeBucket: 'large',
      enabled: true,
    });

    expect(jobs).toEqual([]);
  });
});

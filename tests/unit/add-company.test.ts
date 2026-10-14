// ============================================================
// Unit Tests – Add Company ATS URL Detection
// ============================================================

import { describe, it, expect } from 'vitest';
import { detectAtsFromUrl } from '../../src/sources/add-company';

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

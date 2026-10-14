// ============================================================
// Unit Tests – Experience & Salary Parsers
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseExperienceRequirement, parseSalaryLPA } from '../../src/scoring/parsers';

describe('Experience Parser Unit Tests', () => {
  it('parses range formats ("1-3 years", "2 to 4 yrs")', () => {
    expect(parseExperienceRequirement('Looking for 1-3 years of experience in QA')).toEqual({
      minYears: 1,
      maxYears: 3,
      rawMatch: '1-3 years of experience',
      isFresher: false,
    });

    expect(parseExperienceRequirement('Candidate must have 2 to 4 yrs experience')).toEqual({
      minYears: 2,
      maxYears: 4,
      rawMatch: '2 to 4 yrs experience',
      isFresher: false,
    });
  });

  it('parses plus formats ("2+ years", "3 + yrs")', () => {
    const res = parseExperienceRequirement('Requires 2+ years working with Selenium');
    expect(res.minYears).toBe(2);
    expect(res.maxYears).toBeNull();
    expect(res.isFresher).toBe(false);
  });

  it('parses minimum / at least formats', () => {
    const res = parseExperienceRequirement('Minimum 3 years in API automation');
    expect(res.minYears).toBe(3);
    expect(res.isFresher).toBe(false);
  });

  it('detects fresher and entry level keywords', () => {
    expect(parseExperienceRequirement('We welcome freshers for this QA role').isFresher).toBe(true);
    expect(parseExperienceRequirement('Entry-level software engineer in test').isFresher).toBe(true);
  });

  it('handles JDs with no experience mentioned gracefully', () => {
    expect(parseExperienceRequirement('Passionate about testing and automated frameworks')).toEqual({
      minYears: null,
      maxYears: null,
      rawMatch: null,
      isFresher: false,
    });
  });
});

describe('Salary Parser Unit Tests', () => {
  it('parses LPA ranges ("15-25 LPA", "20 LPA")', () => {
    expect(parseSalaryLPA('15-25 LPA')).toEqual({
      minLpa: 15,
      maxLpa: 25,
      rawMatch: '15-25 LPA',
    });

    expect(parseSalaryLPA('20 LPA')).toEqual({
      minLpa: 20,
      maxLpa: 20,
      rawMatch: '20 LPA',
    });
  });

  it('parses Lakhs formats ("18 Lakhs")', () => {
    const res = parseSalaryLPA('Compensation: 18 Lakhs per annum');
    expect(res.minLpa).toBe(18);
  });

  it('parses raw numbers in INR (1500000 - 2500000)', () => {
    const res = parseSalaryLPA('1500000 - 2500000 INR');
    expect(res.minLpa).toBe(15);
    expect(res.maxLpa).toBe(25);
  });

  it('returns nulls for missing or unparseable salaries', () => {
    expect(parseSalaryLPA(undefined)).toEqual({ minLpa: null, maxLpa: null, rawMatch: null });
    expect(parseSalaryLPA('Competitive benefits package')).toEqual({ minLpa: null, maxLpa: null, rawMatch: null });
  });
});

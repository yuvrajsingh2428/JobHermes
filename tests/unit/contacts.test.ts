import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  detectDomainPattern,
  generateEmailFromPattern,
  proposeContactEmails,
} from '../../src/contacts/pattern-inferrer';
import {
  ContactService,
  isWithinSendWindow,
} from '../../src/contacts/contact-service';
import { HunterAdapter } from '../../src/contacts/hunter-adapter';
import { StorageService } from '../../src/storage/database';
import { scoringService } from '../../src/scoring/scorer';
import { CandidateProfile, RawJob } from '../../src/types';
import { httpClient } from '../../src/sources/http-client';

describe('Phase 2 Contacts, Patterns, Signals, and Send Window Tests', () => {
  const testDbPath = path.resolve(__dirname, '../fixtures/test-phase2.db');
  let storage: StorageService;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {
        // Ignore
      }
    }
    storage = new StorageService(testDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {
        // Ignore
      }
    }
  });

  describe('Email Pattern Inferrer', () => {
    it('detects first.last pattern correctly from known email and name', () => {
      const pattern = detectDomainPattern('john.doe@company.com', 'John Doe');
      expect(pattern).toBe('first.last');
    });

    it('detects flast pattern correctly', () => {
      const pattern = detectDomainPattern('jdoe@company.com', 'John Doe');
      expect(pattern).toBe('flast');
    });

    it('detects firstlast pattern correctly', () => {
      const pattern = detectDomainPattern('johndoe@company.com', 'John Doe');
      expect(pattern).toBe('firstlast');
    });

    it('generates emails according to specified pattern', () => {
      expect(generateEmailFromPattern('Priya Sharma', 'hackerrank.com', 'first.last')).toBe(
        'priya.sharma@hackerrank.com'
      );
      expect(generateEmailFromPattern('Priya Sharma', 'hackerrank.com', 'flast')).toBe(
        'psharma@hackerrank.com'
      );
      expect(generateEmailFromPattern('Priya Sharma', 'hackerrank.com', 'first')).toBe(
        'priya@hackerrank.com'
      );
    });

    it('proposes prioritized guesses when known company email pattern is provided', () => {
      const proposals = proposeContactEmails('Arjun Mehta', 'hackerrank.com', 'priya.sharma@hackerrank.com', 'Priya Sharma');
      expect(proposals.length).toBe(1);
      expect(proposals[0].email).toBe('arjun.mehta@hackerrank.com');
      expect(proposals[0].pattern).toBe('first.last');
    });
  });

  describe('Targeting Rules by Company Size', () => {
    it('targets Founder / CTO for early-stage startups', () => {
      const service = new ContactService(storage);
      const rule = service.getTargetingRule({
        name: 'EarlyStartup',
        domain: 'startup.io',
        sizeBucket: 'startup',
        ats: 'custom',
      });
      expect(rule.priorityTypes).toContain('founder_cto');
      expect(rule.targetTitles).toContain('CTO');
    });

    it('targets QA Manager / Eng Manager for mid-size firms', () => {
      const service = new ContactService(storage);
      const rule = service.getTargetingRule({
        name: 'GrowthMid',
        domain: 'growth.io',
        sizeBucket: 'mid',
        ats: 'lever',
      });
      expect(rule.priorityTypes).toContain('qa_manager');
      expect(rule.priorityTypes).toContain('eng_manager');
    });

    it('targets Technical Recruiter for large enterprises', () => {
      const service = new ContactService(storage);
      const rule = service.getTargetingRule({
        name: 'EnterpriseCorp',
        domain: 'enterprise.com',
        sizeBucket: 'large',
        ats: 'greenhouse',
      });
      expect(rule.priorityTypes).toContain('recruiter');
      expect(rule.targetTitles).toContain('Technical Recruiter');
    });
  });

  describe('Send Window Guard (Timezone & Business Hours)', () => {
    it('permits sending during business hours (11:00 AM) on a weekday in Asia/Kolkata', () => {
      // 2026-10-14 is a Wednesday at 05:30 UTC -> 11:00 AM IST
      const wednesdayIst = new Date('2026-10-14T05:30:00.000Z');
      const check = isWithinSendWindow('Asia/Kolkata', wednesdayIst);
      expect(check.allowed).toBe(true);
      expect(check.localHour).toBe(11);
    });

    it('blocks sending outside business hours (22:30 / 10:30 PM) in Asia/Kolkata', () => {
      // 2026-10-14 at 17:00 UTC -> 22:30 IST
      const nightIst = new Date('2026-10-14T17:00:00.000Z');
      const check = isWithinSendWindow('Asia/Kolkata', nightIst);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Outside business hours');
    });

    it('blocks sending on weekends (Sunday)', () => {
      // 2026-10-18 is a Sunday
      const sunday = new Date('2026-10-18T06:00:00.000Z');
      const check = isWithinSendWindow('Asia/Kolkata', sunday);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Outside business days');
    });

    it('correctly calculates recipient time in America/New_York', () => {
      // 2026-10-14 at 15:00 UTC -> 11:00 AM EDT (business hours in New York)
      const nyTime = new Date('2026-10-14T15:00:00.000Z');
      const check = isWithinSendWindow('America/New_York', nyTime);
      expect(check.allowed).toBe(true);
      expect(check.localHour).toBe(11);
    });
  });

  describe('CSV Contact Importer', () => {
    it('imports contacts from fixture with timezones, roles, and company linkage', () => {
      const service = new ContactService(storage);
      const fixturePath = path.resolve(__dirname, '../fixtures/contacts.csv');
      const result = service.importContactsFromCsv(fixturePath);

      expect(result.imported).toBe(3);
      expect(result.failed).toBe(0);

      const all = storage.getAllContacts();
      expect(all.length).toBe(3);

      const priya = all.find((c) => c.fullName === 'Priya Sharma');
      expect(priya).toBeDefined();
      expect(priya?.title).toBe('QA Engineering Manager');
      expect(priya?.contactType).toBe('qa_manager');
      expect(priya?.timezone).toBe('Asia/Kolkata');
      expect(priya?.emailStatus).toBe('verified');

      const emily = all.find((c) => c.fullName === 'Emily Watson');
      expect(emily).toBeDefined();
      expect(emily?.timezone).toBe('America/New_York');
      expect(emily?.contactType).toBe('recruiter');
    });
  });

  describe('Hunter.io Adapter Quota Capping', () => {
    it('enforces monthly API cap using database tracking', async () => {
      const hunter = new HunterAdapter(storage, 2);
      process.env.HUNTER_API_KEY = 'test_hunter_key';

      vi.spyOn(httpClient, 'get').mockResolvedValue({
        data: {
          data: {
            domain: 'target.com',
            emails: [{ value: 'contact@target.com', type: 'generic', confidence: 90 }],
          },
        },
        status: 200,
        fromCache: false,
      });

      // 1st call: allowed
      const res1 = await hunter.domainSearch('target1.com');
      expect(res1).not.toBeNull();

      // 2nd call: allowed
      const res2 = await hunter.domainSearch('target2.com');
      expect(res2).not.toBeNull();

      // 3rd call: must be blocked because cap is 2
      const res3 = await hunter.domainSearch('target3.com');
      expect(res3).toBeNull();

      delete process.env.HUNTER_API_KEY;
    });
  });

  describe('Signals and Scorer Bonus Integration', () => {
    const mockProfile: CandidateProfile = {
      name: 'Test Candidate',
      title: 'SDET',
      email: 'candidate@test.com',
      location: 'Bangalore, India',
      experienceYears: 2,
      minExperienceYears: 1,
      maxExperienceYears: 3,
      skills: {
        languages: ['Java', 'Python'],
        automationTools: ['Selenium', 'Playwright', 'REST Assured'],
        frameworks: ['TestNG'],
        devopsAndCiCd: ['Jenkins'],
        databases: ['PostgreSQL'],
        methodologies: ['API Testing'],
      },
      preferredLocations: ['Bangalore'],
      openToRemote: true,
    };

    const mockJob: RawJob = {
      title: 'SDET II - Automation',
      company: 'HackerRank',
      location: 'Bangalore, India',
      isRemote: false,
      url: 'https://hackerrank.com/jobs/1',
      description: 'Looking for SDET with 2-3 years experience in Java, Selenium, REST Assured, Jenkins.',
      source: 'greenhouse',
      postedAt: new Date().toISOString(),
    };

    it('adds +10 bonus when company has positive hiring/growth signal', () => {
      const breakdownWithoutSignal = scoringService.scoreJob(mockJob, mockProfile);
      expect(breakdownWithoutSignal.hiringSignal).toBe(0);

      const breakdownWithSignal = scoringService.scoreJob(mockJob, mockProfile, {
        hasCompanySignal: true,
        signalType: 'funding',
        signalDetail: 'Series C $60M led by Tiger Global',
      });

      expect(breakdownWithSignal.hiringSignal).toBe(10);
      expect(breakdownWithSignal.total).toBe(breakdownWithoutSignal.total + 10);
      expect(breakdownWithSignal.reasons.some((r) => r.includes('Series C $60M'))).toBe(true);
    });

    it('adds +10 bonus when company has multiple open QA roles', () => {
      const breakdown = scoringService.scoreJob(mockJob, mockProfile, {
        companyOpenQaCount: 3,
      });
      expect(breakdown.hiringSignal).toBe(10);
      expect(breakdown.reasons.some((r) => r.includes('Multiple active QA/SDET openings (3 roles)'))).toBe(true);
    });

    it('does not give bonus and flags when company signal is layoffs', () => {
      const breakdown = scoringService.scoreJob(mockJob, mockProfile, {
        hasCompanySignal: true,
        signalType: 'layoffs',
        signalDetail: '15% engineering team reduction',
      });
      expect(breakdown.hiringSignal).toBe(0);
      expect(breakdown.reasons.some((r) => r.includes('Company signal indicates recent layoffs'))).toBe(true);
    });
  });

  describe('Direct Application Tracking', () => {
    it('records direct applications and updates job status', () => {
      const jobId = storage.upsertJob({
        title: 'SDET Automation Engineer',
        company: 'Razorpay',
        location: 'Bangalore',
        isRemote: false,
        url: 'https://razorpay.com/careers/123',
        description: 'Testing automation with Java and Playwright',
        source: 'lever',
        scrapedAt: new Date().toISOString(),
      });

      const now = new Date().toISOString();
      storage.markApplied(jobId, now);
      const appId = storage.addApplication({
        jobId,
        appliedAt: now,
        notes: 'Applied via company careers portal',
        outcome: 'applied',
      });

      expect(appId).toBeGreaterThan(0);

      const job = storage.getJobById(jobId);
      expect(job?.isApplied).toBe(true);
      expect(job?.status).toBe('applied');

      const apps = storage.getApplications(jobId);
      expect(apps.length).toBe(1);
      expect(apps[0].notes).toBe('Applied via company careers portal');
    });
  });
});

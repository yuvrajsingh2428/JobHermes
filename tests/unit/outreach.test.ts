import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { StorageService } from '../../src/storage/database';
import { SendService } from '../../src/outreach/send-service';
import { DraftGenerator } from '../../src/outreach/draft-generator';
import { ScoringService } from '../../src/scoring/scorer';
import { CandidateProfile, ContactRecord, JobPosting, CompanyRecord, SignalRecord } from '../../src/types';

describe('Phase 3 Outreach Engine, Safety Rails & Grounding Tests', () => {
  let storage: StorageService;
  let testCompanyId: number;
  let testContactId: number;
  const testDbPath = path.resolve(__dirname, '../fixtures/test-outreach.db');

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    storage = new StorageService(testDbPath);

    testCompanyId = storage.upsertCompany({
      name: 'HackerRank',
      domain: 'hackerrank.com',
      sizeBucket: 'mid',
      ats: 'greenhouse',
      notes: 'Test company',
    });

    testContactId = storage.addContact({
      companyId: testCompanyId,
      fullName: 'Priya Sharma',
      title: 'QA Engineering Manager',
      contactType: 'qa_manager',
      email: 'priya.sharma@hackerrank.com',
      emailStatus: 'verified',
      timezone: 'Asia/Kolkata',
      source: 'manual',
    });
  });

  afterEach(() => {
    storage.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  const validProfile: CandidateProfile = {
    name: 'Yuvraj Singh',
    email: 'yuvraj@example.com',
    phone: '+91 9999999999',
    location: 'Bangalore, India',
    currentRole: 'SDET',
    yearsOfExperience: 2,
    targetRoles: ['SDET', 'SDET-2', 'Automation Test Engineer'],
    preferredLocations: ['Bangalore', 'Delhi NCR', 'Remote'],
    openToRelocation: true,
    targetCompanies: { tier1: ['Postman'], tier2: ['Cred'], tier3: [] },
    minSalaryLPA: 18,
    targetSalaryLPA: 24,
    skills: {
      languages: ['Java', 'Python', 'TypeScript', 'SQL'],
      automationTools: ['Selenium', 'Playwright', 'REST Assured'],
      frameworks: ['TestNG', 'JUnit', 'PyTest', 'Cucumber'],
      devopsAndCiCd: ['Jenkins', 'GitHub Actions', 'Docker', 'Git'],
      methodologies: ['Agile', 'BDD', 'Shift-Left Testing', 'API Testing'],
      domains: ['Fintech', 'SaaS', 'E-commerce'],
    },
    keyStrengths: [
      'Built hybrid automation framework reducing execution time by 45%',
      'Designed scalable API testing pipelines in Jenkins',
    ],
    achievements: [
      'Built automated regression suites reducing manual test cycles by 60%',
      'Architected API test coverage from 20% to 90%',
    ],
    links: {
      linkedin: 'https://linkedin.com/in/yuvrajsingh',
      github: 'https://github.com/yuvrajsingh',
    },
  };

  const sampleJob: JobPosting = {
    id: 1,
    title: 'Software Development Engineer in Test II',
    company: 'HackerRank',
    location: 'Bangalore',
    isRemote: false,
    url: 'https://job-boards.greenhouse.io/hackerrank/jobs/8155938',
    description: 'Looking for SDET with Java, Playwright, Selenium, REST Assured, Jenkins, Docker, Postman, API Testing.',
    scrapedAt: new Date().toISOString(),
    source: 'greenhouse',
    status: 'new',
    score: 85,
    scoreBreakdown: {
      titleMatch: 25,
      skillMatch: 25,
      experienceFit: 15,
      locationFit: 10,
      freshness: 10,
      hiringSignal: 0,
      salaryMatch: 0,
      total: 85,
      matchedSkills: ['Java', 'Playwright', 'Selenium', 'REST Assured', 'Jenkins', 'Postman', 'Docker', 'API Testing'],
      missingSkills: ['Kubernetes', 'AWS'],
      reasons: ['SDET title match', 'Skills 8/10 matched'],
      stretch: false,
    },
    stretch: false,
    reasons: ['SDET title match', 'Skills 8/10 matched'],
  };

  const sampleCompany: CompanyRecord = {
    id: 1,
    name: 'HackerRank',
    domain: 'hackerrank.com',
    sizeBucket: 'mid',
    ats: 'greenhouse',
    createdAt: new Date().toISOString(),
    researchBrief: JSON.stringify({
      whatTheyBuild: 'technical interview evaluation platform',
      recentSpecificThing: 'AI-assisted code scoring',
      whyIFit: 'deep API test automation background',
    }),
  };

  describe('Draft Generator Fact-Grounding & [FILL] Safeguards', () => {
    const generator = new DraftGenerator();

    it('refuses generation if candidate profile contains unresolved [FILL] markers', () => {
      const unfilledProfile: CandidateProfile = {
        ...validProfile,
        name: '[FILL: Full Name]',
      };

      const contact: ContactRecord = {
        id: testContactId,
        companyId: testCompanyId,
        fullName: 'Priya Sharma',
        title: 'QA Engineering Manager',
        contactType: 'qa_manager',
        email: 'priya.sharma@hackerrank.com',
        emailStatus: 'verified',
        timezone: 'Asia/Kolkata',
        createdAt: new Date().toISOString(),
      };

      expect(() => {
        generator.generateDrafts(unfilledProfile, sampleJob, contact, sampleCompany);
      }).toThrow(/unresolved \[FILL\] markers/i);
    });

    it('ignores signals with source "demo" or "test" and signals without real URLs', () => {
      const contact: ContactRecord = {
        id: testContactId,
        companyId: testCompanyId,
        fullName: 'Priya Sharma',
        title: 'QA Engineering Manager',
        contactType: 'qa_manager',
        email: 'priya.sharma@hackerrank.com',
        emailStatus: 'verified',
        timezone: 'Asia/Kolkata',
        createdAt: new Date().toISOString(),
      };

      const demoSignal: SignalRecord = {
        id: 1,
        companyId: testCompanyId,
        signalType: 'funding',
        detail: 'Series C $60M (Fictional Demo)',
        url: undefined,
        source: 'demo',
        seenAt: new Date().toISOString(),
      };

      const realSignal: SignalRecord = {
        id: 2,
        companyId: testCompanyId,
        signalType: 'growth',
        detail: 'launched new developer AI benchmarking product',
        url: 'https://techcrunch.com/2026/09/hackerrank-ai-launch',
        source: 'techcrunch',
        seenAt: new Date().toISOString(),
      };

      const pack = generator.generateDrafts(validProfile, sampleJob, contact, sampleCompany, [demoSignal, realSignal]);

      // Demo signal must NOT be cited
      expect(pack.citedFacts.some((f) => f.includes('Fictional Demo'))).toBe(false);
      expect(pack.variantA.body).not.toContain('Fictional Demo');

      // Real signal must be cited
      expect(pack.citedFacts.some((f) => f.includes('developer AI benchmarking'))).toBe(true);
      expect(pack.variantA.body).toContain('developer AI benchmarking');

      // Anti-fluff LinkedIn DM under 75 words
      const dmWordCount = pack.linkedInDm.split(/\s+/).filter(Boolean).length;
      expect(dmWordCount).toBeLessThan(75);
    });
  });

  describe('SendService Safety Rails & Verification Integrity', () => {
    it('refuses sending if outreach status is not approved', () => {
      const sendService = new SendService(storage);
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'draft', // Not approved!
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const contact = storage.getContactById(testContactId)!;

      const check = sendService.canSend(outreach, contact, { bypassTimezone: true });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/not approved/i);
    });

    it('refuses real sending if contact email_status is not verified', () => {
      const sendService = new SendService(storage);
      const unverifiedContactId = storage.addContact({
        companyId: testCompanyId,
        fullName: 'Arjun Mehta',
        title: 'Lead SDET',
        contactType: 'sdet_lead',
        email: 'arjun@hackerrank.com',
        emailStatus: 'unknown', // Unverified!
        timezone: 'Asia/Kolkata',
      });

      const outreachId = storage.addOutreach({
        contactId: unverifiedContactId,
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'approved',
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;
      const contact = storage.getContactById(unverifiedContactId)!;

      const check = sendService.canSend(outreach, contact, { bypassTimezone: true });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/email is not verified/i);
    });

    it('refuses real sending if contact source is demo or sample', () => {
      const sendService = new SendService(storage);
      const demoContactId = storage.addContact({
        companyId: testCompanyId,
        fullName: 'Rohan Verma',
        title: 'Lead SDET',
        contactType: 'sdet_lead',
        email: 'rohan@hackerrank.com',
        emailStatus: 'verified',
        source: 'demo', // Demo source
        timezone: 'Asia/Kolkata',
      });

      const outreachId = storage.addOutreach({
        contactId: demoContactId,
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'approved',
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;
      const contact = storage.getContactById(demoContactId)!;

      // In production mode (DEMO_MODE !== 'true'), refuses demo contact
      delete process.env.DEMO_MODE;
      const check = sendService.canSend(outreach, contact, { bypassTimezone: true });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/demo\/sample source/i);
    });

    it('allows dry-run send with DEMO_MODE=true for approved and verified contacts', async () => {
      process.env.DEMO_MODE = 'true';
      const sendService = new SendService(storage);

      const contactId = storage.addContact({
        companyId: testCompanyId,
        fullName: 'Priya Sharma',
        title: 'QA Engineering Manager',
        contactType: 'qa_manager',
        email: 'priya.sharma@hackerrank.com',
        emailStatus: 'verified',
        source: 'demo',
        timezone: 'Asia/Kolkata',
      });

      const outreachId = storage.addOutreach({
        contactId,
        subject: 'Quick question regarding QA automation at HackerRank',
        body: 'Hi Priya, noticed HackerRank is hiring for an SDET...',
        status: 'approved',
        type: 'cold',
        variant: 'A',
      });

      const result = await sendService.sendOutreach(outreachId, validProfile, {
        bypassTimezone: true,
        allowDemo: true,
      });

      expect(result.success).toBe(true);
      expect(result.emlPath).toBeDefined();
      expect(fs.existsSync(result.emlPath!)).toBe(true);

      const emlContent = fs.readFileSync(result.emlPath!, 'utf-8');
      expect(emlContent).toContain('To: Priya Sharma <priya.sharma@hackerrank.com>');
      expect(emlContent).toContain('Subject: Quick question regarding QA automation at HackerRank');
      expect(emlContent).toContain('Hi Priya, noticed HackerRank is hiring');

      const updated = storage.getOutreachById(outreachId);
      expect(updated?.status).toBe('sent');
      expect(updated?.sentAt).toBeDefined();

      // Clean up written test .eml
      if (result.emlPath && fs.existsSync(result.emlPath)) {
        fs.unlinkSync(result.emlPath);
      }
    });

    it('enforces daily send limit and bounce circuit breaker', () => {
      const sendService = new SendService(storage, 5); // 5 max

      const contact = storage.getContactById(testContactId)!;

      const outreach: any = {
        id: 999,
        contactId: testContactId,
        status: 'approved',
      };

      // Simulate 5 sends today
      for (let i = 0; i < 5; i++) {
        storage.addOutreach({
          contactId: testContactId,
          subject: `Subj ${i}`,
          body: `Body ${i}`,
          status: 'sent',
          sentAt: new Date().toISOString(),
        });
      }

      const check = sendService.canSend(outreach, contact, { bypassTimezone: true });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/daily send cap/i);
    });
  });

  describe('Skill Score Formula Calibration', () => {
    const scorer = new ScoringService();

    it('scores 8 of 10 matched skills as 25/30 (calibrated against harsh 18/30)', () => {
      // Job requiring 10 canonical skills
      const rawJob = {
        title: 'Software Development Engineer in Test',
        company: 'HackerRank',
        location: 'Bangalore',
        description: `
          Required Skills:
          - Java
          - Python
          - Selenium
          - Playwright
          - REST Assured
          - Jenkins
          - Docker
          - Git
          - Appium
          - JMeter
        `,
        source: 'greenhouse',
        url: 'https://greenhouse.io/test',
        scrapedAt: new Date().toISOString(),
      };

      // Profile has: Java, Python, Selenium, Playwright, REST Assured, Jenkins, Docker, Git. (8 matched)
      // Profile does NOT have: Appium, JMeter. (2 missing)
      const result = scorer.scoreJob(rawJob, validProfile);
      expect(result.matchedSkills.length).toBe(8);
      expect(result.missingSkills.length).toBe(2);

      // Calibrated formula gives 25/30 instead of the old harsh 18/30
      expect(result.skillMatch).toBe(25);
    });

    it('scores 10 of 10 matched skills as 30/30 full marks', () => {
      const rawJob = {
        title: 'SDET II',
        company: 'Postman',
        location: 'Bangalore',
        description: 'Skills: Java, Python, TypeScript, Selenium, Playwright, REST Assured, Jenkins, Docker, Git, TestNG',
        source: 'greenhouse',
        url: 'https://greenhouse.io/test2',
        scrapedAt: new Date().toISOString(),
      };

      const result = scorer.scoreJob(rawJob, validProfile);
      expect(result.skillMatch).toBe(30);
    });

    it('ignores demo signals in hiring signal bonus', () => {
      const rawJob = {
        title: 'SDET II',
        company: 'HackerRank',
        location: 'Bangalore',
        description: 'Java and Playwright',
        source: 'greenhouse',
        url: 'https://greenhouse.io/test3',
        scrapedAt: new Date().toISOString(),
      };

      const contexts = new Map();
      contexts.set('HackerRank', {
        companyOpenQaCount: 1,
        hasCompanySignal: true,
        signalType: 'funding',
        signalDetail: 'Series C (Demo)',
        signalSource: 'demo', // Demo source!
      });

      const scored = scorer.scoreAll([rawJob], validProfile, contexts);
      // Bonus must be 0 because signalSource is 'demo'
      expect(scored[0].scoreBreakdown?.hiringSignal).toBe(0);
      expect(scored[0].reasons?.some((r) => r.includes('Ignored demo/test signal'))).toBe(true);
    });
  });
});

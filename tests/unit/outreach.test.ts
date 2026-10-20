import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { StorageService } from '../../src/storage/database';
import { SendService } from '../../src/outreach/send-service';
import { DraftGenerator, lintOutreachDraft } from '../../src/outreach/draft-generator';
import { FollowUpService } from '../../src/outreach/follow-up-service';
import { ResumeTailor } from '../../src/outreach/resume-tailor';
import { ScoringService } from '../../src/scoring/scorer';
import {
  CandidateProfile,
  ContactRecord,
  JobPosting,
  CompanyRecord,
  SignalRecord,
} from '../../src/types';

describe('Phase 3 Outreach Engine, Safety Rails & Grounding Tests', () => {
  let storage: StorageService;
  let testCompanyId: number;
  let testContactId: number;
  const testDbPath = path.resolve(__dirname, '../fixtures/test-outreach.db');
  const cleanResumePath = path.resolve(__dirname, '../fixtures/clean-resume.md');

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
      'built automated regression suites scaling test coverage across services',
      'architected API test automation framework for backend microservices',
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
    description:
      'Looking for SDET with Java, Playwright, Selenium, REST Assured, Jenkins, Docker, Postman, API Testing.',
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
      matchedSkills: [
        'Java',
        'Playwright',
        'Selenium',
        'REST Assured',
        'Jenkins',
        'Postman',
        'Docker',
        'API Testing',
      ],
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

  // ─── 1. Send-Window Guard Tests ──────────────────────────────
  describe('Send-Window Guard (Item 1)', () => {
    it('blocks sending outside business hours (21:00 / 9 PM local time) in both real and dry-run modes', () => {
      const realService = new SendService(storage, 20, false); // Real mode
      const dryService = new SendService(storage, 20, true); // Dry-run mode

      const contact = storage.getContactById(testContactId)!; // timezone = 'Asia/Kolkata'
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Quick question regarding QA',
        body: 'Sample body',
        status: 'approved',
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      // 2026-10-14T15:30:00Z is 21:00 (9:00 PM) in Asia/Kolkata (outside 09:00 - 18:00)
      const afterHoursDate = new Date('2026-10-14T15:30:00Z');

      const realCheck = realService.canSend(outreach, contact, {
        now: afterHoursDate,
        profile: validProfile,
      });
      expect(realCheck.allowed).toBe(false);
      expect(realCheck.reason).toMatch(/Outside business hours/i);

      const dryCheck = dryService.canSend(outreach, contact, {
        now: afterHoursDate,
        profile: validProfile,
      });
      expect(dryCheck.allowed).toBe(false);
      expect(dryCheck.reason).toMatch(/Outside business hours/i);
    });

    it('blocks sending on weekends (Sunday) in both real and dry-run modes', () => {
      const realService = new SendService(storage, 20, false);
      const dryService = new SendService(storage, 20, true);

      const contact = storage.getContactById(testContactId)!;
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Quick question regarding QA',
        body: 'Sample body',
        status: 'approved',
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      // 2026-10-18T06:00:00Z is Sunday 11:30 AM in Asia/Kolkata
      const sundayDate = new Date('2026-10-18T06:00:00Z');

      const realCheck = realService.canSend(outreach, contact, {
        now: sundayDate,
        profile: validProfile,
      });
      expect(realCheck.allowed).toBe(false);
      expect(realCheck.reason).toMatch(/Outside business days \(Sun\)/i);

      const dryCheck = dryService.canSend(outreach, contact, {
        now: sundayDate,
        profile: validProfile,
      });
      expect(dryCheck.allowed).toBe(false);
      expect(dryCheck.reason).toMatch(/Outside business days \(Sun\)/i);
    });

    it('evaluates contact in America/New_York in its own timezone', () => {
      const realService = new SendService(storage, 20, false);
      const dryService = new SendService(storage, 20, true);
      const nyContactId = storage.addContact({
        companyId: testCompanyId,
        fullName: 'Emily Watson',
        title: 'Talent Partner',
        contactType: 'recruiter',
        email: 'emily@postman.com',
        emailStatus: 'verified',
        timezone: 'America/New_York',
      });
      const contact = storage.getContactById(nyContactId)!;

      const outreachId = storage.addOutreach({
        contactId: nyContactId,
        subject: 'Quick question',
        body: 'Hello Emily',
        status: 'approved',
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      // 10:00 UTC on a Wednesday: In NY (EDT, UTC-4), this is 06:00 AM (Outside 09:00 - 18:00)
      const nyEarlyMorning = new Date('2026-10-14T10:00:00Z');
      const earlyCheckReal = realService.canSend(outreach, contact, {
        now: nyEarlyMorning,
        profile: validProfile,
        baseResumePath: cleanResumePath,
      });
      expect(earlyCheckReal.allowed).toBe(false);
      expect(earlyCheckReal.reason).toMatch(/America\/New_York/);
      expect(earlyCheckReal.reason).toMatch(/06:00/);

      const earlyCheckDry = dryService.canSend(outreach, contact, {
        now: nyEarlyMorning,
        profile: validProfile,
      });
      expect(earlyCheckDry.allowed).toBe(false);
      expect(earlyCheckDry.reason).toMatch(/America\/New_York/);
      expect(earlyCheckDry.reason).toMatch(/06:00/);

      // 15:30 UTC on a Wednesday: In NY (EDT, UTC-4), this is 11:30 AM (Inside business hours!)
      const nyBusinessHours = new Date('2026-10-14T15:30:00Z');
      const validCheckReal = realService.canSend(outreach, contact, {
        now: nyBusinessHours,
        profile: validProfile,
        baseResumePath: cleanResumePath,
      });
      expect(validCheckReal.allowed).toBe(true);

      const validCheckDry = dryService.canSend(outreach, contact, {
        now: nyBusinessHours,
        profile: validProfile,
      });
      expect(validCheckDry.allowed).toBe(true);
    });
  });

  // ─── 2. Real-Mode [FILL] Marker Refusal (Item 2) ─────────────
  describe('Real Mode [FILL] Marker Guards (Item 2)', () => {
    const validSendTime = new Date('2026-10-14T05:30:00Z'); // Wednesday 11:00 AM IST

    it('refuses real send if candidate profile contains [FILL] markers', () => {
      const realService = new SendService(storage, 20, false); // Real mode
      const contact = storage.getContactById(testContactId)!;
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'approved',
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const fillProfile: CandidateProfile = {
        ...validProfile,
        name: '[FILL: Full Name]',
      };

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: fillProfile,
      });

      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/contains unresolved \[FILL\] markers/i);
    });

    it('refuses real send if sender (From) email contains [FILL] marker', () => {
      const realService = new SendService(storage, 20, false);
      const contact = storage.getContactById(testContactId)!;
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'approved',
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: validProfile,
        baseResumePath: cleanResumePath,
        fromAddress: '[FILL: user@email.com]',
      });

      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/sender \(From\) configuration/i);
    });

    it('allows dry-run send with a warning when profile has [FILL] markers', () => {
      const dryService = new SendService(storage, 20, true); // Dry-run mode
      const contact = storage.getContactById(testContactId)!;
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'approved',
        type: 'cold',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const fillProfile: CandidateProfile = {
        ...validProfile,
        name: '[FILL: Full Name]',
      };

      const check = dryService.canSend(outreach, contact, {
        now: validSendTime,
        profile: fillProfile,
      });

      // Dry run allows it so user can preview .eml structure
      expect(check.allowed).toBe(true);
    });
  });

  // ─── 3. Automated Lint Checks for Outreach Drafts (Item 4) ───
  describe('Automated Outreach Draft Linting & Rules (Item 4)', () => {
    const generator = new DraftGenerator();

    it('generated Variant A and Variant B pass all quality rules without warnings', () => {
      const contact = storage.getContactById(testContactId)!;
      const pack = generator.generateDrafts(validProfile, sampleJob, contact, sampleCompany);

      // Variant A checks
      expect(pack.variantA.lint.valid).toBe(true);
      expect(pack.variantA.lint.warnings).toHaveLength(0);
      expect(pack.variantA.lint.subjectWordCount).toBeLessThan(8);
      expect(pack.variantA.lint.wordCount).toBeGreaterThanOrEqual(80);
      expect(pack.variantA.lint.wordCount).toBeLessThanOrEqual(120);
      expect(pack.variantA.lint.hasFluff).toBe(false);
      expect(pack.variantA.lint.hasProofPoint).toBe(true);
      expect(pack.variantA.lint.hasSingleAsk).toBe(true);
      expect(pack.variantA.lint.hasOptOut).toBe(true);

      // Variant B checks
      expect(pack.variantB.lint.valid).toBe(true);
      expect(pack.variantB.lint.warnings).toHaveLength(0);
      expect(pack.variantB.lint.subjectWordCount).toBeLessThan(8);
      expect(pack.variantB.lint.wordCount).toBeGreaterThanOrEqual(80);
      expect(pack.variantB.lint.wordCount).toBeLessThanOrEqual(120);

      // LinkedIn DM under 75 words
      expect(pack.linkedInWordCount).toBeLessThan(75);
    });

    it('lint flags forbidden fluff phrases and long subjects', () => {
      const badSubject = 'Quick question about the open Software Development Engineer in Test role'; // 11 words (>= 8)
      const badBody = [
        'Hi Priya,',
        'I hope this email finds you well. I am writing to express my interest in your QA opening.',
        'I am a dynamic self-starter and team player who is passionate about creating synergy and hitting the ground running.',
        'Would you be open to a call? Or could you forward my resume to someone else?', // Multiple asks!
        'Thanks, Candidate',
      ].join('\n');

      const lint = lintOutreachDraft(badSubject, badBody);
      expect(lint.valid).toBe(false);
      expect(lint.hasFluff).toBe(true);
      expect(lint.fluffMatches.length).toBeGreaterThan(0);
      expect(lint.warnings.some((w) => w.includes('exceeds 7 words'))).toBe(true);
      expect(lint.warnings.some((w) => w.includes('under 80 words'))).toBe(true);
      expect(lint.warnings.some((w) => w.includes('Missing concrete proof point'))).toBe(true);
      expect(lint.warnings.some((w) => w.includes('Missing polite opt-out line'))).toBe(true);
    });

    it('accepts real-mode profile with real achievement containing 60% and generates drafts successfully', () => {
      const realProfileWith60: CandidateProfile = {
        ...validProfile,
        achievements: [
          'built automated regression suites reducing manual test cycles by 60%',
          'built hybrid automation framework scaling coverage across microservices',
        ],
      };

      const contact = storage.getContactById(testContactId)!;
      const pack = generator.generateDrafts(
        realProfileWith60,
        sampleJob,
        contact,
        sampleCompany,
        [],
        {
          allowFillForDemo: false,
        }
      );

      expect(pack.variantA.body).toContain(
        'built automated regression suites reducing manual test cycles by 60%'
      );
      expect(pack.variantA.lint.valid).toBe(true);
      expect(pack.variantB.lint.valid).toBe(true);
    });

    it('refuses real-mode drafts if achievements carry source="demo" or [FILL] placeholders', () => {
      const demoFlaggedProfile: CandidateProfile = {
        ...validProfile,
        achievements: [
          {
            text: 'built automated regression suites reducing manual test cycles by 60%',
            source: 'demo',
          },
        ],
      };

      const contact = storage.getContactById(testContactId)!;
      expect(() => {
        generator.generateDrafts(demoFlaggedProfile, sampleJob, contact, sampleCompany, [], {
          allowFillForDemo: false,
        });
      }).toThrow(/source="demo"/i);

      const fillProfile: CandidateProfile = {
        ...validProfile,
        achievements: ['[FILL: e.g. Designed and implemented REST Assured API test suite]'],
      };
      expect(() => {
        generator.generateDrafts(fillProfile, sampleJob, contact, sampleCompany, [], {
          allowFillForDemo: false,
        });
      }).toThrow(/placeholders or are flagged with source="demo"|unresolved \[FILL\] markers/);
    });

    it('flags unsupported company claims like focus on, known for, scalable, your platform when no signal/brief exists', () => {
      const draftWithClaim =
        "Hi Priya,\n\nI noticed the SDET role at HackerRank. Given HackerRank's focus on scalable platforms, I wanted to reach out. Over the past 2 years, I built automated test frameworks with Playwright and REST Assured. In my recent role, I scaled test coverage. Additionally, I architected api test automation framework for backend microservices.\n\nWould you be open to a brief 10-minute conversation next week to see if my testing background aligns with your team's needs?\n\nBest regards,\nCandidate\n\nP.S. If you're not the right person, no worries at all—please let me know and I won't follow up.";
      const lint = lintOutreachDraft('SDET test automation @ HackerRank', draftWithClaim, {
        hasSignal: false,
        hasBrief: false,
      });
      expect(lint.hasUnsupportedClaims).toBe(true);
      expect(lint.warnings.some((w) => w.includes('unsupported company claim'))).toBe(true);
    });

    it('generates drafts with zero company claims when neither signal nor brief exists, citing only role title', () => {
      const contact = storage.getContactById(testContactId)!;
      const emptyCompany: CompanyRecord = {
        ...sampleCompany,
        researchBrief: undefined,
      };
      const pack = generator.generateDrafts(validProfile, sampleJob, contact, emptyCompany, [], {
        allowFillForDemo: false,
      });

      expect(pack.variantA.body).not.toMatch(
        /focus on|known for|given HackerRank's|your platform|scalable|quality initiatives|engineering goals/i
      );
      expect(pack.variantB.body).not.toMatch(
        /focus on|known for|given HackerRank's|your platform|scalable|quality initiatives|engineering goals/i
      );
      expect(pack.variantA.body).not.toContain('I am writing regarding');
      expect(pack.variantB.body).not.toContain('I am writing regarding');
      expect(pack.variantB.body).not.toContain('I focus on building reliable CI test pipelines');
      expect(pack.variantB.body).not.toContain('next Tuesday');
      expect(pack.variantA.lint.valid).toBe(true);
      expect(pack.variantB.lint.valid).toBe(true);
    });

    it('uses profile fields verbatim in candidate sentences without generated purpose clauses', () => {
      const contact = storage.getContactById(testContactId)!;
      const pack = generator.generateDrafts(validProfile, sampleJob, contact, sampleCompany, [], {
        allowFillForDemo: false,
      });

      // Verbatim achievement inclusion
      expect(pack.variantA.body).toContain(
        'built automated regression suites scaling test coverage across services'
      );
      expect(pack.variantB.body).toContain(
        'built automated regression suites scaling test coverage across services'
      );

      // No added purpose clauses
      expect(pack.variantA.body).not.toContain('to prevent defects before production deployment');
      expect(pack.variantB.body).not.toContain('to accelerate testing feedback');
    });
  });

  // ─── 4. Resume Tailor Verification (Item 5) ──────────────────
  describe('Resume Tailor Verification (Item 5)', () => {
    const tailor = new ResumeTailor();

    it('cannot add skills or numbers not present in base resume', () => {
      const tailored = tailor.tailorResume('./config/base-resume.md', sampleJob, validProfile, {
        allowFillForDemo: true,
      });

      const baseContent = fs.readFileSync(path.resolve('./config/base-resume.md'), 'utf-8');

      // Check keyword gap reporting
      expect(tailored.missingKeywords).toBeDefined();
      expect(tailored.missingKeywords).toContain('Kubernetes');
      expect(tailored.missingKeywords).toContain('AWS');

      // The missing skills MUST NOT be inserted into the tailored markdown
      expect(tailored.tailoredMarkdown).not.toContain('Kubernetes');
      expect(tailored.tailoredMarkdown).not.toContain('AWS');

      // Every bullet line in the tailored output MUST exist in the base resume
      const tailoredLines = tailored.tailoredMarkdown
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- ') || l.startsWith('* '));
      const baseLines = baseContent.split(/\r?\n/).map((l) => l.trim());

      for (const bullet of tailoredLines) {
        expect(baseLines).toContain(bullet);
      }
    });

    it('computes keyword gap directly against base resume content (e.g. JD asks for TypeScript and Cucumber)', () => {
      const resumeFixturePath = path.resolve(
        __dirname,
        '../fixtures/resume-without-ts-cucumber.md'
      );
      fs.writeFileSync(
        resumeFixturePath,
        '# Test Candidate\n\n## Technical Skills\n- **Languages:** Java, Python\n- **Automation:** Selenium WebDriver, REST Assured\n',
        'utf-8'
      );

      try {
        const jdWithTsAndCucumber: JobPosting = {
          ...sampleJob,
          title: 'Senior SDET',
          description:
            'Looking for strong TypeScript and Cucumber (BDD) automation skills along with Selenium and REST Assured.',
          skills: ['TypeScript', 'Cucumber (BDD)', 'Selenium', 'REST Assured'],
        };

        const result = tailor.tailorResume(resumeFixturePath, jdWithTsAndCucumber, validProfile, {
          allowFillForDemo: true,
        });

        // Technical Skills section diff header
        expect(result.diffSummary).toContain('## Technical Skills');

        // Missing keywords (absent from base resume)
        expect(result.missingKeywords).toContain('TypeScript');
        expect(result.missingKeywords.some((k) => k.toLowerCase().includes('cucumber'))).toBe(true);

        // Matched keywords (present in base resume)
        expect(result.matchedKeywords).toContain('Selenium');
        expect(result.matchedKeywords).toContain('REST Assured');
      } finally {
        if (fs.existsSync(resumeFixturePath)) fs.unlinkSync(resumeFixturePath);
      }
    });

    it('blocks tailoring in real mode when base resume or profile has [FILL] markers', () => {
      expect(() => {
        tailor.tailorResume('./config/base-resume.md', sampleJob, validProfile, {
          allowFillForDemo: false,
        });
      }).toThrow(/unresolved \[FILL\] markers/);
    });

    it('does not report API Testing or CI/CD Integration as missing when resume has REST Assured/Postman and Jenkins/GitHub Actions', () => {
      const hackerRankJob: JobPosting = {
        ...sampleJob,
        title: 'Software Development Engineer in Test II',
        company: 'HackerRank',
        description:
          'Looking for SDET with Java, Playwright, Selenium, REST Assured, Jenkins, Docker, Postman, API Testing, and CI/CD pipelines.',
        skills: [
          'Java',
          'Playwright',
          'Selenium',
          'REST Assured',
          'Jenkins',
          'Postman',
          'Docker',
          'API Testing',
          'CI/CD Integration',
        ],
      };

      const result = tailor.tailorResume('./config/base-resume.md', hackerRankJob, validProfile, {
        allowFillForDemo: true,
      });

      // API Testing and CI/CD Integration must be matched via synonyms (REST Assured/Postman and Jenkins/GitHub Actions)
      expect(result.matchedKeywords).toContain('API Testing');
      expect(result.matchedKeywords).toContain('CI/CD Integration');
      expect(result.missingKeywords).not.toContain('API Testing');
      expect(result.missingKeywords).not.toContain('CI/CD Integration');
    });
  });

  // ─── 5. Follow-Up Cadence & Limits (Item 6) ──────────────────
  describe('Follow-Up Cadence & Limit Rules (Item 6)', () => {
    let followUpService: FollowUpService;

    beforeEach(() => {
      followUpService = new FollowUpService(storage, 2); // Cap = 2 emails max
    });

    it('creates a follow-up draft in "draft" status for a sent email 6 days old with no reply', () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

      const outreachId = storage.addOutreach({
        contactId: testContactId,
        type: 'cold',
        subject: 'SDET automation @ HackerRank',
        body: 'Initial cold email body',
        status: 'sent',
        sentAt: sixDaysAgo,
      });

      const evals = followUpService.checkAndCreateFollowUps(validProfile);
      expect(evals.length).toBe(1);
      expect(evals[0].eligible).toBe(true);
      expect(evals[0].createdFollowUpId).toBeDefined();

      const createdDraft = storage.getOutreachById(evals[0].createdFollowUpId!)!;
      expect(createdDraft.status).toBe('draft'); // Strictly awaiting human approval!
      expect(createdDraft.type).toBe('follow_up_1');
      expect(createdDraft.subject).toBe('Re: SDET automation @ HackerRank');
      expect(createdDraft.body).toContain('Following up briefly on my note below');
    });

    it('stops follow-up cadence if contact has already replied', () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'SDET role',
        body: 'Hello',
        status: 'sent',
        sentAt: sixDaysAgo,
      });

      // Simulate reply
      followUpService.recordReply(outreachId, 'positive');

      const evals = followUpService.checkAndCreateFollowUps(validProfile);
      const res = evals.find((e) => e.outreachId === outreachId);
      expect(res?.eligible).toBe(false);
      expect(res?.reason).toMatch(/Reply already received/i);
    });

    it('stops follow-up cadence if contact email is suppressed', () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      const contact = storage.getContactById(testContactId)!;

      storage.addOutreach({
        contactId: testContactId,
        subject: 'SDET role',
        body: 'Hello',
        status: 'sent',
        sentAt: sixDaysAgo,
      });

      // Add to suppression list
      storage.addToSuppressionList(contact.email!, 'unsubscribed');

      const evals = followUpService.checkAndCreateFollowUps(validProfile);
      expect(evals[0].eligible).toBe(false);
      expect(evals[0].reason).toMatch(/suppression list/i);
    });

    it('enforces maximum cap of 2 emails per contact', () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

      // Email 1: cold email (sent)
      storage.addOutreach({
        contactId: testContactId,
        subject: 'Cold Email',
        body: 'Body 1',
        status: 'sent',
        sentAt: sixDaysAgo,
      });

      // Email 2: already created follow-up (draft or sent)
      storage.addOutreach({
        contactId: testContactId,
        subject: 'Re: Cold Email',
        body: 'Follow up body',
        status: 'draft',
      });

      // Total emails for this contact = 2. A 3rd should be refused!
      const evals = followUpService.checkAndCreateFollowUps(validProfile);
      expect(evals[0].eligible).toBe(false);
      expect(evals[0].reason).toMatch(/Maximum outreach cap reached/i);
    });
  });

  // ─── 6. Real-Mode Refusal Test Suite (Item 8) ────────────────
  describe('Real-Mode Refusal Comprehensive Suite (Item 8)', () => {
    const validSendTime = new Date('2026-10-14T05:30:00Z'); // Wednesday 11:00 AM IST

    it('1. Refuses send if outreach is unapproved (status = draft)', () => {
      const realService = new SendService(storage, 20, false);
      const contact = storage.getContactById(testContactId)!;
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Test',
        body: 'Body',
        status: 'draft',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: validProfile,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/not approved/i);
    });

    it('2. Refuses send if contact email is unverified', () => {
      const realService = new SendService(storage, 20, false);
      const unverifiedContactId = storage.addContact({
        companyId: testCompanyId,
        fullName: 'Arjun Mehta',
        title: 'Lead SDET',
        contactType: 'sdet_lead',
        email: 'arjun@hackerrank.com',
        emailStatus: 'unknown', // Unverified!
        timezone: 'Asia/Kolkata',
      });
      const contact = storage.getContactById(unverifiedContactId)!;
      const outreachId = storage.addOutreach({
        contactId: unverifiedContactId,
        subject: 'Test',
        body: 'Body',
        status: 'approved',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: validProfile,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/email is not verified/i);
    });

    it('3. Refuses real send if contact source is demo or sample', () => {
      const realService = new SendService(storage, 20, false);
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
      const contact = storage.getContactById(demoContactId)!;
      const outreachId = storage.addOutreach({
        contactId: demoContactId,
        subject: 'Test',
        body: 'Body',
        status: 'approved',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: validProfile,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/demo\/sample source/i);
    });

    it('4. Refuses send if recipient email is suppressed', () => {
      const realService = new SendService(storage, 20, false);
      const contact = storage.getContactById(testContactId)!;
      storage.addToSuppressionList(contact.email!, 'opted-out');

      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Test',
        body: 'Body',
        status: 'approved',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: validProfile,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/suppression list/i);
    });

    it('5. Refuses send if daily send cap is reached', () => {
      const realService = new SendService(storage, 3, false); // Cap = 3
      const contact = storage.getContactById(testContactId)!;

      for (let i = 0; i < 3; i++) {
        storage.addOutreach({
          contactId: testContactId,
          subject: `Sent ${i}`,
          body: `Body ${i}`,
          status: 'sent',
          sentAt: new Date().toISOString(),
        });
      }

      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Pending',
        body: 'Body',
        status: 'approved',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: validProfile,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/Daily send cap/i);
    });

    it('6. Refuses send if bounce circuit breaker is triggered (>10%)', () => {
      const realService = new SendService(storage, 50, false);
      const contact = storage.getContactById(testContactId)!;

      // Simulate 10 sends with 2 bounces (20% bounce rate > 10%)
      for (let i = 0; i < 8; i++) {
        storage.addOutreach({
          contactId: testContactId,
          subject: `Good ${i}`,
          body: 'body',
          status: 'sent',
          sentAt: new Date().toISOString(),
        });
      }
      for (let i = 0; i < 2; i++) {
        storage.addOutreach({
          contactId: testContactId,
          subject: `Bounced ${i}`,
          body: 'body',
          status: 'bounced',
          sentAt: new Date().toISOString(),
        });
      }

      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Pending',
        body: 'Body',
        status: 'approved',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: validProfile,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/Bounce circuit breaker triggered/i);
    });

    it('7. Refuses send if recipient is outside business hours', () => {
      const realService = new SendService(storage, 20, false);
      const contact = storage.getContactById(testContactId)!;
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Pending',
        body: 'Body',
        status: 'approved',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      // 22:00 in Asia/Kolkata
      const lateNight = new Date('2026-10-14T16:30:00Z');
      const check = realService.canSend(outreach, contact, {
        now: lateNight,
        profile: validProfile,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/Outside business hours/i);
    });

    it('8. Refuses real send if unresolved [FILL] markers exist', () => {
      const realService = new SendService(storage, 20, false);
      const contact = storage.getContactById(testContactId)!;
      const outreachId = storage.addOutreach({
        contactId: testContactId,
        subject: 'Pending',
        body: 'Body',
        status: 'approved',
      });
      const outreach = storage.getOutreachById(outreachId)!;

      const fillProfile: CandidateProfile = {
        ...validProfile,
        name: '[FILL: Full Name]',
      };

      const check = realService.canSend(outreach, contact, {
        now: validSendTime,
        profile: fillProfile,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/contains unresolved \[FILL\] markers/i);
    });
  });

  // ─── 7. Scoring Engine Calibration Verification ──────────────
  describe('Skill Score Formula Calibration', () => {
    const scorer = new ScoringService();

    it('scores 8 of 10 matched skills as 25/30', () => {
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

      const result = scorer.scoreJob(rawJob, validProfile);
      expect(result.matchedSkills.length).toBe(8);
      expect(result.missingSkills.length).toBe(2);
      expect(result.skillMatch).toBe(25);
    });

    it('scores 10 of 10 matched skills as 30/30 full marks', () => {
      const rawJob = {
        title: 'SDET II',
        company: 'Postman',
        location: 'Bangalore',
        description:
          'Skills: Java, Python, TypeScript, Selenium, Playwright, REST Assured, Jenkins, Docker, Git, TestNG',
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
        signalSource: 'demo',
      });

      const scored = scorer.scoreAll([rawJob], validProfile, contexts);
      expect(scored[0].scoreBreakdown?.hiringSignal).toBe(0);
      expect(scored[0].reasons?.some((r) => r.includes('Ignored demo/test signal'))).toBe(true);
    });
  });
});

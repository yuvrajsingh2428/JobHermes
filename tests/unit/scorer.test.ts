// ============================================================
// Unit Tests – 100-Point SDET Scoring Engine
// ============================================================

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { scoringService } from '../../src/scoring/scorer';
import { CandidateProfile, RawJob } from '../../src/types';
import { StorageService } from '../../src/storage/database';
import { rescoreAllJobs } from '../../src/scoring/rescore';

const mockProfile: CandidateProfile = {
  name: 'Test SDET Candidate',
  title: 'SDET / QA Automation Engineer',
  email: 'sdet@example.com',
  phone: '+91-9999999999',
  location: 'Delhi NCR, India',
  summary: 'SDET with 2 years of experience',
  targetRoles: ['SDET', 'QA Automation Engineer', 'Test Automation Engineer', 'Software Engineer in Test'],
  experienceYears: 2,
  minExperienceYears: 1,
  maxExperienceYears: 3,
  skills: {
    languages: ['Java', 'Python', 'SQL'],
    automationTools: ['Selenium', 'Playwright', 'REST Assured', 'Postman', 'Cypress'],
    frameworks: ['TestNG', 'JUnit', 'Cucumber (BDD)'],
    devopsAndCiCd: ['Jenkins', 'Git', 'Docker'],
    databases: ['PostgreSQL', 'MySQL'],
    methodologies: ['API Testing', 'Framework Design', 'CI/CD Integration'],
  },
  preferredLocations: ['Delhi NCR', 'Gurgaon', 'Noida', 'Delhi', 'Bangalore', 'Remote'],
  openToRemote: true,
  minSalaryLPA: 15,
  noticePeriodDays: 30,
  achievements: ['Built test framework'],
};

describe('SDET Scorer Unit Tests', () => {
  it('awards high score (80+) to ideal SDET role matching stack, location, and 1-3 YOE', () => {
    const job: RawJob = {
      title: 'Software Engineer in Test (SDET)',
      company: 'HighGrowth Tech',
      location: 'Gurgaon, India',
      isRemote: false,
      url: 'https://example.com/job/1',
      description: `
        We are looking for an SDET with 1-3 years of experience.
        Requirements:
        - Strong Core Java and Selenium WebDriver skills
        - Experience designing frameworks with TestNG and REST Assured
        - Knowledge of Jenkins, CI/CD integration, and Git
      `,
      postedAt: new Date().toISOString(), // fresh today
      source: 'greenhouse',
      rawSalary: '18-24 LPA',
    };

    const breakdown = scoringService.scoreJob(job, mockProfile, { companyOpenQaCount: 2 });

    expect(breakdown.titleMatch).toBe(25);
    expect(breakdown.locationFit).toBe(10);
    expect(breakdown.freshness).toBe(10);
    expect(breakdown.hiringSignal).toBe(10);
    expect(breakdown.experienceFit).toBe(15);
    expect(breakdown.stretch).toBe(false);
    expect(breakdown.total).toBeGreaterThanOrEqual(85);
    expect(breakdown.matchedSkills).toContain('Selenium');
    expect(breakdown.matchedSkills).toContain('TestNG');
    expect(breakdown.matchedSkills).toContain('REST Assured');
  });

  it('rejects manual-only QA roles (title score = 0)', () => {
    const job: RawJob = {
      title: 'Manual Tester / QA Manual Testing',
      company: 'ServiceCo',
      location: 'Noida, India',
      isRemote: false,
      url: 'https://example.com/job/manual',
      description: 'Execute manual test cases and document defects in JIRA.',
      source: 'lever',
    };

    const breakdown = scoringService.scoreJob(job, mockProfile);
    expect(breakdown.titleMatch).toBe(0);
    expect(breakdown.total).toBeLessThan(40);
  });

  it('handles skill synonyms correctly (e.g. "Rest-Assured" & "CI/CD")', () => {
    const job: RawJob = {
      title: 'QA Automation Engineer',
      company: 'Fintech Co',
      location: 'Bangalore',
      isRemote: false,
      url: 'https://example.com/job/synonym',
      description: 'Must know Rest-Assured for API testing, CI/CD pipelines, and Playwright.',
      source: 'greenhouse',
    };

    const breakdown = scoringService.scoreJob(job, mockProfile);
    expect(breakdown.matchedSkills).toContain('REST Assured');
    expect(breakdown.matchedSkills).toContain('CI/CD Integration');
    expect(breakdown.matchedSkills).toContain('Playwright');
  });

  it('flags 4-6 YOE positions as stretch instead of rejecting outright', () => {
    const job: RawJob = {
      title: 'Senior SDET',
      company: 'ScaleCo',
      location: 'Remote India',
      isRemote: true,
      url: 'https://example.com/job/senior',
      description: 'Requires 4-6 years of experience building automation frameworks.',
      source: 'ashby',
    };

    const breakdown = scoringService.scoreJob(job, mockProfile);
    expect(breakdown.stretch).toBe(true);
    expect(breakdown.experienceFit).toBe(9); // partial marks for stretch
  });

  it('handles unstated experience requirements gracefully without penalizing to zero', () => {
    const job: RawJob = {
      title: 'Test Automation Engineer',
      company: 'StartupX',
      location: 'Delhi',
      isRemote: false,
      url: 'https://example.com/job/unstated-exp',
      description: 'Join our team to automate web apps using Selenium and Java.',
      source: 'workable',
    };

    const breakdown = scoringService.scoreJob(job, mockProfile);
    expect(breakdown.experienceFit).toBe(10);
    expect(breakdown.stretch).toBe(false);
  });

  it('changes score when a company signal is deleted followed by rescore', () => {
    const testDbPath = path.resolve(__dirname, '../fixtures/test-rescore.db');
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    const storage = new StorageService(testDbPath);

    const companyId = storage.upsertCompany({
      name: 'RescoreTech',
      domain: 'rescoretech.io',
      sizeBucket: 'mid',
      ats: 'greenhouse',
    });

    const signalId = storage.addSignal({
      companyId,
      signalType: 'funding',
      detail: 'Series B $30M',
      url: 'https://news.com/rescoretech-series-b',
      source: 'news',
    });

    storage.upsertJob({
      title: 'SDET Automation Engineer',
      company: 'RescoreTech',
      location: 'Delhi NCR',
      isRemote: true,
      url: 'https://rescoretech.io/jobs/sdet',
      description: 'Java, Selenium, TestNG, REST Assured, Jenkins with 2 years experience',
      source: 'greenhouse',
      scrapedAt: new Date().toISOString(),
      postedAt: new Date().toISOString(),
    });

    // Initial rescore with signal present
    const res1 = rescoreAllJobs(storage, mockProfile);
    expect(res1[0].newScore).toBeGreaterThanOrEqual(80);
    expect(res1[0].breakdown.hiringSignal).toBe(10);
    const scoreWithSignal = res1[0].newScore;

    // Delete signal
    storage.deleteSignal(signalId);

    // Rescore again
    const res2 = rescoreAllJobs(storage, mockProfile);
    expect(res2[0].breakdown.hiringSignal).toBe(0);
    expect(res2[0].newScore).toBe(scoreWithSignal - 10);

    storage.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('marks job status as closed after 2 consecutive missed scans and excludes from top jobs', () => {
    const testDbPath = path.resolve(__dirname, '../fixtures/test-stale-job.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    const storage = new StorageService(testDbPath);
    const jobId = storage.upsertJob({
      title: 'Senior SDET',
      company: 'HackerRank',
      location: 'Remote',
      isRemote: true,
      url: 'https://job-boards.greenhouse.io/hackerrank/jobs/8155938',
      description: 'Playwright, TypeScript, CI/CD',
      source: 'greenhouse',
      scrapedAt: new Date().toISOString(),
      score: 82,
      status: 'new',
      isApplied: false,
    });

    // Verify initial active state in top jobs
    let topJobs = storage.getTopJobs(10);
    expect(topJobs.some((j) => j.id === jobId)).toBe(true);

    // Scan 1: job is absent from newly scraped URLs for HackerRank
    const seenUrlsScan1 = new Set<string>(['https://job-boards.greenhouse.io/hackerrank/jobs/9999999']);
    const sighting1 = storage.recordJobSightings('HackerRank', seenUrlsScan1);
    expect(sighting1.newlyClosed.length).toBe(0);

    let jobState1 = storage.getJobById(jobId);
    expect(jobState1?.status).toBe('new');
    expect(jobState1?.consecutiveMissedScans).toBe(1);
    expect(storage.getTopJobs(10).some((j) => j.id === jobId)).toBe(true);

    // Scan 2: job is absent again for second consecutive scan
    const seenUrlsScan2 = new Set<string>(['https://job-boards.greenhouse.io/hackerrank/jobs/9999999']);
    const sighting2 = storage.recordJobSightings('HackerRank', seenUrlsScan2);
    expect(sighting2.newlyClosed).toContain(jobId);

    let jobState2 = storage.getJobById(jobId);
    expect(jobState2?.status).toBe('closed');
    expect(jobState2?.consecutiveMissedScans).toBe(2);

    // Excluded from top jobs
    topJobs = storage.getTopJobs(10);
    expect(topJobs.some((j) => j.id === jobId)).toBe(false);

    // Excluded from default getAllJobs()
    const activeJobs = storage.getAllJobs();
    expect(activeJobs.some((j) => j.id === jobId)).toBe(false);

    storage.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });
});

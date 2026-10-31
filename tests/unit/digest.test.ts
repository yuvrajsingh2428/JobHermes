import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { StorageService } from '../../src/storage/database';
import { generateDailyDigest, formatDailyDigestText } from '../../src/utils/digest';

describe('Daily Digest Generator & Formatter', () => {
  const testDbPath = path.resolve(__dirname, '../fixtures/test-digest.db');
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
    try {
      storage.close();
    } catch {
      // Ignore
    }
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {
        // Ignore
      }
    }
  });

  it('generates an empty digest with initial action item when database is empty', () => {
    const digest = generateDailyDigest(storage, { isDemo: true });

    expect(digest.mode).toBe('demo');
    expect(digest.jobs.totalTracked).toBe(0);
    expect(digest.jobs.topQualified).toBe(0);
    expect(digest.jobs.nearMisses).toBe(0);
    expect(digest.contacts.total).toBe(0);
    expect(digest.outreach.pendingApproval).toBe(0);
    expect(digest.outreach.followUpsDue).toBe(0);
    expect(digest.actionItems).toContain(
      'Run initial job scan across configured target companies ("npm run scan")'
    );

    const text = formatDailyDigestText(digest);
    expect(text).toContain('JobHermes SDET Copilot Daily Digest [DEMO SANDBOX]');
    expect(text).toContain('Total Tracked: 0');
    expect(text).toContain('Recommended Actions:');
    expect(text).toContain('Run initial job scan');
  });

  const mockBreakdown = (score: number) => ({
    titleMatch: score > 60 ? 25 : 10,
    skillMatch: score > 60 ? 30 : 15,
    experienceFit: 15,
    locationFit: 10,
    freshness: 10,
    hiringSignal: 5,
    salaryMatch: 5,
    total: score,
    reasons: ['Match'],
    matchedSkills: ['Automation'],
    missingSkills: [],
    stretch: false,
  });

  it('accurately categorizes jobs by match score and active status', () => {
    storage.upsertJob({
      title: 'Lead SDET',
      company: 'Postman',
      url: 'https://postman.com/jobs/1',
      description: 'SDET role',
      source: 'greenhouse',
      location: 'Bangalore',
      isRemote: false,
      scrapedAt: new Date().toISOString(),
      status: 'new',
      isApplied: false,
    });
    storage.upsertJob({
      title: 'QA Automation Engineer',
      company: 'Razorpay',
      url: 'https://razorpay.com/jobs/2',
      description: 'Automation role',
      source: 'lever',
      location: 'Remote',
      isRemote: true,
      scrapedAt: new Date().toISOString(),
      status: 'new',
      isApplied: false,
    });
    storage.upsertJob({
      title: 'Manual Tester',
      company: 'LegacyCorp',
      url: 'https://legacy.com/jobs/3',
      description: 'Manual testing',
      source: 'ashby',
      location: 'Mumbai',
      isRemote: false,
      scrapedAt: new Date().toISOString(),
      status: 'new',
      isApplied: false,
    });

    const allJobs = storage.getAllJobs();
    const sdetJob = allJobs.find((j) => j.company === 'Postman')!;
    const nearMissJob = allJobs.find((j) => j.company === 'Razorpay')!;
    const closedJob = allJobs.find((j) => j.company === 'LegacyCorp')!;

    storage.updateJobScore(sdetJob.id!, 85, mockBreakdown(85));
    storage.updateJobScore(nearMissJob.id!, 50, mockBreakdown(50));
    storage.updateJobScore(closedJob.id!, 30, mockBreakdown(30));
    storage.updateJobStatus(closedJob.id!, 'closed');

    const digest = generateDailyDigest(storage, { isDemo: false });

    expect(digest.mode).toBe('live');
    expect(digest.jobs.totalTracked).toBe(3);
    expect(digest.jobs.topQualified).toBe(1);
    expect(digest.jobs.nearMisses).toBe(1);
    expect(digest.jobs.closed).toBe(1);
    expect(digest.jobs.topOpportunities).toHaveLength(2);
    expect(digest.jobs.topOpportunities[0].company).toBe('Postman');
    expect(digest.jobs.topOpportunities[0].score).toBe(85);

    const text = formatDailyDigestText(digest);
    expect(text).toContain('[LIVE]');
    expect(text).toContain('Top SDET Qualified (≥60): 1');
    expect(text).toContain('Near Misses (40–59): 1');
    expect(text).toContain('Closed / Stale: 1');
    expect(text).toContain('Lead SDET @ Postman (Score: 85) - Bangalore');
  });

  it('aggregates contacts verification statuses correctly', () => {
    const compId = storage.upsertCompany({
      name: 'Postman',
      domain: 'postman.com',
      ats: 'greenhouse',
      slug: 'postman',
      sizeBucket: 'mid',
    });

    storage.addContact({
      companyId: compId,
      fullName: 'Priya Sharma',
      title: 'QA Director',
      contactType: 'qa_manager',
      email: 'priya@postman.com',
      emailStatus: 'verified',
    });

    storage.addContact({
      companyId: compId,
      fullName: 'Rahul Verma',
      title: 'Engineering Manager',
      contactType: 'eng_manager',
      email: 'rahul@postman.com',
      emailStatus: 'unknown',
    });

    const digest = generateDailyDigest(storage);
    expect(digest.contacts.total).toBe(2);
    expect(digest.contacts.verified).toBe(1);
    expect(digest.contacts.pendingVerification).toBe(1);

    const text = formatDailyDigestText(digest);
    expect(text).toContain('Total Discovered: 2');
    expect(text).toContain('Verified: 1');
    expect(text).toContain('Pending Verification: 1');
  });

  it('tracks outreach drafts, replies, bounces, and calculates due follow-ups', () => {
    const compId = storage.upsertCompany({
      name: 'Postman',
      domain: 'postman.com',
      ats: 'greenhouse',
      slug: 'postman',
      sizeBucket: 'mid',
    });

    const c1 = storage.addContact({
      companyId: compId,
      fullName: 'Alice Smith',
      title: 'Recruiter',
      contactType: 'recruiter',
      email: 'alice@postman.com',
      emailStatus: 'verified',
    });
    const c2 = storage.addContact({
      companyId: compId,
      fullName: 'Bob Jones',
      title: 'Tech Lead',
      contactType: 'sdet_lead',
      email: 'bob@postman.com',
      emailStatus: 'verified',
    });
    const c3 = storage.addContact({
      companyId: compId,
      fullName: 'Carol White',
      title: 'VP QA',
      contactType: 'qa_manager',
      email: 'carol@postman.com',
      emailStatus: 'verified',
    });

    const testJobId = storage.upsertJob({
      title: 'Senior SDET',
      company: 'Postman',
      url: 'https://postman.com/jobs/sdet-99',
      description: 'SDET role',
      source: 'greenhouse',
      location: 'Bangalore',
      isRemote: false,
      scrapedAt: new Date().toISOString(),
      status: 'new',
      isApplied: false,
    });

    // 1. Pending draft
    storage.addOutreach({
      jobId: testJobId,
      contactId: c1,
      type: 'cold',
      variant: 'A',
      subject: 'SDET Opportunity',
      body: 'Hi Alice...',
      status: 'draft',
      outcome: 'none',
    });

    // 2. Sent 7 days ago (follow-up is DUE)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    storage.addOutreach({
      jobId: testJobId,
      contactId: c2,
      type: 'cold',
      variant: 'B',
      subject: 'Follow-up query',
      body: 'Hi Bob...',
      status: 'sent',
      sentAt: sevenDaysAgo,
      outcome: 'none',
    });

    // 3. Sent 1 day ago (not due yet)
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    storage.addOutreach({
      jobId: testJobId,
      contactId: c3,
      type: 'cold',
      variant: 'A',
      subject: 'Intro',
      body: 'Hi Carol...',
      status: 'sent',
      sentAt: oneDayAgo,
      outcome: 'none',
    });

    const digest = generateDailyDigest(storage, { now: new Date(), followUpMinDays: 5 });

    expect(digest.outreach.pendingApproval).toBe(1);
    expect(digest.outreach.followUpsDue).toBe(1);
    expect(digest.actionItems).toContain(
      'Review and approve 1 pending outreach draft ("npm run outreach list")'
    );
    expect(digest.actionItems).toContain(
      'Process 1 follow-up due for sent outreach ("npm run outreach followups")'
    );

    const text = formatDailyDigestText(digest);
    expect(text).toContain('Pending Approvals: 1 drafts awaiting review');
    expect(text).toContain('Follow-ups Due: 1');
  });
});

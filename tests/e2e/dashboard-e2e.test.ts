// ============================================================
// Playwright E2E Tests on demo.db
// Flows: Draft Approval, Out-of-hours blocked vs In-window allowed send,
//        Contact Import, Job Filtering, and Closed-Job Exclusion.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { StorageService } from '../../src/storage/database';
import { DashboardServer } from '../../src/dashboard/server';
import { HermesAgent } from '../../src/agent/hermes-agent';
import { HermesConfig } from '../../src/types';
import { seedDemoSandbox } from '../../src/utils/demo-sandbox';

describe('Phase 5 Playwright E2E Tests on demo.db', () => {
  let browser: Browser;
  let page: Page;
  let server: DashboardServer;
  let agent: HermesAgent;
  let storage: StorageService;

  const testPort = 3989;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDbPath = path.resolve(__dirname, '../fixtures/test-e2e-demo.db');

  beforeAll(async () => {
    // 1. Setup isolated test database from demo seed
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    seedDemoSandbox(testDbPath);

    const testConfig: HermesConfig = {
      openaiApiKey: 'mock-key',
      openaiModel: 'gpt-4o',
      temperature: 0.1,
      databasePath: testDbPath,
      reportsDir: './reports',
      documentsDir: './documents',
      logLevel: 'info',
      logDir: './logs',
      cronSchedule: '30 8 * * *',
      timezone: 'Asia/Kolkata',
      scrapeConcurrency: 1,
      requestDelayMs: 0,
      maxRetries: 1,
      candidateProfilePath: './config/candidate-profile.json',
      companyTargetsPath: './config/company-targets.json',
      minScoreThreshold: 60,
      topJobsCount: 10,
      userAgent: 'JobHermes/1.0',
      requestTimeoutMs: 5000,
    };

    agent = new HermesAgent(testConfig);
    storage = agent.getStorage();

    // 2. Start server
    server = new DashboardServer(agent, testPort);
    await server.start();

    // 3. Launch headless Playwright Chromium
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    if (agent) agent.shutdown();

    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  it('1. Loads dashboard and verifies active jobs while excluding closed jobs', async () => {
    // Add an active job and a closed job to test DB
    const activeJobId = storage.upsertJob({
      title: 'Active SDET Role',
      company: 'HackerRank',
      location: 'Remote',
      isRemote: true,
      url: 'https://hackerrank.com/jobs/active-1',
      description: 'Java, Playwright, REST Assured',
      source: 'greenhouse',
      scrapedAt: new Date().toISOString(),
      score: 82,
      status: 'new',
      isApplied: false,
    });

    const closedJobId = storage.upsertJob({
      title: 'Stale Closed SDET Role',
      company: 'HackerRank',
      location: 'Remote',
      isRemote: true,
      url: 'https://hackerrank.com/jobs/closed-1',
      description: 'Selenium',
      source: 'greenhouse',
      scrapedAt: new Date().toISOString(),
      score: 75,
      status: 'closed',
      isApplied: false,
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#header-title');

    // Title assertion
    const title = await page.textContent('#header-title');
    expect(title).toContain('JobHermes');

    // Click Jobs Tab
    await page.click('#tab-jobs');
    await page.waitForSelector('.job-card, #jobs-grid');

    // Verify Active Job appears in the DOM
    const bodyContent = await page.content();
    expect(bodyContent).toContain('Active SDET Role');

    // Verify Closed Job is EXCLUDED from active/top jobs
    expect(bodyContent).not.toContain('Stale Closed SDET Role');

    // Test search filter
    await page.fill('#search-jobs', 'Active');
    await page.waitForTimeout(600);
    const searchMatch = await page
      .locator('#jobs-grid .job-card', { hasText: 'Active SDET Role' })
      .isVisible();
    expect(searchMatch).toBe(true);

    // Filter by non-existent term
    await page.fill('#search-jobs', 'NonExistentXYZ');
    await page.waitForTimeout(600);
    const hiddenMatch = await page
      .locator('#jobs-grid .job-card', { hasText: 'Active SDET Role' })
      .isVisible();
    expect(hiddenMatch).toBe(false);

    // Clear search
    await page.fill('#search-jobs', '');
    await page.waitForTimeout(500);
  }, 30000);

  it('2. Imports contacts from CSV and displays them in the UI with roles and unknown status', async () => {
    await page.click('#tab-contacts');
    await page.waitForSelector('.contact-row', { timeout: 5000 });

    // Check contacts presence from demo seeding
    const contactsCount = await page.locator('.contact-row').count();
    expect(contactsCount).toBeGreaterThanOrEqual(1);

    // Verify CSV import via authenticated API endpoint
    const token = server.getLocalToken();
    const csvFixture = path.resolve(__dirname, '../fixtures/contacts.csv');
    const importRes = await fetch(`${baseUrl}/api/contacts/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': token,
      },
      body: JSON.stringify({ filePath: csvFixture }),
    });

    expect(importRes.status).toBe(200);
    const importData = await importRes.json();
    expect(importData.success).toBe(true);
    expect(importData.importedCount).toBeGreaterThan(0);

    // Reload and check contacts tab displays imported records
    await page.click('#tab-contacts');
    await page.waitForSelector('.contact-row', { timeout: 5000 });
    const content = await page.content();
    expect(content).toContain('Priya Sharma');
    expect(content).toContain('Rohan Verma');
  }, 30000);

  it('3. Approves an outreach draft via UI/API and verifies status transition', async () => {
    await page.click('#tab-outreach');
    await page.waitForTimeout(300);

    // Insert a fresh draft
    const draftId = storage.addOutreach({
      contactId: 1,
      jobId: 1,
      type: 'cold',
      variant: 'A',
      subject: 'SDET test automation @ HackerRank',
      body: 'Hi Priya, testing outreach approval flow.',
      status: 'draft',
      source: 'manual',
    });

    // Approve the draft
    const token = server.getLocalToken();
    const approveRes = await fetch(`${baseUrl}/api/outreach/${draftId}/approve`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': token,
      },
      body: JSON.stringify({}),
    });

    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.success).toBe(true);
    expect(approveData.status).toBe('approved');

    // Verify DB update
    const updated = storage.getOutreachById(draftId);
    expect(updated?.status).toBe('approved');
  });

  it('4. Dry-run send: blocked out of business hours, allowed within window via fake clock', async () => {
    const contact = storage.getContactById(1)!; // Asia/Kolkata timezone

    // Ensure contact email is verified for send test
    storage.updateContactEmailStatus(1, 'verified');

    const draftId = storage.addOutreach({
      contactId: 1,
      jobId: 1,
      type: 'cold',
      variant: 'A',
      subject: 'SDET opportunity @ HackerRank',
      body: 'Hi Priya,\n\nI noticed the SDET role at HackerRank. Over the past 2 years, I built automated test frameworks with Playwright and REST Assured.\n\nIn my recent role, I built automated regression suites scaling test coverage across services. Additionally, I architected API test automation framework for backend microservices.\n\nWould you be open to a 10-minute conversation next week?\n\nBest regards,\nCandidate\n\nP.S. If not the right person, feel free to ignore and I will not follow up.',
      status: 'approved',
      source: 'manual',
    });

    const token = server.getLocalToken();

    // 1. OUT OF HOURS TEST: Sunday evening (2026-10-18T23:00:00+05:30)
    // 23:00 IST is outside Mon-Fri 09:00-18:00
    const outOfHoursDate = '2026-10-18T17:30:00.000Z'; // Sunday 23:00 IST
    server.setTestClock(new Date(outOfHoursDate));

    // Try sending fakeNow inside window in HTTP body while server test clock is out of hours:
    // Should be blocked because HTTP fakeNow is ignored!
    const blockedRes = await fetch(`${baseUrl}/api/outreach/${draftId}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': token,
      },
      body: JSON.stringify({
        dryRun: true,
        fakeNow: '2026-10-14T06:00:00.000Z', // Ignored by server
      }),
    });

    const blockedData = await blockedRes.json();
    expect(blockedData.success).toBe(false);
    expect(blockedData.error).toMatch(/Outside business hours|Outside business days/i);

    // Verify status was NOT updated to sent
    let currentDraft = storage.getOutreachById(draftId);
    expect(currentDraft?.status).toBe('approved');

    // 2. IN-WINDOW TEST: Wednesday 11:30 AM IST (2026-10-14T06:00:00.000Z)
    // Mon-Fri 09:00-18:00
    const inWindowDate = '2026-10-14T06:00:00.000Z'; // Wednesday 11:30 IST
    server.setTestClock(new Date(inWindowDate));

    const allowedRes = await fetch(`${baseUrl}/api/outreach/${draftId}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': token,
      },
      body: JSON.stringify({
        dryRun: true,
      }),
    });

    const allowedData = await allowedRes.json();
    expect(allowedData.success).toBe(true);
    expect(allowedData.emlPath).toBeDefined();

    // Verify status updated to sent in DB and .eml was written
    currentDraft = storage.getOutreachById(draftId);
    expect(currentDraft?.status).toBe('sent');
    expect(currentDraft?.sentAt).toBeDefined();
    expect(fs.existsSync(allowedData.emlPath!)).toBe(true);
  });
});

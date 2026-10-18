import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { StorageService } from '../../src/storage/database';
import { DashboardServer } from '../../src/dashboard/server';
import { HermesAgent } from '../../src/agent/hermes-agent';
import { HermesConfig } from '../../src/types';

describe('Phase 4 Dashboard Server & REST API Tests', () => {
  let server: DashboardServer;
  let agent: HermesAgent;
  let storage: StorageService;
  const testPort = 3987;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDbPath = path.resolve(__dirname, '../fixtures/test-dashboard.db');

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    const testConfig: HermesConfig = {
      openaiApiKey: 'test-key',
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

    // Seed test company
    const companyId = storage.upsertCompany({
      name: 'TestTech Corp',
      domain: 'testtech.io',
      sizeBucket: 'mid',
      ats: 'greenhouse',
      notes: 'Test company for dashboard',
    });

    // Seed test jobs: 1 qualified (score 75), 1 near-miss (score 48), 1 unqualified (score 25)
    storage.upsertJob({
      title: 'Senior SDET',
      company: 'TestTech Corp',
      location: 'Remote',
      isRemote: true,
      url: 'https://testtech.io/jobs/senior-sdet',
      description: 'Playwright, TypeScript, CI/CD, Test Automation',
      score: 75,
      scoreBreakdown: { title: 20, skills: 25, experience: 20, remote: 10, total: 75 },
      reasons: ['Strong Playwright match'],
      status: 'discovered',
      isApplied: false,
      scrapedAt: new Date().toISOString(),
      source: 'greenhouse',
    });

    storage.upsertJob({
      title: 'QA Automation Engineer',
      company: 'TestTech Corp',
      location: 'New York, NY',
      isRemote: false,
      url: 'https://testtech.io/jobs/qa-automation',
      description: 'Selenium, Java',
      score: 48,
      scoreBreakdown: { title: 15, skills: 15, experience: 10, remote: 8, total: 48 },
      reasons: ['Near miss SDET match'],
      status: 'discovered',
      isApplied: false,
      scrapedAt: new Date().toISOString(),
      source: 'greenhouse',
    });

    storage.upsertJob({
      title: 'Junior Manual QA Tester',
      company: 'TestTech Corp',
      location: 'Onsite',
      isRemote: false,
      url: 'https://testtech.io/jobs/manual-qa',
      description: 'Manual exploratory testing',
      score: 25,
      scoreBreakdown: { title: 5, skills: 10, experience: 5, remote: 5, total: 25 },
      reasons: ['Lacks automated testing'],
      status: 'discovered',
      isApplied: false,
      scrapedAt: new Date().toISOString(),
      source: 'greenhouse',
    });

    // Seed test contact
    const contactId = storage.addContact({
      companyId,
      fullName: 'Jordan Smith',
      title: 'Head of Quality Engineering',
      contactType: 'qa_manager',
      email: 'jordan.smith@testtech.io',
      emailStatus: 'unknown',
      timezone: 'America/New_York',
      source: 'manual',
    });

    // Seed test outreach draft
    storage.addOutreach({
      contactId,
      type: 'cold',
      subject: 'Quick question regarding TestTech QA automation',
      body: 'Hi Jordan,\n\nI noticed your team is scaling automated testing. Built TypeScript and Playwright pipelines cutting execution time by 45%.\n\nOpen to a brief 10-minute sync next week?\n\nIf not interested, just reply STOP.\n\nBest,\nCandidate',
      channel: 'email',
      status: 'draft',
    });

    // Start server strictly on 127.0.0.1
    server = new DashboardServer(agent, testPort);
    await server.start();
  });

  afterAll(async () => {
    if (server) server.stop();
    if (agent) agent.shutdown();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('1. Binds strictly to 127.0.0.1 and serves SPA index.html', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('JobHermes');
    expect(text).toContain('SDET Job-Search Copilot');
    expect(text).toContain('tab-today');
    expect(text).toContain('tab-jobs');
    expect(text).toContain('tab-outreach');
  });

  it('2. GET /api/stats returns accurate metrics, score distribution and safety status', async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.totalJobs).toBe(3);
    expect(data.qualifiedCount).toBe(1);
    expect(data.nearMissCount).toBe(1);
    expect(data.scoreDistribution).toBeInstanceOf(Array);
    expect(data.safety.dailySentToday).toBe(0);
    expect(data.safety.dailyCap).toBe(20);
    expect(data.safety.bounceRatePercent).toBe(0);
    expect(data.scheduler.cron).toBe('30 8 * * *');
    expect(data.scheduler.timezone).toBe('Asia/Kolkata');
  });

  it('3. GET /api/jobs returns jobs with score filtering (qualified vs near-misses)', async () => {
    // All jobs
    const resAll = await fetch(`${baseUrl}/api/jobs`);
    expect(resAll.status).toBe(200);
    const all = await resAll.json();
    expect(all.length).toBe(3);

    // Qualified jobs only (>= 60)
    const resQual = await fetch(`${baseUrl}/api/jobs?minScore=60`);
    const qual = await resQual.json();
    expect(qual.length).toBe(1);
    expect(qual[0].title).toBe('Senior SDET');
    expect(qual[0].score).toBe(75);

    // Near misses only (40-59)
    const resNear = await fetch(`${baseUrl}/api/jobs?nearMisses=true`);
    const near = await resNear.json();
    expect(near.length).toBe(1);
    expect(near[0].title).toBe('QA Automation Engineer');
    expect(near[0].score).toBe(48);
  });

  it('4. PATCH /api/jobs/:id updates job application status', async () => {
    const jobsRes = await fetch(`${baseUrl}/api/jobs?minScore=60`);
    const jobs = await jobsRes.json();
    const jobId = jobs[0].id;

    const patchRes = await fetch(`${baseUrl}/api/jobs/${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
      },
      body: JSON.stringify({ status: 'applied', notes: 'Applied via company careers page' }),
    });

    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.success).toBe(true);

    const getRes = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const job = await getRes.json();
    expect(job.status).toBe('applied');
    expect(job.notes).toBe('Applied via company careers page');
  });

  it('5. GET & POST /api/companies and /api/signals', async () => {
    const compRes = await fetch(`${baseUrl}/api/companies`);
    expect(compRes.status).toBe(200);
    const companies = await compRes.json();
    expect(companies.length).toBeGreaterThanOrEqual(1);

    const companyId = 1;

    // Add signal
    const sigRes = await fetch(`${baseUrl}/api/signals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
      },
      body: JSON.stringify({
        companyId,
        signalType: 'hiring_post',
        detail: 'VP of Eng posted looking for SDETs',
        url: 'https://linkedin.com/posts/testtech',
        source: 'manual',
      }),
    });
    expect(sigRes.status).toBe(200);
    const sigData = await sigRes.json();
    expect(sigData.success).toBe(true);

    // Get signals
    const getSigRes = await fetch(`${baseUrl}/api/signals?companyId=${companyId}`);
    const signals = await getSigRes.json();
    expect(signals.length).toBe(1);
    expect(signals[0].detail).toContain('VP of Eng');
  });

  it('6. GET, PATCH & DELETE /api/contacts', async () => {
    const contactsRes = await fetch(`${baseUrl}/api/contacts`);
    expect(contactsRes.status).toBe(200);
    const contacts = await contactsRes.json();
    expect(contacts.length).toBe(1);
    expect(contacts[0].emailStatus).toBe('unknown');

    const contactId = contacts[0].id;

    // Verify contact email status
    const verifyRes = await fetch(`${baseUrl}/api/contacts/${contactId}/verify`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
      },
      body: JSON.stringify({ emailStatus: 'verified' }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyData = await verifyRes.json();
    expect(verifyData.success).toBe(true);

    const checkRes = await fetch(`${baseUrl}/api/contacts`);
    const checkContacts = await checkRes.json();
    expect(checkContacts[0].emailStatus).toBe('verified');
  });

  it('7. GET /api/outreach evaluates automated lint and recipient send window', async () => {
    const outreachRes = await fetch(`${baseUrl}/api/outreach`);
    expect(outreachRes.status).toBe(200);
    const outreach = await outreachRes.json();
    expect(outreach.length).toBe(1);

    const item = outreach[0];
    expect(item.lint).toBeDefined();
    expect(typeof item.lint.valid).toBe('boolean');
    expect(item.lint.wordCount).toBeGreaterThan(0);
    expect(item.windowEval).toBeDefined();
    expect(typeof item.windowEval.allowed).toBe('boolean');
  });

  it('8. PATCH & POST /api/outreach: approve, edit, and refuse real-send on safety rails', async () => {
    const outreachRes = await fetch(`${baseUrl}/api/outreach`);
    const outreach = await outreachRes.json();
    const outreachId = outreach[0].id;

    // Edit draft
    const editRes = await fetch(`${baseUrl}/api/outreach/${outreachId}/edit`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
      },
      body: JSON.stringify({
        subject: 'Updated subject for SDET role',
        body: 'Updated body text under rules.\n\nBest,\nCandidate',
      }),
    });
    expect(editRes.status).toBe(200);

    // Approve draft
    const approveRes = await fetch(`${baseUrl}/api/outreach/${outreachId}/approve`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
      },
    });
    expect(approveRes.status).toBe(200);

    // Attempt real send (must be refused by safety guards: send-window, [FILL] check, or SMTP credentials)
    const sendRes = await fetch(`${baseUrl}/api/outreach/${outreachId}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
      },
      body: JSON.stringify({ dryRun: false }),
    });
    const sendData = await sendRes.json();
    expect(sendData.success).toBe(false);
    expect(sendData.error).toBeDefined();
  });

  it('9. GET /api/doctor returns configuration and environment diagnostics', async () => {
    const res = await fetch(`${baseUrl}/api/doctor`);
    expect(res.status).toBe(200);
    const checks = await res.json();
    expect(checks).toBeInstanceOf(Array);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks[0].name).toBeDefined();
    expect(checks[0].status).toBeDefined();
  });

  it('10. GET /api/auth-token returns the active session security token', async () => {
    const res = await fetch(`${baseUrl}/api/auth-token`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe(server.getLocalToken());
  });

  it('11. Security Hardening: Rejects requests with invalid Host header (403 Forbidden)', async () => {
    const { status, body } = await new Promise<{ status: number; body: any }>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/stats',
          method: 'GET',
          headers: { Host: 'evil-attacker.com' },
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 0, body: JSON.parse(raw) });
            } catch {
              resolve({ status: res.statusCode || 0, body: raw });
            }
          });
        }
      );
      req.end();
    });

    expect(status).toBe(403);
    expect(body.error).toContain('Invalid Host header');
  });

  it('12. Security Hardening: Rejects cross-origin mutations via Origin header (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
        Origin: 'https://malicious-website.com',
      },
      body: JSON.stringify({ status: 'applied' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Cross-origin mutation rejected');
  });

  it('13. Security Hardening: Rejects cross-origin mutations via Referer header (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
        Referer: 'https://malicious-website.com/phishing',
      },
      body: JSON.stringify({ status: 'applied' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Cross-origin mutation rejected');
  });

  it('14. Security Hardening: Rejects mutation requests without Content-Type: application/json (415)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'text/plain',
        'X-Hermes-Token': server.getLocalToken(),
      },
      body: 'invalid-text-payload',
    });
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain('Content-Type must be application/json');
  });

  it('15. Security Hardening: Rejects mutation requests with missing X-Hermes-Token (401 Unauthorized)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'applied' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Invalid or missing X-Hermes-Token header');
  });

  it('16. Security Hardening: Rejects mutation requests with invalid X-Hermes-Token (401 Unauthorized)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': 'wrong-token-abc-123',
      },
      body: JSON.stringify({ status: 'applied' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Invalid or missing X-Hermes-Token header');
  });

  it('17. Security Hardening: Rejects prefix-spoofed Origin http://localhost.evil.com (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
        Origin: 'http://localhost.evil.com',
      },
      body: JSON.stringify({ status: 'applied' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Cross-origin mutation rejected');
  });

  it('18. Security Hardening: Rejects prefix-spoofed Origin http://127.0.0.1.evil.com (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
        Origin: 'http://127.0.0.1.evil.com',
      },
      body: JSON.stringify({ status: 'applied' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Cross-origin mutation rejected');
  });

  it('19. Security Hardening: Rejects wrong port Origin http://localhost:9999 (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
        Origin: 'http://localhost:9999',
      },
      body: JSON.stringify({ status: 'applied' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Cross-origin mutation rejected');
  });

  it('20. Security Hardening: Never sends Access-Control-Allow-Origin header (no cross-origin access allowed)', async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('21. Clock Override Security: Ignores fakeNow in HTTP requests and prevents clock manipulation via API', async () => {
    // 1. Approve outreach draft #1
    storage.updateOutreachStatus(1, 'approved');

    // 2. Set server test clock to an out-of-hours timestamp (Sunday 23:00 IST)
    server.setTestClock(new Date('2026-10-18T17:30:00.000Z'));

    // 3. Send HTTP POST with fakeNow set to inside business window (Wednesday 11:30 IST)
    const res = await fetch(`${baseUrl}/api/outreach/1/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Token': server.getLocalToken(),
      },
      body: JSON.stringify({
        dryRun: true,
        fakeNow: '2026-10-14T06:00:00.000Z', // Attempted bypass via HTTP body
      }),
    });

    const data = await res.json();
    // Proves that fakeNow in HTTP body was completely ignored and send was blocked by real server test clock
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/Outside business hours|Outside business days/i);

    // Draft remains approved and was not sent
    const draft = storage.getOutreachById(1);
    expect(draft?.status).toBe('approved');
  });
});

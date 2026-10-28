// ============================================================
// JobHermes Dashboard Server – Local Express Server (127.0.0.1)
// ============================================================

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { HermesAgent } from '../agent/hermes-agent';
import { logger } from '../utils/logger';
import {
  ApplicationStatus,
  CandidateProfile,
  CompanyTarget,
  OutreachOutcome,
  validateSignalDetail,
} from '../types';
import { ResumeTailor } from '../outreach/resume-tailor';
import { DraftGenerator, lintOutreachDraft } from '../outreach/draft-generator';
import { SendService } from '../outreach/send-service';
import { ContactService, isWithinSendWindow } from '../contacts/contact-service';
import { FollowUpService } from '../outreach/follow-up-service';
import { proposeContactEmails } from '../contacts/pattern-inferrer';
import { runDoctor } from '../utils/doctor';
import { addCompanyFromUrl } from '../sources/add-company';
import { readJsonFile } from '../utils/helpers';

export class DashboardServer {
  public app: express.Application;
  private agent: HermesAgent;
  private port: number;
  private serverInstance: any;
  private localToken: string;
  private testClock?: Date;

  constructor(agent: HermesAgent, port = parseInt(process.env.PORT || '3987', 10)) {
    this.agent = agent;
    this.port = port;
    this.localToken = crypto.randomBytes(24).toString('hex');
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  public getLocalToken(): string {
    return this.localToken;
  }

  /**
   * Clock override strictly restricted to test code execution.
   * Cannot be set via HTTP parameters, request headers, or environment variables.
   */
  public setTestClock(date?: Date): void {
    if (process.env.NODE_ENV === 'test') {
      this.testClock = date;
    }
  }

  public getTestClock(): Date | undefined {
    return process.env.NODE_ENV === 'test' ? this.testClock : undefined;
  }

  private setupMiddleware() {
    // 1. Host header validation: reject if not 127.0.0.1:<port> or localhost:<port>
    this.app.use((req, res, next) => {
      const host = req.headers.host || '';
      const isValidHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
      if (!isValidHost) {
        res.status(403).json({ error: 'Forbidden: Invalid Host header' });
        return;
      }
      next();
    });

    // 2. Mutation security: reject cross-origin mutations, require Content-Type & local auth token
    const isValidLocalUrl = (urlStr: string): boolean => {
      try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'http:') return false;
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== '127.0.0.1' && hostname !== 'localhost') return false;
        const port = parsed.port ? parseInt(parsed.port, 10) : 80;
        if (port !== this.port) return false;
        return true;
      } catch {
        return false;
      }
    };

    this.app.use((req, res, next) => {
      const method = req.method.toUpperCase();
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        // Origin validation: parse URL and compare protocol, exact hostname, and port
        const origin = req.headers.origin;
        if (origin) {
          if (!isValidLocalUrl(origin)) {
            res.status(403).json({ error: 'Forbidden: Cross-origin mutation rejected' });
            return;
          }
        }

        // Referer validation: parse URL and compare protocol, exact hostname, and port
        const referer = req.headers.referer;
        if (referer) {
          if (!isValidLocalUrl(referer)) {
            res.status(403).json({ error: 'Forbidden: Cross-origin mutation rejected' });
            return;
          }
        }

        // Content-Type validation for body payloads
        if (['POST', 'PATCH', 'PUT'].includes(method)) {
          const contentType = req.headers['content-type'];
          if (!contentType || !contentType.toLowerCase().includes('application/json')) {
            res
              .status(415)
              .json({ error: 'Unsupported Media Type: Content-Type must be application/json' });
            return;
          }
        }

        // Token authorization check
        const token = req.headers['x-hermes-token'];
        if (!token || token !== this.localToken) {
          res.status(401).json({ error: 'Unauthorized: Invalid or missing X-Hermes-Token header' });
          return;
        }
      }
      next();
    });

    this.app.use(express.json());
    const publicPath =
      [
        path.join(__dirname, 'public'),
        path.join(process.cwd(), 'dist', 'dashboard', 'public'),
        path.join(process.cwd(), 'src', 'dashboard', 'public'),
      ].find((p) => fs.existsSync(p)) || path.join(process.cwd(), 'src', 'dashboard', 'public');
    this.app.use(express.static(publicPath));
  }

  private setupRoutes() {
    const storage = this.agent.getStorage();

    // ─── 0. Local Auth Token ────────────────────────────────────

    this.app.get('/api/auth-token', (_req, res) => {
      res.json({ token: this.localToken });
    });

    // ─── 1. Stats & Analytics ───────────────────────────────────

    this.app.get('/api/stats', (_req, res) => {
      try {
        const totalJobs = storage.countJobs();
        const apps = storage.getApplications();
        const allJobs = storage.getAllJobs();

        const statusCounts = allJobs.reduce(
          (acc, job) => {
            acc[job.status] = (acc[job.status] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        const qualifiedJobs = allJobs.filter((j) => (j.score ?? 0) >= 60);
        const nearMissJobs = allJobs.filter((j) => (j.score ?? 0) >= 40 && (j.score ?? 0) < 60);
        const contacts = storage.getAllContacts();
        const verifiedContacts = contacts.filter((c) => c.emailStatus === 'verified');
        const allOutreach = storage.getAllOutreach();

        const outreachDrafts = allOutreach.filter((o) => o.status === 'draft');
        const outreachApproved = allOutreach.filter((o) => o.status === 'approved');
        const outreachSent = allOutreach.filter((o) => o.status === 'sent');
        const outreachReplied = allOutreach.filter((o) => o.status === 'replied');
        const interviews = allOutreach.filter((o) => o.outcome === 'interview');

        const distribution = [
          { range: '90-100', count: allJobs.filter((j) => (j.score ?? 0) >= 90).length },
          {
            range: '80-89',
            count: allJobs.filter((j) => (j.score ?? 0) >= 80 && (j.score ?? 0) < 90).length,
          },
          {
            range: '70-79',
            count: allJobs.filter((j) => (j.score ?? 0) >= 70 && (j.score ?? 0) < 80).length,
          },
          {
            range: '60-69',
            count: allJobs.filter((j) => (j.score ?? 0) >= 60 && (j.score ?? 0) < 70).length,
          },
          { range: '40-59 (Near Misses)', count: nearMissJobs.length },
          { range: 'Below 40', count: allJobs.filter((j) => (j.score ?? 0) < 40).length },
        ];

        const metricMonth = new Date().toISOString().slice(0, 7);
        const hunterCalls = storage.getApiUsage('hunter', metricMonth);

        const dailySent = storage.getDailySentCount();
        const bounceStats = storage.getRecentBounceStats();
        const bounces = bounceStats.bounced;
        const bounceRate = bounceStats.bounceRate * 100;

        res.json({
          totalJobs,
          qualifiedCount: qualifiedJobs.length,
          nearMissCount: nearMissJobs.length,
          statusCounts,
          scoreDistribution: distribution,
          appliedCount: apps.length,
          recentApplications: apps.slice(0, 10),
          funnel: {
            discovered: totalJobs,
            qualified: qualifiedJobs.length,
            nearMisses: nearMissJobs.length,
            contactsFound: contacts.length,
            verifiedContacts: verifiedContacts.length,
            outreachDrafts: outreachDrafts.length,
            outreachApproved: outreachApproved.length,
            outreachSent: outreachSent.length,
            outreachReplied: outreachReplied.length,
            interviews: interviews.length,
          },
          safety: {
            dailySentToday: dailySent,
            dailyCap: 20,
            bounces,
            bounceRatePercent: parseFloat(bounceRate.toFixed(1)),
            circuitBreakerTripped: bounceRate > 10,
          },
          apiUsage: {
            hunterCalls,
            monthlyQuota: 25,
          },
          scheduler: {
            cron: '30 8 * * *',
            timezone: 'Asia/Kolkata',
            isScanning: this.agent.isCurrentlyScanning(),
          },
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── 2. Jobs Endpoints ─────────────────────────────────────

    this.app.get('/api/jobs', (req, res) => {
      try {
        const status = req.query.status as ApplicationStatus | undefined;
        const minScore = req.query.minScore
          ? parseInt(req.query.minScore as string, 10)
          : undefined;
        const maxScore = req.query.maxScore
          ? parseInt(req.query.maxScore as string, 10)
          : undefined;
        const nearMisses = req.query.nearMisses === 'true';
        const stretch = req.query.stretch ? req.query.stretch === 'true' : undefined;
        const company = req.query.company as string | undefined;
        const search = req.query.search as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

        const jobs = storage.getAllJobs({
          status,
          minScore,
          maxScore,
          nearMisses,
          stretch,
          company,
          search,
          limit,
        });

        res.json(jobs);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/jobs/:id', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const job = storage.getJobById(id);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }
        res.json(job);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.patch('/api/jobs/:id', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const { status, notes } = req.body;
        if (!status) {
          res.status(400).json({ error: 'Status is required' });
          return;
        }

        storage.updateJobStatus(id, status, notes);

        // If status marked as 'applied', record in applications log
        if (status === 'applied') {
          storage.addApplication({
            jobId: id,
            appliedAt: new Date().toISOString(),
            notes: notes || 'Direct manual application recorded via dashboard',
          });
        }

        const updated = storage.getJobById(id);
        res.json({ success: true, job: updated });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/jobs/:id/tailor', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const job = storage.getJobById(id);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }

        const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');
        const tailor = new ResumeTailor();
        const result = tailor.tailorResume('./config/base-resume.md', job, profile, {
          allowFillForDemo: true,
          saveDir: './output/tailored-resumes',
        });

        res.json({ success: true, result });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── 3. Companies & Signals Endpoints ──────────────────────

    this.app.get('/api/companies', (_req, res) => {
      try {
        const targetsPath = path.resolve('./config/company-targets.json');
        const targets: CompanyTarget[] = fs.existsSync(targetsPath)
          ? JSON.parse(fs.readFileSync(targetsPath, 'utf-8'))
          : [];
        const dbCompanies = storage.getAllCompanies();

        const enriched = targets.map((t) => {
          const dbComp = dbCompanies.find(
            (c) =>
              c.name.toLowerCase() === t.name.toLowerCase() ||
              c.domain.toLowerCase() === t.domain.toLowerCase()
          );
          const signalCount = dbComp?.id ? storage.getSignals(dbComp.id).length : 0;
          return {
            ...t,
            id: dbComp?.id,
            signalCount,
            researchBrief: dbComp?.researchBrief,
          };
        });

        res.json(enriched);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/companies', async (req, res) => {
      try {
        const { url } = req.body;
        if (!url) {
          res.status(400).json({ error: 'URL is required' });
          return;
        }

        const created = await addCompanyFromUrl(url);
        storage.upsertCompany({
          name: created.name,
          domain: created.domain,
          ats: created.ats,
          slug: created.slug,
          sizeBucket: created.sizeBucket || 'mid',
          notes: created.notes,
        });

        res.json({ success: true, company: created });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/signals', (req, res) => {
      try {
        const companyId = req.query.companyId
          ? parseInt(req.query.companyId as string, 10)
          : undefined;
        const signals = storage.getSignals(companyId);
        const companies = storage.getAllCompanies();

        const enriched = signals.map((s) => {
          const comp = companies.find((c) => c.id === s.companyId);
          return { ...s, companyName: comp?.name || `Company #${s.companyId}` };
        });

        res.json(enriched);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/signals', (req, res) => {
      try {
        const { companyId, companyName, signalType, detail, url, source } = req.body;
        let targetCompanyId = companyId;

        if (!targetCompanyId && companyName) {
          const existing = storage.getCompanyByName(companyName);
          if (existing?.id) {
            targetCompanyId = existing.id;
          } else {
            targetCompanyId = storage.upsertCompany({
              name: companyName,
              domain: `${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
              ats: 'custom',
              sizeBucket: 'mid',
            });
          }
        }

        if (!targetCompanyId || !signalType || !detail) {
          res
            .status(400)
            .json({ error: 'companyName/companyId, signalType, and detail are required' });
          return;
        }

        const validation = validateSignalDetail(detail);
        if (!validation.valid) {
          res.status(400).json({ error: validation.error });
          return;
        }

        const signalId = storage.addSignal({
          companyId: targetCompanyId,
          signalType,
          detail,
          url,
          source: source || 'manual',
        });

        res.json({ success: true, signalId });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.delete('/api/signals/:id', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const deleted = storage.deleteSignal(id);
        res.json({ success: deleted });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── 4. Contacts Endpoints ─────────────────────────────────

    this.app.get('/api/contacts', (req, res) => {
      try {
        const companyId = req.query.companyId
          ? parseInt(req.query.companyId as string, 10)
          : undefined;
        const verifiedOnly = req.query.verifiedOnly === 'true';

        const contacts = storage.getAllContacts({
          companyId,
          emailStatus: verifiedOnly ? 'verified' : undefined,
        });
        const companies = storage.getAllCompanies();

        const enriched = contacts.map((c) => {
          const comp = companies.find((cp) => cp.id === c.companyId);
          return {
            ...c,
            companyName: comp?.name || `Company #${c.companyId}`,
            companyDomain: comp?.domain,
          };
        });

        res.json(enriched);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/contacts', (req, res) => {
      try {
        const {
          companyId,
          fullName,
          title,
          contactType,
          email,
          emailStatus,
          timezone,
          linkedinUrl,
          notes,
          source,
        } = req.body;
        if (!companyId || !fullName || !title) {
          res.status(400).json({ error: 'companyId, fullName, and title are required' });
          return;
        }

        const id = storage.addContact({
          companyId: parseInt(companyId, 10),
          fullName,
          title,
          contactType: contactType || 'generic_careers',
          email,
          emailStatus: emailStatus || (email ? 'unknown' : 'none'),
          timezone: timezone || 'Asia/Kolkata',
          linkedinUrl,
          notes,
          source: source || 'manual',
        });

        res.json({ success: true, contactId: id });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/contacts/import', (req, res) => {
      try {
        const { filePath } = req.body;
        if (!filePath) {
          res.status(400).json({ error: 'filePath is required' });
          return;
        }
        const contactService = new ContactService(storage);
        const result = contactService.importContactsFromCsv(filePath);
        res.json({
          success: true,
          importedCount: result.imported,
          failedCount: result.failed,
          errors: result.errors,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.patch('/api/contacts/:id/verify', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        storage.updateContactEmailStatus(id, 'verified');
        res.json({ success: true, contactId: id, emailStatus: 'verified' });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.delete('/api/contacts/:id', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const deleted = storage.deleteContact(id);
        res.json({ success: deleted });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/contacts/infer-pattern', (req, res) => {
      try {
        const { domain, fullName } = req.body;
        if (!domain || !fullName) {
          res.status(400).json({ error: 'domain and fullName are required' });
          return;
        }

        const candidates = proposeContactEmails(fullName, domain);
        res.json({ success: true, candidates });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── 5. Outreach Queue Endpoints ───────────────────────────

    this.app.get('/api/outreach', (req, res) => {
      try {
        const status = req.query.status as any;
        const items = storage.getAllOutreach({ status });
        const contacts = storage.getAllContacts();
        const companies = storage.getAllCompanies();

        const enriched = items.map((o) => {
          const contact = contacts.find((c) => c.id === o.contactId);
          const comp = contact ? companies.find((cp) => cp.id === contact.companyId) : undefined;
          const tz = contact?.timezone || 'Asia/Kolkata';

          // Timezone send window evaluation
          const windowEval = isWithinSendWindow(tz, this.getTestClock());

          // Automated lint check
          const lint = lintOutreachDraft(o.subject, o.body);

          // Word counts
          const subjectWords = o.subject.trim().split(/\s+/).filter(Boolean).length;
          const bodyWords = o.body.trim().split(/\s+/).filter(Boolean).length;

          return {
            ...o,
            contactName: contact?.fullName,
            contactEmail: contact?.email,
            contactTitle: contact?.title,
            contactType: contact?.contactType,
            companyName: comp?.name || (contact ? `Company #${contact.companyId}` : 'Unknown'),
            timezone: tz,
            windowEval,
            lint,
            wordCounts: { subjectWords, bodyWords },
          };
        });

        res.json(enriched);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/outreach/generate', (req, res) => {
      try {
        const { contactId, jobId } = req.body;
        if (!contactId || !jobId) {
          res.status(400).json({ error: 'contactId and jobId are required' });
          return;
        }

        const contact = storage.getContactById(parseInt(contactId, 10));
        const job = storage.getJobById(parseInt(jobId, 10));
        if (!contact || !job) {
          res.status(404).json({ error: 'Contact or Job not found' });
          return;
        }
        if (job.status === 'closed') {
          res.status(400).json({ error: `Cannot draft outreach for a closed job (#${jobId}).` });
          return;
        }

        const company = storage.getCompanyById(contact.companyId);
        if (!company) {
          res.status(404).json({ error: 'Company not found' });
          return;
        }

        const signals = storage.getSignals(company.id);
        const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');
        const generator = new DraftGenerator();
        const pack = generator.generateDrafts(profile, job, contact, company, signals, {
          allowFillForDemo: true,
        });

        const draftAId = storage.addOutreach({
          contactId: contact.id!,
          jobId: job.id,
          type: 'cold',
          variant: 'A',
          subject: pack.variantA.subject,
          body: pack.variantA.body,
          status: 'draft',
          source: 'manual',
        });

        const draftBId = storage.addOutreach({
          contactId: contact.id!,
          jobId: job.id,
          type: 'cold',
          variant: 'B',
          subject: pack.variantB.subject,
          body: pack.variantB.body,
          status: 'draft',
          source: 'manual',
        });

        res.json({
          success: true,
          draftAId,
          draftBId,
          linkedinDm: pack.linkedInDm,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.patch('/api/outreach/:id/approve', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        storage.updateOutreachStatus(id, 'approved');
        res.json({ success: true, outreachId: id, status: 'approved' });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.patch('/api/outreach/:id/edit', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const { subject, body } = req.body;
        if (!subject || !body) {
          res.status(400).json({ error: 'subject and body are required' });
          return;
        }

        storage.updateOutreachContent(id, subject, body);
        const lint = lintOutreachDraft(subject, body);

        res.json({ success: true, outreachId: id, lint });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.delete('/api/outreach/:id', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const deleted = storage.deleteOutreach(id);
        res.json({ success: deleted });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/outreach/:id/send', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        // Security requirement: fakeNow or clock overrides cannot be accepted from HTTP request body/params/headers/env
        const { dryRun, bypassWindow } = req.body;

        const isDryRun = dryRun !== false;
        const sendService = new SendService(storage, 20, isDryRun);
        const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');

        const effectiveNow = this.getTestClock();

        const result = await sendService.sendOutreach(id, profile, {
          bypassTimezone: Boolean(bypassWindow),
          allowDemo: true, // Demo allowed in dry run
          now: effectiveNow,
        });

        res.json(result);
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/outreach/:id/reply', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const outcome = (req.body.outcome as OutreachOutcome) || 'positive';

        const followUpService = new FollowUpService(storage);
        followUpService.recordReply(id, outcome);

        res.json({ success: true, outreachId: id, status: 'replied', outcome });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/outreach/check-followups', (_req, res) => {
      try {
        const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');
        const followUpService = new FollowUpService(storage);
        const evals = followUpService.checkAndCreateFollowUps(profile);

        res.json({ success: true, evaluations: evals });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── 6. Profile & Health Endpoints ─────────────────────────

    this.app.get('/api/profile', (_req, res) => {
      try {
        const profilePath = path.resolve('./config/candidate-profile.json');
        const data = fs.readFileSync(profilePath, 'utf-8');
        res.json(JSON.parse(data));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.patch('/api/profile', (req, res) => {
      try {
        const profilePath = path.resolve('./config/candidate-profile.json');
        const updatedProfile = req.body;
        fs.writeFileSync(profilePath, JSON.stringify(updatedProfile, null, 2), 'utf-8');
        res.json({ success: true, profile: updatedProfile });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/doctor', (_req, res) => {
      try {
        const checks = runDoctor();
        res.json(checks);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── 7. Scan Controls ──────────────────────────────────────

    this.app.post('/api/scan', (_req, res) => {
      try {
        if (this.agent.isCurrentlyScanning()) {
          res.status(400).json({ error: 'Scan already in progress' });
          return;
        }

        this.agent
          .runDailyScan()
          .then(() => {
            logger.info('Manual job scan completed successfully.');
          })
          .catch((err) => {
            logger.error('Manual job scan failed', { error: String(err) });
          });

        res.json({ success: true, message: 'Scan triggered in background.' });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/scan/status', (_req, res) => {
      res.json({ isScanning: this.agent.isCurrentlyScanning() });
    });

    // ─── 8. Export & Backup ────────────────────────────────────

    this.app.get('/api/export', (req, res) => {
      try {
        const type = (req.query.type as string) || 'jobs';
        if (type === 'contacts') {
          res.json(storage.getAllContacts());
        } else if (type === 'outreach') {
          res.json(storage.getAllOutreach());
        } else if (type === 'applications') {
          res.json(storage.getApplications());
        } else {
          res.json(storage.getAllJobs());
        }
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/backup', (_req, res) => {
      try {
        const backupDir = path.resolve('./data/backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `jobhermes-${timestamp}.db`);

        const dbPath = path.resolve('./data/jobhermes.db');
        if (fs.existsSync(dbPath)) {
          fs.copyFileSync(dbPath, backupPath);
          res.json({ success: true, backupPath });
        } else {
          res.status(404).json({ error: 'Database file not found' });
        }
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // SPA fallback
    this.app.use((_req, res) => {
      const candidatePaths = [
        path.join(__dirname, 'public', 'index.html'),
        path.join(process.cwd(), 'dist', 'dashboard', 'public', 'index.html'),
        path.join(process.cwd(), 'src', 'dashboard', 'public', 'index.html'),
      ];
      const indexPath = candidatePaths.find((p) => fs.existsSync(p)) || candidatePaths[2];
      res.sendFile(indexPath);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.serverInstance = this.app.listen(this.port, '127.0.0.1', () => {
        const addr = this.serverInstance?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        logger.section('Web Dashboard Server Running');
        logger.info(`Access JobHermes dashboard at: http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.serverInstance) {
        this.serverInstance.close(() => {
          logger.info('Web Dashboard Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getPort(): number {
    return this.port;
  }
}

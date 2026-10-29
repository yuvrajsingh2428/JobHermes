import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './utils/config';
import { HermesAgent } from './agent/hermes-agent';
import { Scheduler } from './scheduler/scheduler';
import { logger } from './utils/logger';
import { DashboardServer } from './dashboard/server';
import { runVerifyTargets } from './sources/verify-targets';
import { addCompanyFromUrl } from './sources/add-company';
import { runDoctor } from './utils/doctor';
import { hasFillMarkers, SignalType, CandidateProfile, validateSignalDetail } from './types';
import { StorageService } from './storage/database';
import { ContactService } from './contacts/contact-service';
import { DraftGenerator, lintOutreachDraft } from './outreach/draft-generator';
import { SendService } from './outreach/send-service';
import { ResumeTailor } from './outreach/resume-tailor';
import { FollowUpService } from './outreach/follow-up-service';
import { seedDemoSandbox, getDemoDbPath } from './utils/demo-sandbox';
import { readJsonFile } from './utils/helpers';
import { rescoreAllJobs } from './scoring/rescore';
import {
  createDatabaseBackup,
  exportData,
  ExportEntity,
  ExportFormat,
} from './utils/backup-export';

const rawArgs = process.argv.slice(2);

async function main(): Promise<void> {
  const isDemo = process.env.DEMO_MODE === 'true' || rawArgs.includes('--demo');
  const args = rawArgs.filter((a) => a !== '--demo');
  const flag = args[0];
  const dbPath = isDemo ? getDemoDbPath() : process.env.DATABASE_PATH || './data/jobhermes.db';

  if (isDemo && !fs.existsSync(dbPath)) {
    seedDemoSandbox(dbPath);
  }

  if (flag === 'verify-targets' || flag === '--verify-targets') {
    await runVerifyTargets();
    return;
  }

  if (flag === 'add-company' || flag === '--add-company') {
    const url = args[1];
    if (!url) {
      logger.error('Usage: npm run add-company <careers-url>');
      process.exit(1);
    }
    await addCompanyFromUrl(url);
    return;
  }

  if (flag === 'doctor' || flag === '--doctor') {
    runDoctor();
    return;
  }

  // ─── Backup & Export CLI ────────────────────────────────────
  if (flag === 'backup' || flag === '--backup') {
    try {
      const result = createDatabaseBackup(dbPath);
      logger.section('Database Backup Complete');
      logger.info(`Snapshot: ${result.backupPath}`);
      logger.info(`Size:     ${(result.sizeBytes / 1024).toFixed(1)} KB`);
    } catch (err: any) {
      logger.error(`Backup failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (flag === 'export' || flag === '--export') {
    const entity = (args[1] || 'jobs') as ExportEntity;
    const format = (args[2] || 'csv').toLowerCase() as ExportFormat;
    const validEntities: ExportEntity[] = ['jobs', 'contacts', 'outreach', 'applications'];
    const validFormats: ExportFormat[] = ['csv', 'json'];

    if (!validEntities.includes(entity) || !validFormats.includes(format)) {
      logger.error('Usage: npm run export [jobs|contacts|outreach|applications] [csv|json]');
      logger.info('Defaults: target = jobs, format = csv');
      process.exit(1);
    }

    const storage = new StorageService(dbPath);
    try {
      const result = exportData(storage, entity, format);
      logger.section('Data Export Complete');
      logger.info(`Entity:   ${result.entity}`);
      logger.info(`Format:   ${result.format.toUpperCase()}`);
      logger.info(`Records:  ${result.recordCount}`);
      logger.info(`File:     ${result.filePath}`);
    } catch (err: any) {
      logger.error(`Export failed: ${err.message}`);
      process.exit(1);
    } finally {
      storage.close();
    }
    return;
  }

  // ─── Signals CLI ───────────────────────────────────────────
  if (flag === 'signal' || flag === '--signal') {
    const sub = args[1];
    const storage = new StorageService(dbPath);

    if (sub === 'add') {
      const companyName = args[2];
      const signalType = (args[3] as SignalType) || 'other';
      const detail = args[4];
      const url = args[5];

      if (!companyName || !detail) {
        logger.error('Usage: npm run signal add <company> <type> <detail> [url]');
        logger.info(
          'Detail format: 3-15 words noun phrase, e.g. "the SDET team expanding in Bangalore" (do not start with a verb like "posted")'
        );
        logger.info(
          'Types: funding | hiring_post | multiple_qa_roles | product_launch | headcount_growth | layoffs | other'
        );
        process.exit(1);
      }

      const detailValidation = validateSignalDetail(detail);
      if (!detailValidation.valid) {
        logger.error(`Invalid signal detail: ${detailValidation.error}`);
        logger.info('Example format: "the SDET team expanding in Bangalore"');
        process.exit(1);
      }

      let company = storage.getCompanyByName(companyName);
      if (!company) {
        const compId = storage.upsertCompany({
          name: companyName,
          domain: `${companyName.toLowerCase().replace(/\s+/g, '')}.com`,
          sizeBucket: 'mid',
          ats: 'custom',
          notes: 'Auto-created via signal add',
        });
        company = storage.getCompanyById(compId);
      }

      if (!company || !company.id) {
        logger.error(`Could not resolve company: ${companyName}`);
        process.exit(1);
      }

      const source = args[6] || (isDemo ? 'demo' : 'manual');

      storage.addSignal({
        companyId: company.id,
        signalType,
        detail,
        url,
        source,
      });

      logger.success(
        `Signal added for ${company.name}: [${signalType}] "${detail}" (source: ${source})`
      );
      return;
    }

    if (sub === 'list' || !sub) {
      const companyFilter = args[2];
      if (companyFilter) {
        const company = storage.getCompanyByName(companyFilter);
        if (!company || !company.id) {
          logger.warn(`Company not found: ${companyFilter}`);
          return;
        }
        const signals = storage.getSignalsForCompany(company.id);
        logger.section(`Signals for ${company.name}`);
        if (signals.length === 0) {
          logger.info('No signals recorded.');
        } else {
          signals.forEach((s) =>
            logger.info(
              `  • [${s.signalType}] ${s.detail} (${s.seenAt})${s.url ? ` - ${s.url}` : ''}`
            )
          );
        }
        return;
      }

      const companies = storage.getAllCompanies();
      logger.section('All Recorded Company Signals');
      let count = 0;
      for (const comp of companies) {
        if (!comp.id) continue;
        const sigs = storage.getSignalsForCompany(comp.id);
        if (sigs.length > 0) {
          count += sigs.length;
          logger.info(`🏢 ${comp.name}:`);
          sigs.forEach((s) => logger.info(`   • [${s.signalType}] ${s.detail} (${s.seenAt})`));
        }
      }
      if (count === 0) logger.info('No company signals found in database.');
      return;
    }

    logger.error(
      'Unknown signal subcommand. Use: signal add <company> <type> <detail> [url] OR signal list [company]'
    );
    process.exit(1);
  }

  // ─── Contact Management CLI ────────────────────────────────
  if (flag === 'import-contacts' || flag === '--import-contacts') {
    const csvPath = args[1];
    if (!csvPath) {
      logger.error('Usage: npm run import-contacts <path-to-contacts.csv>');
      process.exit(1);
    }
    const storage = new StorageService(dbPath);
    const contactService = new ContactService(storage);
    try {
      const result = contactService.importContactsFromCsv(csvPath);
      logger.section('Contact Import Summary');
      logger.info(`Successfully imported: ${result.imported}`);
      logger.info(`Failed rows:           ${result.failed}`);
      if (result.errors.length > 0) {
        logger.warn('Errors encountered:');
        result.errors.forEach((e) => logger.warn(`  - ${e}`));
      }
    } catch (err: any) {
      logger.error(`CSV import failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (flag === 'contacts' || flag === '--contacts') {
    const sub = args[1];
    const storage = new StorageService(dbPath);
    const contactService = new ContactService(storage);

    if (sub === 'verify') {
      const contactId = parseInt(args[2], 10);
      if (!contactId) {
        logger.error('Usage: npm run contacts verify <contact-id>');
        process.exit(1);
      }
      contactService.verifyContact(contactId);
      return;
    }

    if (sub === 'todo') {
      const todo = contactService.getTodoCompanies();
      logger.section('Companies Needing Contacts (Todo)');
      if (todo.length === 0) {
        logger.info('All recorded companies currently have contacts.');
      } else {
        todo.slice(0, 15).forEach(({ company, rule }, i) => {
          logger.info(`\n#${i + 1} 🏢 ${company.name} [Size: ${company.sizeBucket}]`);
          logger.info(`   Target Personas: ${rule.targetTitles.join(', ')}`);
          logger.info(`   Priority Types:  ${rule.priorityTypes.join(', ')}`);
          logger.info(`   Why:             ${rule.rationale}`);
        });
      }
      return;
    }

    const companyFilter = sub === 'list' ? args[2] : sub;
    const contacts = contactService.getContacts(companyFilter);
    logger.section(companyFilter ? `Contacts for ${companyFilter}` : 'Saved Contacts');
    if (contacts.length === 0) {
      logger.info('No contacts found.');
    } else {
      contacts.forEach((c) => {
        logger.info(
          `  • ${c.fullName} | ${c.title} | ${c.contactType} | ${c.email || 'no email'} [${c.emailStatus}] | TZ: ${c.timezone || 'Asia/Kolkata'}${c.linkedinUrl ? ` | ${c.linkedinUrl}` : ''}`
        );
      });
    }
    return;
  }

  // ─── Application Tracking CLI ──────────────────────────────
  if (flag === 'application' || flag === '--application' || flag === 'applications') {
    const sub = args[1];
    const storage = new StorageService(dbPath);

    if (sub === 'add') {
      const jobId = parseInt(args[2], 10);
      const notes = args.slice(3).join(' ') || 'Direct manual application';
      if (!jobId) {
        logger.error('Usage: npm run application add <jobId> [notes]');
        process.exit(1);
      }
      const job = storage.getJobById(jobId);
      if (!job) {
        logger.error(`Job ID ${jobId} not found in database.`);
        process.exit(1);
      }
      const now = new Date().toISOString();
      storage.markApplied(jobId, now);
      const appId = storage.addApplication({
        jobId,
        appliedAt: now,
        notes,
        outcome: 'applied',
      });
      logger.success(`Recorded direct application #${appId} for "${job.title}" at ${job.company}`);
      return;
    }

    if (sub === 'list' || !sub) {
      const apps = storage.getApplications();
      logger.section('Direct Applications Log');
      if (apps.length === 0) {
        logger.info('No applications recorded yet.');
      } else {
        apps.forEach((a) => {
          const job = storage.getJobById(a.jobId);
          logger.info(
            `  #${a.id} | Job #${a.jobId}: ${job?.title || 'Unknown'} @ ${job?.company || 'Unknown'}`
          );
          logger.info(
            `     Applied: ${a.appliedAt} | Outcome: ${a.outcome || 'pending'} | Notes: ${a.notes || 'None'}`
          );
        });
      }
      return;
    }

    logger.error(
      'Unknown application command. Use: application add <jobId> [notes] OR application list'
    );
    process.exit(1);
  }

  // ─── Outreach Engine CLI ───────────────────────────────────
  if (flag === 'outreach' || flag === '--outreach') {
    const sub = args[1];
    const storage = new StorageService(dbPath);
    const draftGen = new DraftGenerator();
    const sendService = new SendService(storage);

    if (sub === 'generate') {
      const jobId = parseInt(args[2], 10);
      const contactId = parseInt(args[3], 10);
      if (!jobId || !contactId) {
        logger.error('Usage: npm run outreach generate <job-id> <contact-id>');
        process.exit(1);
      }
      const job = storage.getJobById(jobId);
      const contact = storage.getContactById(contactId);
      if (!job || !contact) {
        logger.error(`Job #${jobId} or Contact #${contactId} not found in database.`);
        process.exit(1);
      }
      if (job.status === 'closed') {
        logger.error(
          `Cannot draft outreach for closed job #${jobId} (${job.title} @ ${job.company}).`
        );
        process.exit(1);
      }
      const company = storage.getCompanyById(contact.companyId) || {
        name: job.company,
        domain: '',
        sizeBucket: 'mid',
        ats: 'custom',
      };
      const signals = storage.getSignalsForCompany(contact.companyId, { excludeDemo: !isDemo });
      const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');

      const pack = draftGen.generateDrafts(profile, job, contact, company, signals, {
        allowFillForDemo: isDemo,
      });

      const idA = storage.addOutreach({
        contactId,
        jobId,
        type: 'cold',
        variant: 'A',
        subject: pack.variantA.subject,
        body: pack.variantA.body,
        status: 'draft',
        source: isDemo ? 'demo' : 'manual',
      });

      const idB = storage.addOutreach({
        contactId,
        jobId,
        type: 'cold',
        variant: 'B',
        subject: pack.variantB.subject,
        body: pack.variantB.body,
        status: 'draft',
        source: isDemo ? 'demo' : 'manual',
      });

      logger.section('Generated Cold Outreach Drafts');
      logger.info(`Draft #A (ID: ${idA}):`);
      logger.info(`Subject: ${pack.variantA.subject}\n\n${pack.variantA.body}\n`);
      logger.info(`Draft #B (ID: ${idB}):`);
      logger.info(`Subject: ${pack.variantB.subject}\n\n${pack.variantB.body}\n`);
      logger.section('LinkedIn DM Referral Ask');
      logger.info(pack.linkedInDm);
      return;
    }

    if (sub === 'list' || !sub) {
      const filterStatus = args[2];
      const drafts = storage.getAllOutreach(filterStatus ? { status: filterStatus } : undefined);
      logger.section('Outreach Queue & Drafts');
      if (drafts.length === 0) {
        logger.info('No outreach drafts found.');
      } else {
        drafts.forEach((d) => {
          const contact = storage.getContactById(d.contactId);
          const lint = lintOutreachDraft(d.subject, d.body);
          const lintTag = lint.valid
            ? '✅ [LINT: PASS]'
            : `⚠️ [LINT WARN: ${lint.warnings.join('; ')}]`;
          logger.info(
            `  • #${d.id} [${d.status.toUpperCase()}] Var ${d.variant || 'A'} | To: ${contact?.fullName || 'Contact ' + d.contactId} (${contact?.email || 'no email'}) | ${lintTag}`
          );
          logger.info(
            `     Subject: "${d.subject}" (${lint.subjectWordCount} words) | Body: ${lint.wordCount} words`
          );
          if (d.sentAt) logger.info(`     Sent: ${d.sentAt}`);
          if (d.error) logger.warn(`     Error: ${d.error}`);
        });
      }
      return;
    }

    if (sub === 'approve') {
      const id = parseInt(args[2], 10);
      if (!id) {
        logger.error('Usage: npm run outreach approve <id>');
        process.exit(1);
      }
      storage.updateOutreachStatus(id, 'approved');
      logger.success(`Outreach draft #${id} approved for sending.`);
      return;
    }

    if (sub === 'edit') {
      const id = parseInt(args[2], 10);
      const subject = args[3];
      const body = args.slice(4).join(' ');
      if (!id || !subject || !body) {
        logger.error('Usage: npm run outreach edit <id> "<subject>" "<body>"');
        process.exit(1);
      }
      storage.updateOutreachContent(id, subject, body);
      logger.success(`Outreach draft #${id} updated.`);
      return;
    }

    if (sub === 'send') {
      const id = parseInt(args[2], 10);
      if (!id) {
        logger.error('Usage: npm run outreach send <id>');
        process.exit(1);
      }
      const bypassTz = args.includes('--bypass-window') || args.includes('--force');
      const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');
      const res = await sendService.sendOutreach(id, profile, {
        bypassTimezone: bypassTz,
        allowDemo: isDemo,
      });
      if (res.success) {
        logger.success(
          `Outreach #${id} sent successfully!${res.emlPath ? ` (Dry-run file: ${res.emlPath})` : ''}`
        );
      } else {
        logger.error(`Send failed for #${id}: ${res.error}`);
        process.exit(1);
      }
      return;
    }

    if (sub === 'tailor') {
      const jobId = parseInt(args[2], 10);
      if (!jobId) {
        logger.error('Usage: npm run outreach tailor <job-id>');
        process.exit(1);
      }
      const job = storage.getJobById(jobId);
      if (!job) {
        logger.error(`Job #${jobId} not found in database.`);
        process.exit(1);
      }
      const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');
      const tailor = new ResumeTailor();
      const result = tailor.tailorResume('./config/base-resume.md', job, profile, {
        allowFillForDemo: isDemo,
        saveDir: './output/tailored-resumes',
      });
      logger.section(`Tailored Resume for ${job.title} @ ${job.company}`);
      logger.info(result.diffSummary);
      if (result.outputPath) logger.success(`Saved to: ${result.outputPath}`);
      return;
    }

    if (sub === 'followups' || sub === 'check-followups') {
      const profile = readJsonFile<CandidateProfile>('./config/candidate-profile.json');
      const followUpService = new FollowUpService(storage);
      const evals = followUpService.checkAndCreateFollowUps(profile);
      logger.section('Follow-Up Cadence Review');
      if (evals.length === 0) {
        logger.info('No sent outreach emails found to evaluate.');
      } else {
        evals.forEach((e) => {
          if (e.eligible) {
            logger.success(
              `Created follow-up draft #${e.createdFollowUpId} for ${e.recipientEmail} (Contact #${e.contactId})`
            );
          } else {
            logger.info(`Skipped Outreach #${e.outreachId} (${e.recipientEmail}): ${e.reason}`);
          }
        });
      }
      return;
    }

    if (sub === 'reply') {
      const id = parseInt(args[2], 10);
      const outcome = (args[3] as any) || 'positive';
      if (!id) {
        logger.error(
          'Usage: npm run outreach reply <outreach-id> [positive|negative|interview|referral]'
        );
        process.exit(1);
      }
      const followUpService = new FollowUpService(storage);
      followUpService.recordReply(id, outcome);
      return;
    }

    logger.error(
      'Unknown outreach command. Use: outreach list | outreach approve <id> | outreach edit <id> | outreach send <id> | outreach tailor <jobId> | outreach followups | outreach reply <id>'
    );
    process.exit(1);
  }

  // ─── 8. CLI: Daily Digest ────────────────────────────────────
  if (flag === 'digest' || flag === '--digest') {
    const isDemo = process.env.DEMO_MODE === 'true' || args.includes('--demo');
    const storage = isDemo
      ? new StorageService('./data/demo.db')
      : new StorageService('./data/jobhermes.db');

    logger.section(`JobHermes SDET Copilot Daily Digest ${isDemo ? '[DEMO SANDBOX]' : '[LIVE]'}`);
    const allJobs = storage.getAllJobs();
    const qualifiedJobs = allJobs.filter((j) => (j.score ?? 0) >= 60);
    const nearMissJobs = allJobs.filter((j) => (j.score ?? 0) >= 40 && (j.score ?? 0) < 60);
    const contacts = storage.getAllContacts();
    const verifiedContacts = contacts.filter((c) => c.emailStatus === 'verified');
    const outreach = storage.getAllOutreach();
    const pendingDrafts = outreach.filter((o) => o.status === 'draft');
    const sentToday = storage.getDailySentCount();
    const bounceStats = storage.getRecentBounceStats();

    logger.info(
      `📅 Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
    );
    logger.info(`⏰ Next Scheduled Scan: 08:30 AM IST (Asia/Kolkata)`);
    logger.info('');
    logger.info(`📊 Job Opportunities:`);
    logger.info(`  • Total Tracked: ${allJobs.length}`);
    logger.info(`  • Top SDET Qualified (≥60): ${qualifiedJobs.length}`);
    logger.info(`  • Near Misses (40–59): ${nearMissJobs.length}`);
    logger.info('');
    logger.info(`👥 Human Contacts:`);
    logger.info(`  • Discovered: ${contacts.length}`);
    logger.info(`  • Verified: ${verifiedContacts.length}`);
    logger.info('');
    logger.info(`✉️ Outreach Pipeline:`);
    logger.info(`  • Pending Approvals: ${pendingDrafts.length} drafts awaiting human review`);
    logger.info(`  • Sent Today: ${sentToday} / 20 max daily cap`);
    logger.info(
      `  • Bounces: ${bounceStats.bounced} (Rate: ${(bounceStats.bounceRate * 100).toFixed(1)}%)`
    );
    logger.info('');

    if (pendingDrafts.length > 0) {
      logger.info(
        '🎯 Action Needed: Run "npm run outreach list" to review and approve pending drafts.'
      );
    } else if (qualifiedJobs.length > 0 && contacts.length === 0) {
      logger.info(
        '🎯 Action Needed: Run "npm run contacts todo" to identify target human contacts for top jobs.'
      );
    } else {
      logger.info('✅ System running smoothly. All queues up to date.');
    }

    storage.close();
    return;
  }

  // ─── 9. CLI: Data Export ─────────────────────────────────────
  if (flag === 'export' || flag === '--export') {
    const isDemo = process.env.DEMO_MODE === 'true' || args.includes('--demo');
    const storage = isDemo
      ? new StorageService('./data/demo.db')
      : new StorageService('./data/jobhermes.db');
    const exportType = args[1] || 'all';
    const format = args[2] || 'json';

    const exportDir = path.resolve('./output/exports');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    logger.section(`Exporting JobHermes Data (${exportType})`);

    const data: Record<string, unknown> = {};
    if (exportType === 'all' || exportType === 'jobs') data.jobs = storage.getAllJobs();
    if (exportType === 'all' || exportType === 'contacts') data.contacts = storage.getAllContacts();
    if (exportType === 'all' || exportType === 'outreach') data.outreach = storage.getAllOutreach();
    if (exportType === 'all' || exportType === 'applications')
      data.applications = storage.getApplications();

    const fileName = `export-${exportType}-${timestamp}.${format === 'csv' ? 'csv' : 'json'}`;
    const filePath = path.join(exportDir, fileName);

    if (format === 'csv' && exportType !== 'all') {
      const items = (data[exportType] || []) as Record<string, unknown>[];
      if (items.length > 0) {
        const headers = Object.keys(items[0]).join(',');
        const rows = items.map((it) =>
          Object.values(it)
            .map((v) => `"${String(v || '').replace(/"/g, '""')}"`)
            .join(',')
        );
        fs.writeFileSync(filePath, [headers, ...rows].join('\n'), 'utf-8');
      } else {
        fs.writeFileSync(filePath, '', 'utf-8');
      }
    } else {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    logger.success(`Data exported successfully to: ${filePath}`);
    storage.close();
    return;
  }

  // ─── 10. CLI: Database Backup ────────────────────────────────
  if (flag === 'backup' || flag === '--backup') {
    const backupDir = path.resolve('./data/backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbPath = path.resolve('./data/jobhermes.db');
    const backupPath = path.join(backupDir, `jobhermes-${timestamp}.db`);

    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
      logger.success(`Database backed up successfully to: ${backupPath}`);
    } else {
      logger.error(`Database not found at: ${dbPath}`);
      process.exit(1);
    }
    return;
  }

  // ─── 11. CLI: Rescore Jobs ───────────────────────────────────
  if (flag === 'rescore' || flag === '--rescore') {
    const isDemo = process.env.DEMO_MODE === 'true' || args.includes('--demo');
    const storage = isDemo
      ? new StorageService('./data/demo.db')
      : new StorageService('./data/jobhermes.db');
    const profilePath = path.resolve('./config/candidate-profile.json');
    const profile: CandidateProfile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));

    logger.section(`Rescoring All Tracked Opportunities ${isDemo ? '[DEMO]' : '[LIVE]'}`);
    const results = rescoreAllJobs(storage, profile);

    if (results.length === 0) {
      logger.info('No jobs found in database to rescore.');
    } else {
      for (const r of results) {
        logger.info(`Job #${r.jobId} "${r.title}" @ ${r.company}:`);
        logger.info(
          `  • Score:  ${r.oldScore} -> ${r.newScore} (Hiring Signal: ${r.breakdown.hiringSignal})`
        );
        logger.info(`  • Status: ${r.oldStatus} -> ${r.newStatus}`);
      }
      logger.success(`Rescored ${results.length} jobs successfully.`);
    }

    storage.close();
    return;
  }

  // ─── 12. CLI: First-Run Readiness Diagnostic ─────────────────
  if (flag === 'first-run' || flag === '--first-run') {
    const storage = new StorageService(dbPath);

    logger.section('JobHermes First-Run Setup Diagnostic');
    logger.info('Auditing configuration readiness and database assets...\n');

    // 1. profile_reviewed
    const profilePath = path.resolve('./config/candidate-profile.json');
    let profileReviewed = false;
    let profile: CandidateProfile | null = null;
    if (fs.existsSync(profilePath)) {
      try {
        profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
        profileReviewed = Boolean(profile?.profile_reviewed);
      } catch {}
    }
    const profileStatus = profileReviewed
      ? 'READY (Reviewed)'
      : 'ACTION REQUIRED: skills list is assumed default; review config/candidate-profile.json and set "profile_reviewed": true';

    // 2. [FILL] markers
    let profileFillCount = 0;
    let resumeFillCount = 0;
    const resumePath = path.resolve('./config/base-resume.md');
    if (profile) {
      const pCheck = hasFillMarkers(profile);
      profileFillCount = pCheck.markerPaths.length;
    }
    if (fs.existsSync(resumePath)) {
      const rContent = fs.readFileSync(resumePath, 'utf-8');
      resumeFillCount = (rContent.match(/\[FILL/g) || []).length;
    }
    const totalFill = profileFillCount + resumeFillCount;
    const fillStatus =
      totalFill === 0
        ? 'READY (0 markers remaining)'
        : `PENDING: ${totalFill} markers remaining (${profileFillCount} in candidate-profile.json, ${resumeFillCount} in base-resume.md)`;

    // 3. number of verified companies
    const targetsPath = path.resolve('./config/company-targets.json');
    let totalCompanies = 0;
    let verifiedCompanies = 0;
    if (fs.existsSync(targetsPath)) {
      try {
        const targets: Array<{ enabled: boolean; verified: boolean }> = JSON.parse(
          fs.readFileSync(targetsPath, 'utf-8')
        );
        totalCompanies = targets.length;
        verifiedCompanies = targets.filter((t) => t.enabled && t.verified).length;
      } catch {}
    }
    const companyStatus = `${verifiedCompanies} verified active targets (out of ${totalCompanies} configured)`;

    // 4. contacts per qualified job
    const topJobs = storage.getTopJobs(100, 60);
    const qualifiedCount = topJobs.length;
    let qualifiedWithContacts = 0;
    let totalContactsForQualified = 0;
    for (const job of topJobs) {
      const comp = storage.getCompanyByName(job.company);
      if (comp && comp.id) {
        const contacts = storage.getContactsForCompany(comp.id);
        if (contacts.length > 0) {
          qualifiedWithContacts++;
          totalContactsForQualified += contacts.length;
        }
      }
    }
    const avgContacts =
      qualifiedCount > 0 ? (totalContactsForQualified / qualifiedCount).toFixed(1) : '0';
    const contactsStatus =
      qualifiedCount > 0
        ? `${qualifiedWithContacts}/${qualifiedCount} qualified jobs have >= 1 contact (${avgContacts} avg contacts per job)`
        : '0 qualified jobs in database (run a scan first)';

    // 5. research briefs
    const allDbCompanies = storage.getAllCompanies();
    const withBrief = allDbCompanies.filter((c) => Boolean(c.researchBrief)).length;
    const briefStatus = `${withBrief}/${allDbCompanies.length} tracked companies have research briefs`;

    console.log('============================================================');
    console.log('               FIRST-RUN READINESS REPORT                   ');
    console.log('============================================================');
    console.log(`  Profile Review State    : ${profileStatus}`);
    console.log(`  [FILL] Placeholder State: ${fillStatus}`);
    console.log(`  Verified Target Targets : ${companyStatus}`);
    console.log(`  Contacts / Qualified Job: ${contactsStatus}`);
    console.log(`  Company Research Briefs : ${briefStatus}`);
    console.log('============================================================\n');
    logger.info('Note: first-run diagnostic only reports system readiness and refuses nothing.');

    storage.close();
    return;
  }

  if (flag === '--help' || flag === '-h') {
    logger.section('JobHermes SDET Copilot CLI Usage');
    logger.info('Options:');
    logger.info(
      '  verify-targets                        Hit all ATS APIs in company-targets.json & report status'
    );
    logger.info(
      '  add-company <careers-url>             Detect ATS, slug, verify API, and save target'
    );
    logger.info(
      '  doctor                                Diagnostic check on candidate profile and system state'
    );
    logger.info(
      '  signal add <company> <type> <detail>  Record company signal (detail: 3-15 words noun phrase, e.g. "the SDET team expanding in Bangalore")'
    );
    logger.info('  signal list [company]                 Display company signals');
    logger.info(
      '  import-contacts <csv-path>            Import contacts with roles, emails, and timezones'
    );
    logger.info('  contacts verify <id>                  Mark contact email as verified');
    logger.info(
      '  contacts list [company]               List saved contacts and outreach readiness'
    );
    logger.info(
      '  contacts todo                         List companies needing contact discovery with persona rules'
    );
    logger.info('  application add <job-id> [notes]      Record direct manual application');
    logger.info('  application list                      View direct application history');
    logger.info(
      '  outreach generate <jobId> <contactId> Generate fact-grounded A/B cold drafts + LinkedIn DM'
    );
    logger.info(
      '  outreach list [status]                List outreach queue and approval statuses'
    );
    logger.info('  outreach approve <id>                 Approve an outreach draft for sending');
    logger.info('  outreach edit <id> <subj> <body>      Edit outreach subject and body');
    logger.info(
      '  outreach send <id>                    Safely send approved outreach (writes .eml in dry-run mode)'
    );
    logger.info(
      '  --scan                                Run an immediate job scan across active ATS sources'
    );
    logger.info(
      '  --scan --all-titles                   List all QA/test titles across sources regardless of score'
    );
    logger.info('  --resume <job-id>                     Generate a tailored resume for a job');
    logger.info(
      '  --cover-letter <job-id> [tone]        Generate a tailored cover letter (professional | enthusiastic | concise)'
    );
    logger.info(
      '  --apply <job-id> [tone]               Generate application pack (resume + cover letter)'
    );
    logger.info(
      '  --status                              Display database statistics and top matched jobs'
    );
    logger.info(
      '  --dashboard                           Start the local Web Dashboard (127.0.0.1:3987)'
    );
    logger.info(
      '  backup                                Create a timestamped SQLite database snapshot'
    );
    logger.info(
      '  export [target] [format]              Export data (jobs|contacts|outreach|applications) to csv|json'
    );
    logger.info('  --help, -h                            Show this help menu');
    logger.info('');
    logger.info(
      'Note: If no arguments are provided, JobHermes runs in daemon mode (scheduled scans) and starts the dashboard.'
    );
    return;
  }

  // Helper to assert candidate profile has no [FILL] markers before generating documents or sending emails
  function assertNoFillMarkers(profilePath: string, baseResumePath = './config/base-resume.md') {
    if (fs.existsSync(profilePath)) {
      const content = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      const profileCheck = hasFillMarkers(content);
      if (profileCheck.hasFill) {
        logger.error(`Refusing to run: Unresolved [FILL] markers found in ${profilePath}:`);
        profileCheck.markerPaths.slice(0, 5).forEach((m) => logger.error(`  - ${m}`));
        process.exit(1);
      }
    }
    if (fs.existsSync(baseResumePath)) {
      const resumeContent = fs.readFileSync(baseResumePath, 'utf-8');
      if (resumeContent.includes('[FILL')) {
        logger.error(`Refusing to run: Unresolved [FILL] markers found in ${baseResumePath}`);
        process.exit(1);
      }
    }
  }

  logger.section('JobHermes Starting Up');

  // Load and validate config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error('Configuration error', { error: String(err) });
    process.exit(1);
  }

  const agent = new HermesAgent(config);

  if (flag === '--scan' || flag === 'scan') {
    if (args.includes('--all-titles') || process.argv.includes('--all-titles')) {
      logger.section('All QA / Test Titles Across Enabled Targets');
      const allTitles = await agent.scanAllQaTitles();
      logger.info(`Found ${allTitles.length} QA/test roles across targets:\n`);
      allTitles.forEach((t, i) => {
        const tag = t.isSdetMatch ? '[SDET / Automation]' : '[General / Manual QA]';
        logger.info(`  #${i + 1} ${tag} ${t.title} @ ${t.company} (${t.location})`);
        logger.info(`     URL: ${t.url}`);
      });
      agent.shutdown();
      return;
    }

    logger.info('Running immediate job scan...');
    await agent.runDailyScan();
    agent.shutdown();
    return;
  }

  if (flag === '--resume') {
    assertNoFillMarkers(config.candidateProfilePath);
    const jobId = parseInt(args[1] || '0', 10);
    if (!jobId) {
      logger.error('Usage: npm run resume <job-id>');
      process.exit(1);
    }
    const resumePath = await agent.generateResume(jobId);
    logger.success(`Resume saved: ${resumePath}`);
    agent.shutdown();
    return;
  }

  if (flag === '--cover-letter') {
    assertNoFillMarkers(config.candidateProfilePath);
    const jobId = parseInt(args[1] || '0', 10);
    const tone = (args[2] as 'professional' | 'enthusiastic' | 'concise') || 'professional';
    if (!jobId) {
      logger.error('Usage: npm run cover-letter <job-id> [professional|enthusiastic|concise]');
      process.exit(1);
    }
    const coverPath = await agent.generateCoverLetter(jobId, tone);
    logger.success(`Cover letter saved: ${coverPath}`);
    agent.shutdown();
    return;
  }

  if (flag === '--apply') {
    assertNoFillMarkers(config.candidateProfilePath);
    const jobId = parseInt(args[1] || '0', 10);
    const tone = (args[2] as 'professional' | 'enthusiastic' | 'concise') || 'professional';
    if (!jobId) {
      logger.error('Usage: ts-node src/index.ts --apply <job-id> [tone]');
      process.exit(1);
    }
    const { resumePath, coverLetterPath } = await agent.generateApplicationPack(jobId, tone);
    logger.success(`Application pack generated:`);
    logger.info(`  Resume:       ${resumePath}`);
    logger.info(`  Cover Letter: ${coverLetterPath}`);
    agent.shutdown();
    return;
  }

  if (flag === '--status') {
    const storage = agent.getStorage();
    const total = storage.countJobs();
    const topJobs = agent.getTopJobs(5);
    logger.section('JobHermes Status');
    logger.info(`Total jobs in database: ${total}`);
    logger.info('Top 5 jobs:');
    topJobs.forEach((j, i) => {
      logger.info(`  ${i + 1}. [${j.score}] ${j.title} @ ${j.company} – ${j.location}`);
    });
    agent.shutdown();
    return;
  }

  if (flag === '--dashboard') {
    const port = parseInt(process.env.PORT || '3987', 10);
    logger.info(`Starting JobHermes Dashboard Server on port ${port}...`);
    const dashboard = new DashboardServer(agent, port);
    await dashboard.start();

    const shutdownDashboard = async () => {
      logger.section('Shutting Down Dashboard');
      await dashboard.stop();
      agent.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdownDashboard);
    process.on('SIGTERM', shutdownDashboard);
    return;
  }

  // Default mode: run scheduler (daemon mode) + dashboard server
  logger.info('Starting in daemon mode (scheduled scans)...');

  const scheduler = new Scheduler(agent, config.cronSchedule, config.timezone);
  scheduler.start();

  const port = parseInt(process.env.PORT || '3987', 10);
  logger.info(`Starting JobHermes Dashboard Server on port ${port}...`);
  const dashboard = new DashboardServer(agent, port);
  await dashboard.start();

  if (args.includes('--run-now')) {
    logger.info('Running immediate scan on startup...');
    await agent.runDailyScan();
  }

  const shutdown = async () => {
    logger.section('Shutting Down');
    scheduler.stop();
    await dashboard.stop();
    agent.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.success('JobHermes daemon & dashboard are running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

// ============================================================
// Outreach Send Service – Nodemailer, .eml Dry-Run & Safety Rails
// ============================================================

import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { StorageService } from '../storage/database';
import { OutreachRecord, ContactRecord, CandidateProfile, hasFillMarkers } from '../types';
import { isWithinSendWindow } from '../contacts/contact-service';
import { logger } from '../utils/logger';

export interface SendResult {
  success: boolean;
  outreachId: number;
  emlPath?: string;
  error?: string;
}

export interface CanSendOptions {
  bypassTimezone?: boolean;
  allowDemo?: boolean;
  now?: Date;
  profile?: CandidateProfile;
  baseResumePath?: string;
  fromAddress?: string;
}

export class SendService {
  private storage: StorageService;
  private maxDailySends: number;
  private dryRun: boolean;

  constructor(storage: StorageService, maxDailySends = 20, isDryRun?: boolean) {
    this.storage = storage;
    this.maxDailySends = parseInt(process.env.MAX_DAILY_SENDS || String(maxDailySends), 10);
    this.dryRun = isDryRun !== undefined ? isDryRun : process.env.SEND_REAL_EMAILS !== 'true';
  }

  setDryRun(val: boolean): void {
    this.dryRun = val;
  }

  isDryRunMode(): boolean {
    return this.dryRun;
  }

  /**
   * Evaluates all safety guards before sending
   */
  canSend(
    outreach: OutreachRecord,
    contact: ContactRecord,
    options?: CanSendOptions
  ): { allowed: boolean; reason?: string } {
    // 1. Strict approval gate
    if (outreach.status !== 'approved') {
      return { allowed: false, reason: `Outreach #${outreach.id} is not approved (status=${outreach.status}). Must be approved before sending.` };
    }

    // 2. Data integrity: Real sending must refuse any contact whose source is "sample"/"demo"
    if (contact.source === 'demo' || contact.source === 'sample') {
      if (!this.dryRun) {
        return {
          allowed: false,
          reason: `Refusing real send: Contact #${contact.id} (${contact.fullName}) has demo/sample source (${contact.source}). Real sending strictly refuses demo/sample contacts.`,
        };
      }
      if (!options?.allowDemo && process.env.DEMO_MODE !== 'true') {
        return {
          allowed: false,
          reason: `Refusing send: Contact #${contact.id} has demo/sample source (${contact.source}). Demo contacts can only be processed in dry-run with DEMO_MODE=true.`,
        };
      }
    }

    // 3. Email verification gate: must be verified
    if (contact.emailStatus !== 'verified') {
      return { allowed: false, reason: `Refusing send: Contact #${contact.id} email is not verified (status=${contact.emailStatus}). Run Hunter verification or 'contacts verify <id>'.` };
    }

    if (!contact.email || !contact.email.includes('@')) {
      return { allowed: false, reason: `Contact #${contact.id} does not have a valid email address.` };
    }

    // 4. Suppression list check
    if (this.storage.isSuppressed(contact.email)) {
      return { allowed: false, reason: `Email ${contact.email} is in suppression list.` };
    }

    // 5. Daily send cap
    const todaySends = this.storage.getDailySentCount();
    if (todaySends >= this.maxDailySends) {
      return { allowed: false, reason: `Daily send cap of ${this.maxDailySends} reached (sent today: ${todaySends}).` };
    }

    // 6. Bounce circuit breaker (>10%)
    const bounceStats = this.storage.getRecentBounceStats();
    if (bounceStats.totalSent >= 10 && bounceStats.bounceRate > 0.10) {
      return { allowed: false, reason: `Bounce circuit breaker triggered: bounce rate is ${(bounceStats.bounceRate * 100).toFixed(1)}% (>10%). Sending paused.` };
    }

    // 7. Recipient timezone business hours send window (ENFORCED IN BOTH DRY-RUN AND REAL MODE)
    if (!options?.bypassTimezone) {
      const checkDate = options?.now || new Date();
      const windowCheck = isWithinSendWindow(contact.timezone || 'Asia/Kolkata', checkDate);
      if (!windowCheck.allowed) {
        return { allowed: false, reason: windowCheck.reason || 'Outside business hours in recipient timezone' };
      }
    }

    // 8. Real-mode [FILL] marker safeguards: refuse if any [FILL] markers remain
    if (!this.dryRun) {
      if (options?.profile) {
        const fillCheck = hasFillMarkers(options.profile);
        if (fillCheck.hasFill) {
          return {
            allowed: false,
            reason: `Refusing real send: candidate profile contains unresolved [FILL] markers (${fillCheck.markerPaths.slice(0, 3).join(', ')}).`,
          };
        }

        const senderEmail = options.fromAddress || options.profile.email || process.env.SMTP_USER || '';
        if (!senderEmail || senderEmail.includes('[FILL') || !senderEmail.includes('@')) {
          return {
            allowed: false,
            reason: `Refusing real send: unresolved [FILL] marker or invalid sender (From) configuration: "${senderEmail}".`,
          };
        }

        if (options.profile.name && options.profile.name.includes('[FILL')) {
          return {
            allowed: false,
            reason: `Refusing real send: candidate name in profile contains unresolved [FILL] markers.`,
          };
        }
      }

      const resumePath = path.resolve(options?.baseResumePath || './config/base-resume.md');
      if (fs.existsSync(resumePath)) {
        const resumeContent = fs.readFileSync(resumePath, 'utf-8');
        if (resumeContent.includes('[FILL')) {
          return {
            allowed: false,
            reason: `Refusing real send: base resume (${resumePath}) contains unresolved [FILL] markers.`,
          };
        }
      }
    } else {
      // In dry-run mode, warn if [FILL] markers exist
      if (options?.profile && hasFillMarkers(options.profile).hasFill) {
        logger.warn('Dry-run warning: Candidate profile contains unresolved [FILL] markers (allowed in dry-run mode only).');
      }
    }

    return { allowed: true };
  }

  /**
   * Executes send (either real SMTP or local .eml dry run)
   */
  async sendOutreach(
    outreachId: number,
    profile: CandidateProfile,
    options?: CanSendOptions & { mockSmtp?: boolean }
  ): Promise<SendResult> {
    const outreach = this.storage.getOutreachById(outreachId);
    if (!outreach) {
      return { success: false, outreachId, error: `Outreach #${outreachId} not found` };
    }

    const contact = this.storage.getContactById(outreach.contactId);
    if (!contact) {
      return { success: false, outreachId, error: `Contact #${outreach.contactId} not found` };
    }

    const check = this.canSend(outreach, contact, { ...options, profile });
    if (!check.allowed) {
      logger.warn(`Send blocked for Outreach #${outreachId}: ${check.reason}`);
      return { success: false, outreachId, error: check.reason };
    }

    const now = new Date().toISOString();
    const recipientEmail = contact.email!;
    const fromAddress = profile.email || 'jobsearch@jobhermes.local';

    // ─── Dry Run Mode (Default ON): Emit .eml File ──────────────
    if (this.dryRun || options?.mockSmtp) {
      const todayDate = now.slice(0, 10);
      const emlDir = path.resolve(`./output/eml/${todayDate}`);
      if (!fs.existsSync(emlDir)) fs.mkdirSync(emlDir, { recursive: true });

      const cleanEmail = recipientEmail.replace(/[^a-zA-Z0-9@._-]/g, '_');
      const emlPath = path.join(emlDir, `${cleanEmail}-${outreach.id}.eml`);

      const emlContent = [
        `From: ${profile.name} <${fromAddress}>`,
        `To: ${contact.fullName} <${recipientEmail}>`,
        `Subject: ${outreach.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <outreach-${outreach.id}-${Date.now()}@jobhermes.local>`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=UTF-8`,
        ``,
        outreach.body,
      ].join('\r\n');

      fs.writeFileSync(emlPath, emlContent, 'utf-8');

      this.storage.updateOutreachStatus(outreachId, 'sent', { sentAt: now });
      logger.success(`[DRY-RUN] Outreach #${outreachId} saved to .eml: ${emlPath}`);
      return { success: true, outreachId, emlPath };
    }

    // ─── Real Send Mode: Nodemailer SMTP ───────────────────────
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      });

      await transporter.sendMail({
        from: `"${profile.name}" <${fromAddress}>`,
        to: recipientEmail,
        subject: outreach.subject,
        text: outreach.body,
      });

      this.storage.updateOutreachStatus(outreachId, 'sent', { sentAt: now });
      logger.success(`Outreach #${outreachId} sent to ${recipientEmail} via SMTP`);
      return { success: true, outreachId };
    } catch (err: any) {
      const errorMsg = `SMTP send failure: ${err.message}`;
      this.storage.updateOutreachStatus(outreachId, 'bounced', { error: errorMsg });
      logger.error(`Send failed for Outreach #${outreachId}`, { error: err.message });
      return { success: false, outreachId, error: errorMsg };
    }
  }
}

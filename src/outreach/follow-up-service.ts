// ============================================================
// Follow-Up Service – Automated Cadence, Max Cap & Reply Tracking
// ============================================================

import { StorageService } from '../storage/database';
import { OutreachOutcome, CandidateProfile } from '../types';
import { logger } from '../utils/logger';

export interface FollowUpEvaluation {
  outreachId: number;
  contactId: number;
  recipientEmail: string;
  eligible: boolean;
  reason?: string;
  createdFollowUpId?: number;
}

export class FollowUpService {
  private storage: StorageService;
  private maxEmailsPerContact: number;

  constructor(storage: StorageService, maxEmailsPerContact = 2) {
    this.storage = storage;
    this.maxEmailsPerContact = maxEmailsPerContact;
  }

  /**
   * Scans sent outreach and generates follow-up drafts for emails due (>5-6 days old)
   * Enforces:
   * - Must not have received a reply
   * - Must not be suppressed
   * - Max 2 emails per contact total (1 cold + 1 follow-up)
   * - Follow-up created strictly in 'draft' status awaiting human approval
   */
  checkAndCreateFollowUps(
    profile: CandidateProfile,
    options?: { now?: Date; minDaysSinceSent?: number }
  ): FollowUpEvaluation[] {
    const now = options?.now || new Date();
    const minDays = options?.minDaysSinceSent ?? 5; // Default: 5 days
    const results: FollowUpEvaluation[] = [];

    const sentEmails = this.storage
      .getAllOutreach()
      .filter((o) => (o.status === 'sent' || o.status === 'replied') && Boolean(o.sentAt));

    for (const sent of sentEmails) {
      if (!sent.id || !sent.sentAt) continue;

      const contact = this.storage.getContactById(sent.contactId);
      if (!contact || !contact.email) continue;

      const sentTime = new Date(sent.sentAt).getTime();
      const ageDays = (now.getTime() - sentTime) / (1000 * 60 * 60 * 24);

      // 1. Check if due
      if (ageDays < minDays) {
        results.push({
          outreachId: sent.id,
          contactId: sent.contactId,
          recipientEmail: contact.email,
          eligible: false,
          reason: `Not due yet (${ageDays.toFixed(1)} days old; min is ${minDays} days)`,
        });
        continue;
      }

      // 2. Check if a reply has already been received from this contact
      const contactAllOutreach = this.storage.getAllOutreach({ contactId: sent.contactId });
      const hasReplied = contactAllOutreach.some((o) => o.status === 'replied' || o.replyAt);
      if (hasReplied || sent.replyAt || sent.status === 'replied') {
        results.push({
          outreachId: sent.id,
          contactId: sent.contactId,
          recipientEmail: contact.email,
          eligible: false,
          reason: `Reply already received for contact #${sent.contactId}. Cadence stopped.`,
        });
        continue;
      }

      // 3. Check suppression list
      if (this.storage.isSuppressed(contact.email)) {
        results.push({
          outreachId: sent.id,
          contactId: sent.contactId,
          recipientEmail: contact.email,
          eligible: false,
          reason: `Contact email ${contact.email} is in suppression list. Cadence stopped.`,
        });
        continue;
      }

      // 4. Check maximum email cap (Max 2 emails per contact)
      if (contactAllOutreach.length >= this.maxEmailsPerContact) {
        results.push({
          outreachId: sent.id,
          contactId: sent.contactId,
          recipientEmail: contact.email,
          eligible: false,
          reason: `Maximum outreach cap reached (${contactAllOutreach.length}/${this.maxEmailsPerContact} emails already created/sent).`,
        });
        continue;
      }

      // 5. Build respectful follow-up draft
      const contactFirstName = contact.fullName.split(' ')[0] || 'there';
      const company = this.storage.getCompanyById(contact.companyId);
      const companyName = company?.name || 'your team';
      const candidateName = profile.name.includes('[FILL') ? 'Candidate' : profile.name;

      const followUpSubject = sent.subject.startsWith('Re:') ? sent.subject : `Re: ${sent.subject}`;
      const followUpBody = [
        `Hi ${contactFirstName},`,
        ``,
        `Following up briefly on my note below regarding the SDET role at ${companyName}. I know you're busy, so I'll keep this short.`,
        ``,
        `Would you be open to a 5-minute chat this week, or could you point me to whoever leads QA hiring?`,
        ``,
        `Thanks,`,
        `${candidateName}`,
        ``,
        `P.S. If you're all set on hiring, no worries at all and I won't follow up again.`,
      ].join('\n');

      const followUpId = this.storage.addOutreach({
        contactId: sent.contactId,
        jobId: sent.jobId,
        type: 'follow_up_1',
        variant: sent.variant || 'A',
        subject: followUpSubject,
        body: followUpBody,
        status: 'draft', // Strictly awaiting approval!
        source: sent.source || 'manual',
      });

      logger.success(
        `Follow-up draft #${followUpId} created for contact #${sent.contactId} (${contact.email})`
      );
      results.push({
        outreachId: sent.id,
        contactId: sent.contactId,
        recipientEmail: contact.email,
        eligible: true,
        createdFollowUpId: followUpId,
      });
    }

    return results;
  }

  /**
   * Records a reply to an outreach email and pauses all future follow-ups
   */
  recordReply(outreachId: number, outcome: OutreachOutcome = 'positive'): void {
    const outreach = this.storage.getOutreachById(outreachId);
    if (!outreach) {
      throw new Error(`Outreach #${outreachId} not found`);
    }

    this.storage.recordOutreachReply(outreachId, outcome);
    logger.success(
      `Recorded reply for Outreach #${outreachId}. Status set to 'replied' (outcome: ${outcome}).`
    );
  }
}

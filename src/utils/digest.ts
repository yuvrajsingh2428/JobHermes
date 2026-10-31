// ============================================================
// Daily Digest Generator – Executive summary of jobs, pipeline & actions
// ============================================================

import { StorageService } from '../storage/database';

export interface DigestJobSummary {
  id?: number;
  title: string;
  company: string;
  score: number;
  location?: string;
  isRemote?: boolean;
}

export interface DailyDigestReport {
  timestamp: string;
  dateFormatted: string;
  nextScheduledScan: string;
  mode: 'demo' | 'live';
  jobs: {
    totalTracked: number;
    topQualified: number;
    nearMisses: number;
    closed: number;
    topOpportunities: DigestJobSummary[];
  };
  contacts: {
    total: number;
    verified: number;
    pendingVerification: number;
  };
  outreach: {
    pendingApproval: number;
    sentToday: number;
    dailyCap: number;
    replied: number;
    bounces: number;
    bounceRate: number;
    followUpsDue: number;
  };
  actionItems: string[];
}

export interface DigestOptions {
  isDemo?: boolean;
  now?: Date;
  followUpMinDays?: number;
}

/**
 * Generates an executive daily digest snapshot aggregating metrics from storage.
 */
export function generateDailyDigest(
  storage: StorageService,
  options?: DigestOptions
): DailyDigestReport {
  const isDemo = Boolean(options?.isDemo);
  const now = options?.now || new Date();
  const minDays = options?.followUpMinDays ?? 5;

  const allJobs = storage.getAllJobs({ includeClosed: true });
  const topQualifiedJobs = allJobs.filter((j) => (j.score ?? 0) >= 60 && j.status !== 'closed');
  const nearMissJobs = allJobs.filter(
    (j) => (j.score ?? 0) >= 40 && (j.score ?? 0) < 60 && j.status !== 'closed'
  );
  const closedJobs = allJobs.filter((j) => j.status === 'closed');

  // Top 3 highest scoring active opportunities
  const activeJobs = allJobs.filter((j) => j.status !== 'closed');
  const topOpportunities: DigestJobSummary[] = [...activeJobs]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3)
    .map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      score: j.score ?? 0,
      location: j.location,
      isRemote: j.isRemote,
    }));

  const contacts = storage.getAllContacts();
  const verifiedContacts = contacts.filter((c) => c.emailStatus === 'verified');
  const pendingContacts = contacts.filter((c) => c.emailStatus !== 'verified');

  const outreach = storage.getAllOutreach();
  const pendingDrafts = outreach.filter((o) => o.status === 'draft');
  const sentToday = storage.getDailySentCount();
  const replied = outreach.filter((o) => o.status === 'replied');
  const bounceStats = storage.getRecentBounceStats();

  // Calculate follow-ups due (> minDays old, status sent, no reply)
  const minDaysMs = minDays * 24 * 60 * 60 * 1000;
  const followUpsDue = outreach.filter((o) => {
    if (o.status !== 'sent' || !o.sentAt) return false;
    const sentTime = new Date(o.sentAt).getTime();
    return now.getTime() - sentTime >= minDaysMs;
  }).length;

  const actionItems: string[] = [];
  if (pendingDrafts.length > 0) {
    actionItems.push(
      `Review and approve ${pendingDrafts.length} pending outreach draft${pendingDrafts.length > 1 ? 's' : ''} ("npm run outreach list")`
    );
  }
  if (followUpsDue > 0) {
    actionItems.push(
      `Process ${followUpsDue} follow-up${followUpsDue > 1 ? 's' : ''} due for sent outreach ("npm run outreach followups")`
    );
  }
  if (topQualifiedJobs.length > 0 && verifiedContacts.length === 0) {
    actionItems.push(
      'Identify target human contacts for top-matching SDET roles ("npm run contacts todo")'
    );
  }
  if (allJobs.length === 0) {
    actionItems.push('Run initial job scan across configured target companies ("npm run scan")');
  }
  if (bounceStats.bounceRate > 0.05) {
    actionItems.push(
      `High bounce rate detected (${(bounceStats.bounceRate * 100).toFixed(1)}%). Review contact email quality.`
    );
  }
  if (actionItems.length === 0) {
    actionItems.push('All queues up to date. Next automated scan scheduled for 08:30 AM IST.');
  }

  return {
    timestamp: now.toISOString(),
    dateFormatted: now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    nextScheduledScan: '08:30 AM IST (Asia/Kolkata)',
    mode: isDemo ? 'demo' : 'live',
    jobs: {
      totalTracked: allJobs.length,
      topQualified: topQualifiedJobs.length,
      nearMisses: nearMissJobs.length,
      closed: closedJobs.length,
      topOpportunities,
    },
    contacts: {
      total: contacts.length,
      verified: verifiedContacts.length,
      pendingVerification: pendingContacts.length,
    },
    outreach: {
      pendingApproval: pendingDrafts.length,
      sentToday,
      dailyCap: 20,
      replied: replied.length,
      bounces: bounceStats.bounced,
      bounceRate: bounceStats.bounceRate,
      followUpsDue,
    },
    actionItems,
  };
}

/**
 * Formats a daily digest report into human-readable terminal output.
 */
export function formatDailyDigestText(report: DailyDigestReport): string {
  const lines: string[] = [];

  const titleMode = report.mode === 'demo' ? '[DEMO SANDBOX]' : '[LIVE]';
  lines.push('────────────────────────────────────────────────────────────');
  lines.push(`  🚀 JobHermes SDET Copilot Daily Digest ${titleMode}`);
  lines.push('────────────────────────────────────────────────────────────');
  lines.push(`📅 Date: ${report.dateFormatted}`);
  lines.push(`⏰ Next Scheduled Scan: ${report.nextScheduledScan}`);
  lines.push('');

  lines.push('📊 Job Opportunities:');
  lines.push(`  • Total Tracked: ${report.jobs.totalTracked}`);
  lines.push(`  • Top SDET Qualified (≥60): ${report.jobs.topQualified}`);
  lines.push(`  • Near Misses (40–59): ${report.jobs.nearMisses}`);
  lines.push(`  • Closed / Stale: ${report.jobs.closed}`);

  if (report.jobs.topOpportunities.length > 0) {
    lines.push('');
    lines.push('⭐ Top Matching Roles:');
    for (const job of report.jobs.topOpportunities) {
      const loc = job.location ? ` - ${job.location}` : '';
      const remote = job.isRemote ? ' [Remote]' : '';
      lines.push(`  • ${job.title} @ ${job.company} (Score: ${job.score})${loc}${remote}`);
    }
  }

  lines.push('');
  lines.push('👥 Human Contacts:');
  lines.push(`  • Total Discovered: ${report.contacts.total}`);
  lines.push(`  • Verified: ${report.contacts.verified}`);
  lines.push(`  • Pending Verification: ${report.contacts.pendingVerification}`);

  lines.push('');
  lines.push('✉️ Outreach Pipeline:');
  lines.push(`  • Pending Approvals: ${report.outreach.pendingApproval} drafts awaiting review`);
  lines.push(`  • Follow-ups Due: ${report.outreach.followUpsDue}`);
  lines.push(
    `  • Sent Today: ${report.outreach.sentToday} / ${report.outreach.dailyCap} max daily cap`
  );
  lines.push(`  • Replied: ${report.outreach.replied}`);
  lines.push(
    `  • Bounces: ${report.outreach.bounces} (Rate: ${(report.outreach.bounceRate * 100).toFixed(1)}%)`
  );

  lines.push('');
  lines.push('🎯 Recommended Actions:');
  for (const action of report.actionItems) {
    lines.push(`  • ${action}`);
  }

  return lines.join('\n');
}

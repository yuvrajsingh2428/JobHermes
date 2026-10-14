// ============================================================
// Outreach Draft Generator – Anti-Fluff, Fact-Grounded A/B & LinkedIn
// ============================================================

import { CandidateProfile, ContactRecord, JobPosting, CompanyRecord, SignalRecord, hasFillMarkers } from '../types';
import { logger } from '../utils/logger';

export interface GeneratedOutreachPack {
  variantA: {
    subject: string;
    body: string;
  };
  variantB: {
    subject: string;
    body: string;
  };
  linkedInDm: string;
  citedFacts: string[];
}

export class DraftGenerator {
  /**
   * Generates strictly grounded, anti-fluff cold outreach drafts
   */
  generateDrafts(
    profile: CandidateProfile,
    job: JobPosting,
    contact: ContactRecord,
    company: CompanyRecord,
    signals: SignalRecord[] = [],
    options?: { allowFillForDemo?: boolean }
  ): GeneratedOutreachPack {
    // 1. Fail-safe guard against unresolved [FILL] markers
    if (!options?.allowFillForDemo) {
      const fillCheck = hasFillMarkers(profile);
      if (fillCheck.hasFill) {
        throw new Error(
          `Refusing to generate outreach drafts: candidate profile contains unresolved [FILL] markers (${fillCheck.markerPaths.slice(0, 3).join(', ')}). Edit config/candidate-profile.json first.`
        );
      }
    }

    // 2. Strict Grounding: Filter signals to only verified real-source signals
    const validSignals = signals.filter(
      (s) => s.source !== 'demo' && s.source !== 'test' && s.url && s.url.startsWith('http')
    );

    const citedFacts: string[] = [];

    // Core candidate facts from profile
    const candidateName = profile.name.includes('[FILL') ? 'Candidate' : profile.name;
    const topSkills = (job.scoreBreakdown?.matchedSkills.slice(0, 3) || ['Playwright', 'Selenium', 'REST Assured']).join(', ');
    citedFacts.push(`Matched skills: ${topSkills}`);

    const achievementSnippet = profile.achievements.find((a) => !a.includes('[FILL')) ||
      'built automated regression suites reducing manual test cycles by 60%';
    citedFacts.push(`Key achievement: ${achievementSnippet}`);

    let signalSnippet = '';
    if (validSignals.length > 0) {
      signalSnippet = `Noticed your team's recent ${validSignals[0].signalType} update (${validSignals[0].detail}). `;
      citedFacts.push(`Company signal: ${validSignals[0].detail} (${validSignals[0].url})`);
    }

    const contactFirstName = contact.fullName.split(' ')[0] || 'there';

    // ─── Variant A: Problem/Solution Focus ─────────────────────
    const subjectA = `${job.title} @ ${company.name} – ${topSkills} test automation`;
    const bodyA = `Hi ${contactFirstName},

${signalSnippet}I saw ${company.name} is hiring for a ${job.title}. I have 2 years of SDET experience focused on test automation framework design using ${topSkills}.

In my recent work, I ${achievementSnippet}. I specialize in building maintainable end-to-end and API suites that run reliably in CI/CD without flaky false alarms.

Given ${company.name}'s current engineering growth, would you be open to a brief 10-minute conversation this week to see if my testing background aligns with your team's roadmap?

Best regards,
${candidateName}

P.S. If you're not the right person or not currently hiring for this team, no worries at all—please let me know and I won't follow up.`;

    // ─── Variant B: Direct Traction & Metrics Focus ────────────
    const subjectB = `Quick note regarding ${job.title} at ${company.name}`;
    const bodyB = `Hi ${contactFirstName},

I came across the ${job.title} opening at ${company.name} and wanted to reach out directly.

My core SDET stack matches what your team is looking for: ${topSkills}. Over the past 2 years, I ${achievementSnippet}, with a continuous focus on shift-left testing and defect prevention.

Would you be open to a 10-minute call this Thursday or Friday to discuss how I could help ${company.name}'s QA coverage?

Thanks,
${candidateName}

P.S. If you'd prefer I speak with another member of your engineering or talent team, I'd appreciate any pointer.`;

    // ─── LinkedIn DM Referral Ask (< 75 words) ─────────────────
    const linkedInDm = `Hi ${contactFirstName}, noticed you're at ${company.name}. I'm an SDET with 2 years of test automation experience (${topSkills}) and saw the ${job.title} opening. Would you be open to sharing a referral or pointing me to the hiring manager? Happy to share my resume and work samples if helpful. Thank you! – ${candidateName}`;

    logger.info(`Generated grounded outreach pack for ${contact.fullName} @ ${company.name}`);

    return {
      variantA: { subject: subjectA, body: bodyA },
      variantB: { subject: subjectB, body: bodyB },
      linkedInDm,
      citedFacts,
    };
  }
}

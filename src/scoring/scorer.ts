// ============================================================
// SDET Job Scoring Service – 100-Point Target Model
// ============================================================

import { CandidateProfile, JobPosting, RawJob, ScoreBreakdown } from '../types';
import { extractSkillsFromText } from './skill-synonyms';
import { parseExperienceRequirement, parseSalaryLPA } from './parsers';
import { logger } from '../utils/logger';

export interface ScoringContext {
  companyOpenQaCount?: number;
  hasCompanySignal?: boolean;
  signalType?: string;
  signalDetail?: string;
}

export class ScoringService {
  /**
   * Scores a single job posting against an SDET candidate profile
   */
  scoreJob(job: RawJob, profile: CandidateProfile, context?: ScoringContext): ScoreBreakdown {
    const reasons: string[] = [];
    let stretch = false;

    // 1. Title Match (0-25)
    const { points: titlePoints, reason: titleReason } = this.scoreTitleMatch(job.title, job.description);
    reasons.push(`Title: ${titleReason}`);

    // 2. Skill Match (0-30)
    const { points: skillPoints, reason: skillReason, matchedSkills, missingSkills } = this.scoreSkillMatch(
      job,
      profile
    );
    reasons.push(`Skills: ${skillReason}`);

    // 3. Experience Fit (0-15)
    const { points: expPoints, reason: expReason, isStretch: expStretch } = this.scoreExperienceFit(
      job.description,
      profile
    );
    if (expStretch) stretch = true;
    reasons.push(`Experience: ${expReason}`);

    // 4. Location Fit (0-10)
    const { points: locPoints, reason: locReason } = this.scoreLocationFit(job.location, job.isRemote, profile);
    reasons.push(`Location: ${locReason}`);

    // 5. Freshness (0-10)
    const { points: freshPoints, reason: freshReason } = this.scoreFreshness(job.postedAt);
    reasons.push(`Freshness: ${freshReason}`);

    // 6. Hiring Signal Bonus (0-10)
    const { points: signalPoints, reason: signalReason } = this.scoreHiringSignal(context);
    reasons.push(`Signal: ${signalReason}`);

    // 7. Salary Bonus (0-5)
    const { points: salaryPoints, reason: salaryReason } = this.scoreSalaryBonus(job.rawSalary, profile);
    if (salaryPoints > 0) {
      reasons.push(`Salary: ${salaryReason}`);
    }

    const total = titlePoints === 0
      ? 0
      : Math.min(100, titlePoints + skillPoints + expPoints + locPoints + freshPoints + signalPoints + salaryPoints);

    return {
      titleMatch: titlePoints,
      skillMatch: skillPoints,
      experienceFit: expPoints,
      locationFit: locPoints,
      freshness: freshPoints,
      hiringSignal: signalPoints,
      salaryMatch: salaryPoints,
      total: Math.round(total),
      reasons,
      matchedSkills,
      missingSkills,
      stretch,
    };
  }

  // ─── 1. Title Match (25) ───────────────────────────────────

  private scoreTitleMatch(title: string, description: string): { points: number; reason: string } {
    const t = title.toLowerCase();

    // Check manual-only exclusion
    if (/\b(manual tester|manual qa|manual testing)\b/i.test(t)) {
      return { points: 0, reason: 'Manual-only role (0/25)' };
    }

    // Strong SDET / Automation titles
    if (
      /\b(sdet|software (?:development )?engineer in test|qa automation|test automation|automation test engineer|set)\b/i.test(t) ||
      (/\b(qa|test|quality)\b/i.test(t) && /\bautomation\b/i.test(t)) ||
      (/\bqa engineer\b/i.test(t) && /\bautomation\b/i.test(t))
    ) {
      return { points: 25, reason: `Exact SDET/Automation title match "${title}" (25/25)` };
    }

    // QA / Test Engineer with automation mentioned in description
    if (/\b(qa|quality engineer|test engineer|quality assurance engineer|software test engineer)\b/i.test(t)) {
      const hasAutomationInDesc = /\b(selenium|playwright|cypress|rest assured|automation|framework)\b/i.test(description);
      if (hasAutomationInDesc) {
        return { points: 18, reason: `QA title with automation stack in description (18/25)` };
      }
      return { points: 8, reason: `General QA title without prominent automation emphasis (8/25)` };
    }

    // Unrelated non-QA title
    return { points: 0, reason: `Unrelated non-QA title "${title}" (0/25)` };
  }

  // ─── 2. Skill Match (30) ───────────────────────────────────

  private scoreSkillMatch(
    job: RawJob,
    profile: CandidateProfile
  ): { points: number; reason: string; matchedSkills: string[]; missingSkills: string[] } {
    const fullText = `${job.title}\n${job.description}`;
    const { canonicalSkills } = extractSkillsFromText(fullText);

    const allCandidateSkills = [
      ...profile.skills.languages,
      ...profile.skills.automationTools,
      ...profile.skills.frameworks,
      ...profile.skills.devopsAndCiCd,
      ...profile.skills.methodologies,
    ];

    const candidateSkillSet = new Set(allCandidateSkills.map((s) => s.toLowerCase()));

    const matched: string[] = [];
    const missing: string[] = [];

    for (const skill of canonicalSkills) {
      if (candidateSkillSet.has(skill.toLowerCase())) {
        matched.push(skill);
      } else {
        missing.push(skill);
      }
    }

    // Weight primary SDET anchors
    const primaryAnchors = ['Selenium', 'Playwright', 'REST Assured', 'TestNG', 'Jenkins', 'Java', 'Python', 'Cypress'];
    const matchedAnchors = matched.filter((s) => primaryAnchors.includes(s));

    let points = 0;
    if (canonicalSkills.length === 0) {
      points = 12; // Unspecified skills neutral mid
    } else {
      const matchRatio = matched.length / Math.max(canonicalSkills.length, 1);
      // Anchor bonus
      const anchorPoints = Math.min(15, matchedAnchors.length * 3);
      points = Math.min(30, Math.round(matchRatio * 15 + anchorPoints));
    }

    const reason = `${matched.length} skills matched (${matched.slice(0, 4).join(', ') || 'none'}) of ${canonicalSkills.length} requested (${points}/30)`;

    return { points, reason, matchedSkills: matched, missingSkills: missing };
  }

  // ─── 3. Experience Fit (15) ────────────────────────────────

  private scoreExperienceFit(description: string, _profile: CandidateProfile): { points: number; reason: string; isStretch: boolean } {
    const parsed = parseExperienceRequirement(description);

    if (parsed.isFresher) {
      return { points: 14, reason: `Entry-level / Fresher position (${parsed.rawMatch}) (14/15)`, isStretch: false };
    }

    if (parsed.minYears === null) {
      return { points: 10, reason: 'No specific experience requirement stated in JD (10/15)', isStretch: false };
    }

    const min = parsed.minYears;
    const max = parsed.maxYears ?? min + 2;

    // Within candidate sweet spot (1-3 YOE)
    if (min <= 3 && max >= 1) {
      return { points: 15, reason: `Requirement [${parsed.rawMatch}] fits candidate 1-3 YOE sweet spot (15/15)`, isStretch: false };
    }

    // Moderate requirement (up to 4-5 YOE) -> stretch opportunity
    if (min <= 5) {
      return { points: 9, reason: `Requirement [${parsed.rawMatch}] is a reasonable stretch opportunity (9/15)`, isStretch: true };
    }

    // High experience requirement (6+ YOE)
    return { points: 3, reason: `Requirement [${parsed.rawMatch}] exceeds early-career target (3/15)`, isStretch: true };
  }

  // ─── 4. Location Fit (10) ──────────────────────────────────

  private scoreLocationFit(location: string, isRemote: boolean, _profile: CandidateProfile): { points: number; reason: string } {
    const loc = location.toLowerCase();

    // Remote
    if (isRemote || loc.includes('remote')) {
      return { points: 10, reason: 'Remote location matches candidate preference (10/10)' };
    }

    // Preferred primary hubs: Delhi NCR / Gurgaon / Noida / Delhi / Bangalore
    const preferred = ['gurgaon', 'gurugram', 'noida', 'delhi', 'bangalore', 'bengaluru'];
    if (preferred.some((p) => loc.includes(p))) {
      return { points: 10, reason: `Target location "${location}" (Delhi NCR / Bangalore) (10/10)` };
    }

    // India general
    if (loc.includes('india')) {
      return { points: 8, reason: `Location "${location}" within India (8/10)` };
    }

    // Other known Indian tech hubs (Pune, Hyderabad, Mumbai, Chennai)
    const otherHubs = ['pune', 'hyderabad', 'mumbai', 'chennai'];
    if (otherHubs.some((h) => loc.includes(h))) {
      return { points: 6, reason: `Location "${location}" in other Indian tech hub (6/10)` };
    }

    // Unspecified
    if (!loc) {
      return { points: 7, reason: 'Location unspecified (7/10)' };
    }

    return { points: 2, reason: `Non-preferred on-site location "${location}" (2/10)` };
  }

  // ─── 5. Freshness (10) ─────────────────────────────────────

  private scoreFreshness(postedAt?: string): { points: number; reason: string } {
    if (!postedAt) {
      return { points: 4, reason: 'Posting date unlisted (4/10)' };
    }

    const postedTime = new Date(postedAt).getTime();
    if (isNaN(postedTime)) {
      return { points: 4, reason: 'Posting date unparseable (4/10)' };
    }

    const ageDays = (Date.now() - postedTime) / (1000 * 60 * 60 * 24);

    if (ageDays <= 3) {
      return { points: 10, reason: `Fresh posting (posted <3 days ago) (10/10)` };
    }
    if (ageDays <= 7) {
      return { points: 7, reason: `Posted within last 7 days (~${Math.round(ageDays)}d ago) (7/10)` };
    }
    if (ageDays <= 14) {
      return { points: 4, reason: `Posted within last 14 days (~${Math.round(ageDays)}d ago) (4/10)` };
    }

    return { points: 1, reason: `Older posting (>14 days ago) (1/10)` };
  }

  // ─── 6. Hiring Signal Bonus (10) ───────────────────────────

  private scoreHiringSignal(context?: ScoringContext): { points: number; reason: string } {
    if (context?.hasCompanySignal) {
      if (context.signalType === 'layoffs') {
        return { points: 0, reason: `Company signal indicates recent layoffs (${context.signalDetail}) (0/10)` };
      }
      return {
        points: 10,
        reason: `Recorded company signal [${context.signalType || 'growth'}]: "${context.signalDetail || 'funding/growth'}" (10/10)`,
      };
    }

    if (context?.companyOpenQaCount && context.companyOpenQaCount >= 2) {
      return { points: 10, reason: `Multiple active QA/SDET openings (${context.companyOpenQaCount} roles) at company (10/10)` };
    }

    return { points: 0, reason: 'No multiple open QA roles or hiring signal recorded (0/10)' };
  }

  // ─── 7. Salary Match Bonus (0-5) ───────────────────────────

  private scoreSalaryBonus(rawSalary?: string, profile?: CandidateProfile): { points: number; reason: string } {
    if (!rawSalary) return { points: 0, reason: 'No salary listed' };

    const parsed = parseSalaryLPA(rawSalary);
    if (!parsed.minLpa) return { points: 0, reason: 'Salary format not parseable to LPA' };

    const minAcceptable = typeof profile?.minSalaryLPA === 'number' ? profile.minSalaryLPA : 12;

    if (parsed.minLpa >= minAcceptable) {
      return { points: 5, reason: `Listed salary (${parsed.minLpa} LPA) meets target (>=${minAcceptable} LPA) (+5)` };
    }

    return { points: 0, reason: `Listed salary (${parsed.minLpa} LPA) below target` };
  }

  scoreAll(jobs: RawJob[], profile: CandidateProfile, companyContexts?: Map<string, ScoringContext>): JobPosting[] {
    logger.info(`Scoring ${jobs.length} jobs with 100-pt SDET scoring engine...`);

    const scored: JobPosting[] = jobs.map((job) => {
      const ctx = companyContexts?.get(job.company.toLowerCase());
      const breakdown = this.scoreJob(job, profile, ctx);

      return {
        ...job,
        scrapedAt: new Date().toISOString(),
        status: 'new' as const,
        isApplied: false,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        stretch: breakdown.stretch,
        reasons: breakdown.reasons,
      };
    });

    // Sort descending by score
    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return scored;
  }
}

export const scoringService = new ScoringService();

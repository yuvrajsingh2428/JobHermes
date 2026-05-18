// ============================================================
// Job Scoring Service – Multi-dimensional relevance scoring
// ============================================================

import { JobPosting, CandidateProfile, ScoreBreakdown } from '../types';
import { logger } from '../utils/logger';
import { calculateSetOverlap, parseSalaryLPA } from '../utils/helpers';

const HIGH_PRESTIGE_COMPANIES = new Set([
  'google', 'microsoft', 'amazon', 'meta', 'apple', 'netflix', 'uber', 'airbnb',
  'stripe', 'openai', 'anthropic', 'deepmind', 'nvidia', 'salesforce', 'atlassian',
  'flipkart', 'swiggy', 'zomato', 'razorpay', 'zepto', 'cred', 'meesho',
  'byju', 'unacademy', 'ola', 'paytm', 'phonepe', 'groww',
]);

export class ScoringService {
  // ─── Main Scoring Method ───────────────────────────────────

  scoreJob(job: JobPosting, profile: CandidateProfile): ScoreBreakdown {
    const skillMatch = this.scoreSkillMatch(job, profile);
    const titleMatch = this.scoreTitleMatch(job, profile);
    const locationMatch = this.scoreLocationMatch(job, profile);
    const experienceMatch = this.scoreExperienceMatch(job, profile);
    const salaryMatch = this.scoreSalaryMatch(job, profile);
    const companyPrestige = this.scoreCompanyPrestige(job);

    const total = Math.min(
      100,
      skillMatch + titleMatch + locationMatch + experienceMatch + salaryMatch + companyPrestige
    );

    return {
      skillMatch,
      titleMatch,
      locationMatch,
      experienceMatch,
      salaryMatch,
      companyPrestige,
      total: Math.round(total),
    };
  }

  scoreAll(jobs: JobPosting[], profile: CandidateProfile): JobPosting[] {
    logger.info(`Scoring ${jobs.length} jobs against candidate profile`);

    const scored = jobs.map((job) => {
      const breakdown = this.scoreJob(job, profile);
      return {
        ...job,
        score: breakdown.total,
        scoreBreakdown: breakdown,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    logger.success(`Scoring complete. Top score: ${scored[0]?.score ?? 0}`);
    return scored;
  }

  // ─── Skill Match (0-30) ────────────────────────────────────

  private scoreSkillMatch(job: JobPosting, profile: CandidateProfile): number {
    const allProfileSkills = [
      ...profile.skills.languages,
      ...profile.skills.frontend,
      ...profile.skills.backend,
      ...profile.skills.databases,
      ...profile.skills.cloud,
      ...profile.skills.tools,
    ].map((s) => s.toLowerCase());

    const text = `${job.title} ${job.description}`.toLowerCase();

    let matches = 0;
    for (const skill of allProfileSkills) {
      if (text.includes(skill.toLowerCase())) matches++;
    }

    if (allProfileSkills.length === 0) return 15; // Default mid-score

    // If job has explicit skills array, also compare those
    if (job.skills && job.skills.length > 0) {
      const overlap = calculateSetOverlap(allProfileSkills, job.skills);
      return Math.round(Math.min(30, (overlap * 30 + (matches / allProfileSkills.length) * 30) / 2));
    }

    const ratio = Math.min(matches, allProfileSkills.length) / allProfileSkills.length;
    return Math.round(ratio * 30);
  }

  // ─── Title Match (0-20) ────────────────────────────────────

  private scoreTitleMatch(job: JobPosting, profile: CandidateProfile): number {
    const jobTitleLower = job.title.toLowerCase();

    // Exact or near-exact match with target roles
    for (const targetRole of profile.targetRoles) {
      const target = targetRole.toLowerCase();
      if (jobTitleLower.includes(target) || target.includes(jobTitleLower)) {
        return 20;
      }
    }

    // Partial keyword matches
    const roleKeywords = profile.targetRoles.flatMap((r) => r.toLowerCase().split(' '));
    const titleWords = jobTitleLower.split(/\s+/);
    const matchCount = titleWords.filter((w) => roleKeywords.includes(w)).length;

    if (matchCount > 0) {
      return Math.round(Math.min(20, matchCount * 7));
    }

    // Check for generic tech role keywords
    const genericKeywords = ['engineer', 'developer', 'sde', 'swe', 'software', 'backend', 'frontend', 'fullstack'];
    const hasGeneric = genericKeywords.some((k) => jobTitleLower.includes(k));

    return hasGeneric ? 8 : 0;
  }

  // ─── Location Match (0-15) ─────────────────────────────────

  private scoreLocationMatch(job: JobPosting, profile: CandidateProfile): number {
    const jobLocation = job.location.toLowerCase();

    // Remote
    if (jobLocation.includes('remote') && profile.openToRemote) return 15;
    if (jobLocation.includes('remote')) return 12;

    // Exact preferred location
    for (const pref of profile.preferredLocations) {
      if (jobLocation.includes(pref.toLowerCase())) return 15;
    }

    // India (general) - acceptable
    if (jobLocation.includes('india')) return 10;

    // Unknown / blank location
    if (!jobLocation || jobLocation === '') return 8;

    return 5; // Other location
  }

  // ─── Experience Match (0-15) ───────────────────────────────

  private scoreExperienceMatch(job: JobPosting, profile: CandidateProfile): number {
    const expText = (job.experienceRequired || job.description || '').toLowerCase();

    const rangeMatch = expText.match(/(\d+)\s*[-–to]+\s*(\d+)\s*(?:yrs?|years?)/i);
    if (rangeMatch) {
      const min = parseInt(rangeMatch[1]);
      const max = parseInt(rangeMatch[2]);
      const myExp = profile.maxExperienceYears;

      if (myExp >= min && myExp <= max) return 15;
      if (myExp >= min - 1 && myExp <= max + 1) return 10;
      return 5;
    }

    const singleMatch = expText.match(/(\d+)\+?\s*(?:yrs?|years?)/i);
    if (singleMatch) {
      const required = parseInt(singleMatch[1]);
      const myExp = profile.maxExperienceYears;

      if (myExp >= required) return 15;
      if (myExp >= required - 1) return 10;
      return 5;
    }

    // No experience info — neutral
    return 8;
  }

  // ─── Salary Match (0-10) ───────────────────────────────────

  private scoreSalaryMatch(job: JobPosting, profile: CandidateProfile): number {
    if (!job.salary) return 5; // Unknown salary — neutral

    const parsed = parseSalaryLPA(job.salary);
    if (!parsed) return 5;

    if (parsed >= profile.minSalaryLPA) return 10;
    if (parsed >= profile.minSalaryLPA * 0.8) return 6;
    return 2;
  }

  // ─── Company Prestige (0-10) ───────────────────────────────

  private scoreCompanyPrestige(job: JobPosting): number {
    const companyLower = job.company.toLowerCase().replace(/\s+/g, '');

    for (const prestigious of HIGH_PRESTIGE_COMPANIES) {
      if (companyLower.includes(prestigious) || prestigious.includes(companyLower)) {
        return 10;
      }
    }

    return 5; // Unknown company — mid prestige
  }

  // ─── Filtering ─────────────────────────────────────────────

  filterByThreshold(jobs: JobPosting[], minScore: number): JobPosting[] {
    return jobs.filter((j) => (j.score ?? 0) >= minScore);
  }

  getScoreDistribution(jobs: JobPosting[]): { range: string; count: number }[] {
    const ranges = [
      { range: '90-100', min: 90, max: 100 },
      { range: '80-89', min: 80, max: 89 },
      { range: '70-79', min: 70, max: 79 },
      { range: '60-69', min: 60, max: 69 },
      { range: 'Below 60', min: 0, max: 59 },
    ];

    return ranges.map(({ range, min, max }) => ({
      range,
      count: jobs.filter((j) => {
        const s = j.score ?? 0;
        return s >= min && s <= max;
      }).length,
    }));
  }
}

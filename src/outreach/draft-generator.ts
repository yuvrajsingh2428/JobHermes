// ============================================================
// Outreach Draft Generator – Anti-Fluff, Fact-Grounded A/B & LinkedIn
// ============================================================

import {
  CandidateProfile,
  ContactRecord,
  JobPosting,
  CompanyRecord,
  SignalRecord,
  hasFillMarkers,
  getProfileAchievements,
} from '../types';
import { logger } from '../utils/logger';

export interface DraftLintResult {
  valid: boolean;
  warnings: string[];
  wordCount: number;
  subjectWordCount: number;
  hasFluff: boolean;
  fluffMatches: string[];
  hasProofPoint: boolean;
  hasSingleAsk: boolean;
  hasOptOut: boolean;
  hasUnsupportedClaims?: boolean;
}

export interface GeneratedOutreachPack {
  variantA: {
    subject: string;
    body: string;
    lint: DraftLintResult;
  };
  variantB: {
    subject: string;
    body: string;
    lint: DraftLintResult;
  };
  linkedInDm: string;
  linkedInWordCount: number;
  citedFacts: string[];
}

export const FLUFF_PATTERNS = [
  /\bhope this (?:email|message) finds you well\b/i,
  /\bhope you(?:'re| are) doing well\b/i,
  /\bwriting to express my interest\b/i,
  /\bI am writing regarding\b/i,
  /\bwriting regarding\b/i,
  /\bthrilled to apply\b/i,
  /\bpassionate about\b/i,
  /\bsynergy\b/i,
  /\bhit the ground running\b/i,
  /\bself-starter\b/i,
  /\bteam player\b/i,
  /\bdynamic\b/i,
  /\bgive 110%\b/i,
  /\btouching base\b/i,
  /\bthought leader\b/i,
  /\bgo-getter\b/i,
];

/**
 * Validates a cold outreach draft against strict quality rules:
 * - Subject under 8 words (< 8 words)
 * - Body 80-120 words
 * - Zero fluff phrases
 * - At least one concrete metric / proof point
 * - Exactly one call-to-action ask (?)
 * - Polite opt-out line
 * - Grounding: flags unsupported company claims (focus on, known for, scalable, platform, growth, etc.) without verified signal/brief
 */
export function lintOutreachDraft(
  subject: string,
  body: string,
  context?: { hasSignal?: boolean; hasBrief?: boolean }
): DraftLintResult {
  const warnings: string[] = [];

  const subjectWords = subject.trim().split(/\s+/).filter(Boolean);
  const subjectWordCount = subjectWords.length;
  if (subjectWordCount >= 8) {
    warnings.push(`Subject exceeds 7 words (${subjectWordCount} words; must be under 8 words)`);
  }

  const words = body.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount < 80) {
    warnings.push(`Draft body is under 80 words (${wordCount} words; target is 80-120)`);
  } else if (wordCount > 120) {
    warnings.push(`Draft body exceeds 120 words (${wordCount} words; target is 80-120)`);
  }

  // Fluff detection
  const fluffMatches: string[] = [];
  for (const pattern of FLUFF_PATTERNS) {
    const match = body.match(pattern);
    if (match) fluffMatches.push(match[0]);
  }
  if (fluffMatches.length > 0) {
    warnings.push(`Fluff phrase detected: "${fluffMatches.join('", "')}"`);
  }

  // Grounding check for unbacked company claims
  const companyClaimPatterns = [
    /\b((?:company|team|headcount) is (?:expanding|scaling)|expanding (?:its|the|team|headcount)|scaling (?:its|the|team|headcount)|rapidly scaling|company growth|business growth|doubling headcount|funding|series [a-z]|raised [$\d])\b/i,
    /\b(focus(?:ed|ing)? on|known for|given [a-z0-9'\s]+'s|your platform(?:s)?|platforms?|scalable)\b/i,
    /\b(quality initiatives|engineering goals|company mission)\b/i,
  ];

  let unbackedClaim: string | null = null;
  if (context && !context.hasSignal && !context.hasBrief) {
    for (const pattern of companyClaimPatterns) {
      const match = body.match(pattern);
      if (match) {
        unbackedClaim = match[0];
        break;
      }
    }
  }
  const hasUnsupportedClaims = Boolean(unbackedClaim);
  if (hasUnsupportedClaims && unbackedClaim) {
    warnings.push(
      `Draft contains unsupported company claim ("${unbackedClaim}") without a verified signal URL or research brief`
    );
  }

  // Proof point check (numbers, percentages, metrics)
  const proofPattern =
    /(\b\d+%\b|\b\d+\s*x\b|\breduc(?:ed|ing)\b|\barchitected\b|\bincreased\b|\bcut\b|\bfrom \d+ to \d+\b|\b\d+ years\b)/i;
  const hasProofPoint = proofPattern.test(body);
  if (!hasProofPoint) {
    warnings.push('Missing concrete proof point or quantitative achievement');
  }

  // Exactly one call-to-action ask
  const questionMarks = (body.match(/\?/g) || []).length;
  const hasSingleAsk = questionMarks === 1;
  if (questionMarks === 0) {
    warnings.push('Missing call-to-action ask (?)');
  } else if (questionMarks > 1) {
    warnings.push(`Found ${questionMarks} questions (must have exactly one clear ask)`);
  }

  // Opt-out line check
  const optOutPattern = /(no worries|won't follow up|not hiring|wrong person|feel free to ignore)/i;
  const hasOptOut = optOutPattern.test(body);
  if (!hasOptOut) {
    warnings.push('Missing polite opt-out line (e.g. in P.S.)');
  }

  return {
    valid: warnings.length === 0,
    warnings,
    wordCount,
    subjectWordCount,
    hasFluff: fluffMatches.length > 0,
    fluffMatches,
    hasProofPoint,
    hasSingleAsk,
    hasOptOut,
    hasUnsupportedClaims,
  };
}

export class DraftGenerator {
  /**
   * Generates strictly grounded, anti-fluff cold outreach drafts compliant with quality rules
   */
  generateDrafts(
    profile: CandidateProfile,
    job: JobPosting,
    contact: ContactRecord,
    company: CompanyRecord,
    signals: SignalRecord[] = [],
    options?: { allowFillForDemo?: boolean }
  ): GeneratedOutreachPack {
    // 1. Fail-safe guard against unresolved [FILL] markers and demo values
    const allAchievements = getProfileAchievements(profile);

    if (!options?.allowFillForDemo) {
      const fillCheck = hasFillMarkers(profile);
      if (fillCheck.hasFill) {
        throw new Error(
          `Refusing to generate outreach drafts: candidate profile contains unresolved [FILL] markers (${fillCheck.markerPaths.slice(0, 3).join(', ')}). Edit config/candidate-profile.json first.`
        );
      }

      // Real-mode guard: achievements must not be empty, placeholders, or carry source="demo"
      const hasInvalidAchievements =
        allAchievements.length === 0 ||
        allAchievements.every((a) => a.text.includes('[FILL') || a.source === 'demo');

      if (hasInvalidAchievements) {
        throw new Error(
          'Refusing to generate outreach in real mode: candidate achievements contain placeholders or are flagged with source="demo". Update your achievements with real experience in config/candidate-profile.json.'
        );
      }
    }

    // 2. Strict Grounding: Filter signals to only verified real-source signals with URLs
    const validSignals = signals.filter(
      (s) =>
        (options?.allowFillForDemo || (s.source !== 'demo' && s.source !== 'test')) &&
        s.url &&
        s.url.startsWith('http')
    );

    const citedFacts: string[] = [];

    // Core candidate facts from profile
    let candidateName = profile.name;
    if (!options?.allowFillForDemo) {
      if (
        !candidateName ||
        candidateName.includes('[FILL') ||
        candidateName.toLowerCase().trim() === 'candidate'
      ) {
        throw new Error(
          `Refusing to generate outreach in real mode: candidate name "${candidateName || ''}" is invalid or a placeholder. Set your real name in config/candidate-profile.json.`
        );
      }
    } else {
      if (!candidateName || candidateName.includes('[FILL')) {
        candidateName = 'Candidate';
      }
    }

    const topSkills = (
      job.scoreBreakdown?.matchedSkills.slice(0, 3) || ['Playwright', 'Selenium', 'REST Assured']
    ).join(', ');
    citedFacts.push(`Matched skills: ${topSkills}`);

    const years = profile.experienceYears || 2;
    citedFacts.push(`Experience: ${years} years`);

    let achievementSnippet = '';
    let secondAchievement = '';

    if (options?.allowFillForDemo) {
      // Demo sandbox fallback achievements
      achievementSnippet =
        allAchievements.find((a) => !a.text.includes('[FILL'))?.text ||
        'built automated regression suites reducing manual test cycles by 60%';
      secondAchievement =
        allAchievements.filter((a) => !a.text.includes('[FILL'))[1]?.text ||
        'built hybrid automation framework reducing execution time by 45%';
    } else {
      const realAchievements = allAchievements.filter(
        (a) => !a.text.includes('[FILL') && a.source !== 'demo'
      );
      if (realAchievements.length === 0) {
        throw new Error(
          'Refusing to generate outreach in real mode: candidate achievements contain placeholders or are flagged with source="demo". Update your achievements with real experience in config/candidate-profile.json.'
        );
      }
      achievementSnippet = realAchievements[0].text;
      secondAchievement = realAchievements[1]?.text || '';
    }

    citedFacts.push(`Key achievement: ${achievementSnippet}`);
    if (secondAchievement) citedFacts.push(`Secondary achievement: ${secondAchievement}`);

    let companyContextSnippet = '';
    let briefObj: any = null;
    if (company.researchBrief) {
      try {
        briefObj =
          typeof company.researchBrief === 'string'
            ? JSON.parse(company.researchBrief)
            : company.researchBrief;
      } catch {
        // Plain string
      }
    }

    if (validSignals.length > 0 && briefObj?.recentSpecificThing) {
      companyContextSnippet = `Following ${company.name}'s work on ${briefObj.recentSpecificThing} and your team's update regarding ${validSignals[0].detail}, `;
      citedFacts.push(`Company brief: ${briefObj.recentSpecificThing}`);
      citedFacts.push(`Company signal: ${validSignals[0].detail} (${validSignals[0].url})`);
    } else if (validSignals.length > 0) {
      companyContextSnippet = `Noticed your team's recent ${validSignals[0].signalType} update regarding ${validSignals[0].detail}. `;
      citedFacts.push(`Company signal: ${validSignals[0].detail} (${validSignals[0].url})`);
    } else if (briefObj?.recentSpecificThing) {
      companyContextSnippet = `I've been following ${company.name}'s work on ${briefObj.recentSpecificThing}. `;
      citedFacts.push(`Company brief: ${briefObj.recentSpecificThing}`);
    } else if (briefObj?.whatTheyBuild) {
      companyContextSnippet = `I've been following ${company.name}'s work on ${briefObj.whatTheyBuild}. `;
      citedFacts.push(`Company brief: ${briefObj.whatTheyBuild}`);
    }

    const contactFirstName = contact.fullName.split(' ')[0] || 'there';

    // ─── Variant A: Problem/Solution & Framework Architecture Focus ─
    // Subject rule: under 8 words (< 8 words)
    const subjectA = `SDET test automation @ ${company.name}`;
    const openingA = companyContextSnippet
      ? `${companyContextSnippet}Over the past ${years} years, I have specialized in test automation with ${topSkills}.`
      : `I came across the ${job.title} role at ${company.name} and wanted to reach out directly. Over the past ${years} years, I have specialized in test automation with ${topSkills}.`;

    const bodyA = [
      `Hi ${contactFirstName},`,
      ``,
      openingA,
      ``,
      `In my recent role, I ${achievementSnippet}. Additionally, I ${secondAchievement.toLowerCase()}.`,
      ``,
      `Would you be open to a brief 10-minute conversation next week to see if my testing background aligns with your team's needs?`,
      ``,
      `Best regards,`,
      `${candidateName}`,
      ``,
      `P.S. If you're not the right person or not currently hiring for this team, no worries at all—please let me know and I won't follow up.`,
    ].join('\n');

    // ─── Variant B: Direct Traction & Metrics Focus ────────────
    // Subject rule: under 8 words (< 8 words)
    const subjectB = `Quick note: SDET @ ${company.name}`;
    const openingB = companyContextSnippet
      ? `I saw the ${job.title} opening at ${company.name}. ${companyContextSnippet.trim()}`
      : `I saw the ${job.title} opening at ${company.name} and wanted to reach out directly.`;

    const bodyB = [
      `Hi ${contactFirstName},`,
      ``,
      openingB,
      ``,
      `My core test stack matches your requirements: ${topSkills}. Over the past ${years} years, I ${achievementSnippet}. I also ${secondAchievement.toLowerCase()}.`,
      ``,
      `Would you be open to a brief 10-minute conversation next week to discuss how my test automation experience could support your team?`,
      ``,
      `Thanks,`,
      `${candidateName}`,
      ``,
      `P.S. If you'd prefer I speak with another member of your engineering team, no worries at all and I'd appreciate any pointer.`,
    ].join('\n');

    // ─── LinkedIn DM Referral Ask (< 75 words) ─────────────────
    const linkedInDm = `Hi ${contactFirstName}, noticed you're at ${company.name}. I have ${years} years of test automation experience with ${topSkills} and saw the ${job.title} opening. Would you be open to pointing me to the hiring manager or sharing a referral? Happy to share details. Thank you! – ${candidateName}`;
    const linkedInWordCount = linkedInDm.trim().split(/\s+/).filter(Boolean).length;

    const contextLint = {
      hasSignal: validSignals.length > 0,
      hasBrief: Boolean(company.researchBrief),
    };

    const lintA = lintOutreachDraft(subjectA, bodyA, contextLint);
    const lintB = lintOutreachDraft(subjectB, bodyB, contextLint);

    logger.info(
      `Generated grounded outreach pack for ${contact.fullName} @ ${company.name} (Var A: ${lintA.wordCount}w, Var B: ${lintB.wordCount}w, DM: ${linkedInWordCount}w)`
    );

    return {
      variantA: { subject: subjectA, body: bodyA, lint: lintA },
      variantB: { subject: subjectB, body: bodyB, lint: lintB },
      linkedInDm,
      linkedInWordCount,
      citedFacts,
    };
  }
}

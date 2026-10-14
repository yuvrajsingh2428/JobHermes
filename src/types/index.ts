// ============================================================
// JobHermes SDET Copilot – Type Definitions & Zod Schemas
// ============================================================

import { z } from 'zod';

// ─── ATS & Company Targets ───────────────────────────────────

export const AtsProviderSchema = z.enum([
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'remotive',
  'remoteok',
  'custom',
]);

export type AtsProvider = z.infer<typeof AtsProviderSchema>;

export const CompanySizeBucketSchema = z.enum(['startup', 'mid', 'large']);
export type CompanySizeBucket = z.infer<typeof CompanySizeBucketSchema>;

export const CompanyTargetSchema = z.object({
  name: z.string(),
  domain: z.string(),
  ats: AtsProviderSchema,
  slug: z.string(),
  sizeBucket: CompanySizeBucketSchema,
  locations: z.array(z.string()).default([]),
  notes: z.string().optional(),
  enabled: z.boolean().default(true),
  verified: z.boolean().default(false),
  // Optional configuration for custom / Playwright fallback
  customUrl: z.string().optional(),
  listSelector: z.string().optional(),
  titleSelector: z.string().optional(),
  linkSelector: z.string().optional(),
});

export type CompanyTarget = z.infer<typeof CompanyTargetSchema>;

// ─── Raw & Normalized Jobs ───────────────────────────────────

export const RawJobSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string().default(''),
  isRemote: z.boolean().default(false),
  url: z.string().url().or(z.string()),
  description: z.string().default(''),
  postedAt: z.string().optional(),
  source: z.string(),
  rawSalary: z.string().optional(),
  externalId: z.string().optional(),
});

export type RawJob = z.infer<typeof RawJobSchema>;

export type ApplicationStatus =
  | 'new'
  | 'reviewed'
  | 'applied'
  | 'interviewing'
  | 'rejected'
  | 'offered'
  | 'accepted'
  | 'skipped';

export interface ScoreBreakdown {
  titleMatch: number;      // 0-25
  skillMatch: number;      // 0-30
  experienceFit: number;   // 0-15
  locationFit: number;     // 0-10
  freshness: number;       // 0-10
  hiringSignal: number;    // 0-10
  salaryMatch: number;     // 0-5
  total: number;           // 0-100
  reasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
  stretch: boolean;
}

export interface JobPosting extends RawJob {
  id?: number;
  scrapedAt: string;
  status: ApplicationStatus;
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  stretch?: boolean;
  reasons?: string[];
  isApplied: boolean;
  appliedAt?: string;
  notes?: string;
  salary?: string;
  jobType?: string;
  skills?: string[];
  experienceRequired?: string;
}

// ─── Candidate Profile Schema ────────────────────────────────

export const CandidateProfileSchema = z.object({
  name: z.string(),
  title: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
  portfolio: z.string().optional(),
  resumePdfPath: z.string().optional(),
  summary: z.string(),
  targetRoles: z.array(z.string()),
  experienceYears: z.number().default(2),
  minExperienceYears: z.number().default(1),
  maxExperienceYears: z.number().default(3),
  profile_reviewed: z.boolean().default(false),
  _skills_note: z.string().optional(),
  skills: z.object({
    languages: z.array(z.string()).default([]),
    automationTools: z.array(z.string()).default([]),
    frameworks: z.array(z.string()).default([]),
    devopsAndCiCd: z.array(z.string()).default([]),
    databases: z.array(z.string()).default([]),
    methodologies: z.array(z.string()).default([]),
    frontend: z.array(z.string()).optional().default([]),
    backend: z.array(z.string()).optional().default([]),
    cloud: z.array(z.string()).optional().default([]),
    tools: z.array(z.string()).optional().default([]),
  }),
  experience: z.array(z.object({
    company: z.string(),
    role: z.string(),
    duration: z.string(),
    highlights: z.array(z.string()),
  })).optional().default([]),
  education: z.array(z.object({
    institution: z.string(),
    degree: z.string(),
    year: z.string(),
  })).optional().default([]),
  certifications: z.array(z.string()).optional().default([]),
  preferredLocations: z.array(z.string()).default([]),
  openToRemote: z.boolean().default(true),
  minSalaryLPA: z.union([z.number(), z.string()]).default('[FILL]'),
  noticePeriodDays: z.number().default(30),
  achievements: z.array(z.string()).default([]),
});

export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;

/**
 * Checks whether candidate profile or resume contains any unresolved [FILL] markers
 */
export function hasFillMarkers(obj: unknown): { hasFill: boolean; markerPaths: string[] } {
  const markerPaths: string[] = [];

  function check(val: unknown, currentPath: string) {
    if (typeof val === 'string') {
      if (val.includes('[FILL')) {
        markerPaths.push(`${currentPath}: "${val}"`);
      }
    } else if (Array.isArray(val)) {
      val.forEach((item, index) => check(item, `${currentPath}[${index}]`));
    } else if (val && typeof val === 'object') {
      Object.entries(val).forEach(([k, v]) => check(v, currentPath ? `${currentPath}.${k}` : k));
    }
  }

  check(obj, '');
  return { hasFill: markerPaths.length > 0, markerPaths };
}

// ─── Contacts, Companies & Signals ───────────────────────────

export type ContactType =
  | 'recruiter'
  | 'qa_manager'
  | 'sdet_lead'
  | 'eng_manager'
  | 'founder_cto'
  | 'generic_careers'
  | 'referral';

export type EmailStatus =
  | 'unknown'
  | 'guessed'
  | 'verified'
  | 'bounced'
  | 'invalid';

export interface CompanyRecord {
  id?: number;
  name: string;
  domain: string;
  sizeBucket: CompanySizeBucket;
  ats: AtsProvider;
  slug?: string;
  notes?: string;
  researchBrief?: string;
  lastResearchedAt?: string;
  createdAt?: string;
}

export interface ContactRecord {
  id?: number;
  companyId: number;
  fullName: string;
  title: string;
  contactType: ContactType;
  linkedinUrl?: string;
  email?: string;
  emailStatus: EmailStatus;
  timezone?: string; // Contact's timezone (default Asia/Kolkata)
  source?: string;
  notes?: string;
  createdAt?: string;
}

export type SignalType =
  | 'funding'
  | 'hiring_post'
  | 'multiple_qa_roles'
  | 'product_launch'
  | 'headcount_growth'
  | 'layoffs'
  | 'other';

export interface SignalRecord {
  id?: number;
  companyId: number;
  signalType: SignalType;
  detail: string;
  url?: string;
  source?: string; // 'manual' | 'news' | 'ats' | 'demo' | 'test'
  seenAt?: string;
}

export interface SuppressionRecord {
  email: string;
  reason: string;
  addedAt: string;
}

// ─── Outreach & Email ────────────────────────────────────────

export type OutreachType = 'cold' | 'follow_up_1' | 'referral_ask' | 'thank_you';
export type OutreachStatus = 'draft' | 'approved' | 'sent' | 'replied' | 'bounced' | 'skipped';
export type OutreachOutcome = 'none' | 'positive' | 'negative' | 'interview' | 'referral';

export interface OutreachRecord {
  id?: number;
  contactId: number;
  jobId?: number;
  type: OutreachType;
  variant?: 'A' | 'B';
  subject: string;
  body: string;
  status: OutreachStatus;
  sentAt?: string;
  followUpDueAt?: string;
  replyAt?: string;
  outcome?: OutreachOutcome;
  source?: string;
  error?: string;
  createdAt?: string;
}

export interface ApplicationRecord {
  id?: number;
  jobId: number;
  appliedAt: string;
  resumePath?: string;
  coverLetterPath?: string;
  notes?: string;
  followUpDate?: string;
  outcome?: string;
}

export interface AgentTask {
  id: string;
  type: 'scrape' | 'score' | 'report' | 'resume' | 'cover-letter' | 'filter';
  status: 'pending' | 'running' | 'done' | 'failed';
  payload?: unknown;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface HermesConfig {
  openaiApiKey: string;
  openaiModel: string;
  temperature: number;
  databasePath: string;
  reportsDir: string;
  documentsDir: string;
  logLevel: string;
  logDir: string;
  cronSchedule: string;
  timezone: string;
  scrapeConcurrency: number;
  requestDelayMs: number;
  maxRetries: number;
  candidateProfilePath: string;
  companyTargetsPath: string;
  minScoreThreshold: number;
  topJobsCount: number;
  userAgent: string;
  requestTimeoutMs: number;
}

// ─── Log Entry ───────────────────────────────────────────────

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}


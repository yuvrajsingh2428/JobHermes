// ============================================================
// JobHermes – Core Type Definitions
// ============================================================

export interface JobPosting {
  id?: number;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  salary?: string;
  jobType?: string; // full-time, part-time, contract, remote
  experienceRequired?: string;
  skills?: string[];
  postedAt?: string;
  scrapedAt: string;
  source: string;
  status: ApplicationStatus;
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  isApplied: boolean;
  appliedAt?: string;
  notes?: string;
}

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
  skillMatch: number;     // 0-30
  titleMatch: number;     // 0-20
  locationMatch: number;  // 0-15
  experienceMatch: number; // 0-15
  salaryMatch: number;    // 0-10
  companyPrestige: number; // 0-10
  total: number;          // 0-100
}

export interface CandidateProfile {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  summary: string;
  skills: {
    languages: string[];
    frontend: string[];
    backend: string[];
    databases: string[];
    cloud: string[];
    tools: string[];
  };
  experience: WorkExperience[];
  education: Education[];
  certifications: string[];
  targetRoles: string[];
  preferredLocations: string[];
  minSalaryLPA: number;
  maxExperienceYears: number;
  openToRemote: boolean;
  noticePeriodDays: number;
}

export interface WorkExperience {
  company: string;
  role: string;
  duration: string;
  highlights: string[];
}

export interface Education {
  institution: string;
  degree: string;
  year: string;
}

export interface CompanyTarget {
  name: string;
  careers_url: string;
  search_keywords: string[];
  priority: 'high' | 'medium' | 'low';
  enabled: boolean;
  is_aggregator?: boolean;
}

export interface ScrapeResult {
  company: string;
  source: string;
  jobs: RawJob[];
  scrapedAt: string;
  error?: string;
}

export interface RawJob {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  salary?: string;
  jobType?: string;
  postedAt?: string;
}

export interface DailyReport {
  generatedAt: string;
  date: string;
  totalJobsScraped: number;
  totalJobsFiltered: number;
  topJobs: JobPosting[];
  applicationsSent: number;
  companiesCovered: string[];
  scoreDistribution: { range: string; count: number }[];
}

export interface ResumeRequest {
  jobId: number;
  job: JobPosting;
  profile: CandidateProfile;
  outputPath: string;
}

export interface CoverLetterRequest {
  jobId: number;
  job: JobPosting;
  profile: CandidateProfile;
  tone?: 'professional' | 'enthusiastic' | 'concise';
  outputPath: string;
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

export interface FetchOptions {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  delayMs?: number;
}

export interface FetchResult {
  url: string;
  status: number;
  html: string;
  success: boolean;
  error?: string;
  responseTimeMs: number;
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

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

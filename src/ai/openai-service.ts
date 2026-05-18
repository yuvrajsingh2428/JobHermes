// ============================================================
// AI Service – OpenAI integration for resume, cover letters,
// job analysis, and relevance filtering
// ============================================================

import OpenAI from 'openai';
import { JobPosting, CandidateProfile } from '../types';
import { Prompts } from '../prompts/templates';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/helpers';

export interface JobAnalysis {
  requiredSkills: string[];
  niceToHaveSkills: string[];
  experienceYears: { min: number; max: number };
  jobType: string;
  seniorityLevel: string;
  keyResponsibilities: string[];
  benefits: string[];
  salaryRange: string;
  companyStage: string;
  interviewInsights: string;
}

export interface RelevanceResult {
  relevant: boolean;
  confidence: number;
  reason: string;
  keyRequirements: string[];
}

export class AIService {
  private client: OpenAI;
  private model: string;
  private temperature: number;

  constructor(options: {
    apiKey: string;
    model?: string;
    temperature?: number;
  }) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? 'gpt-4o';
    this.temperature = options.temperature ?? 0.3;
  }

  // ─── Core Chat Completion ─────────────────────────────────

  private async complete(prompt: string, maxTokens = 2000): Promise<string> {
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: this.temperature,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });

      return response.choices[0]?.message?.content?.trim() ?? '';
    }, 3, 2000);
  }

  // ─── Resume Generation ────────────────────────────────────

  async generateResume(job: JobPosting, profile: CandidateProfile): Promise<string> {
    logger.info(`Generating resume for: ${job.title} at ${job.company}`);

    const prompt = Prompts.generateResume(job, profile);
    const html = await this.complete(prompt, 3000);

    // Clean up markdown code blocks if model wraps the response
    return this.extractHtml(html);
  }

  // ─── Cover Letter Generation ──────────────────────────────

  async generateCoverLetter(
    job: JobPosting,
    profile: CandidateProfile,
    tone: 'professional' | 'enthusiastic' | 'concise' = 'professional'
  ): Promise<string> {
    logger.info(`Generating cover letter for: ${job.title} at ${job.company} [tone: ${tone}]`);

    const prompt = Prompts.generateCoverLetter(job, profile, tone);
    const html = await this.complete(prompt, 2000);

    return this.extractHtml(html);
  }

  // ─── Job Relevance Filtering ──────────────────────────────

  async checkJobRelevance(job: JobPosting, profile: CandidateProfile): Promise<RelevanceResult> {
    logger.debug(`Checking relevance: ${job.title} at ${job.company}`);

    const prompt = Prompts.jobRelevanceFilter(job, profile);

    try {
      const response = await this.complete(prompt, 500);
      const cleaned = response.replace(/```json\n?|```\n?/g, '').trim();
      return JSON.parse(cleaned) as RelevanceResult;
    } catch {
      logger.warn(`Failed to parse relevance response for ${job.title}`);
      return {
        relevant: true, // Default to relevant on parse failure
        confidence: 50,
        reason: 'Could not evaluate automatically',
        keyRequirements: [],
      };
    }
  }

  // ─── Job Analysis ─────────────────────────────────────────

  async analyzeJob(job: JobPosting): Promise<JobAnalysis | null> {
    logger.debug(`Analyzing job: ${job.title}`);

    const prompt = Prompts.analyzeJob(job);

    try {
      const response = await this.complete(prompt, 1000);
      const cleaned = response.replace(/```json\n?|```\n?/g, '').trim();
      return JSON.parse(cleaned) as JobAnalysis;
    } catch {
      logger.warn(`Failed to parse job analysis for ${job.title}`);
      return null;
    }
  }

  // ─── Daily Summary ────────────────────────────────────────

  async generateDailySummary(
    jobs: JobPosting[],
    totalScraped: number,
    companiesCovered: string[]
  ): Promise<string> {
    logger.info('Generating AI daily summary');

    const prompt = Prompts.generateDailySummary(jobs, totalScraped, companiesCovered);
    return this.complete(prompt, 300);
  }

  // ─── Batch Relevance Filter ───────────────────────────────

  async filterRelevantJobs(
    jobs: JobPosting[],
    profile: CandidateProfile,
    concurrency = 5
  ): Promise<JobPosting[]> {
    logger.info(`AI filtering ${jobs.length} jobs for relevance`);

    const results: JobPosting[] = [];

    // Process in batches
    for (let i = 0; i < jobs.length; i += concurrency) {
      const batch = jobs.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map((job) => this.checkJobRelevance(job, profile))
      );

      for (let j = 0; j < batch.length; j++) {
        const r = batchResults[j];
        if (r.status === 'fulfilled' && r.value.relevant) {
          results.push(batch[j]);
        } else if (r.status === 'rejected') {
          results.push(batch[j]); // Include on error
        }
      }
    }

    logger.success(`AI filter: ${results.length}/${jobs.length} jobs passed`);
    return results;
  }

  // ─── Helper ───────────────────────────────────────────────

  private extractHtml(text: string): string {
    // Remove ```html ... ``` or ``` ... ``` wrappers
    const match = text.match(/```(?:html)?\n?([\s\S]*?)```/);
    if (match) return match[1].trim();
    return text.trim();
  }
}

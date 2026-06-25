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
  private isMock: boolean;

  constructor(options: {
    apiKey: string;
    model?: string;
    temperature?: number;
  }) {
    this.isMock = options.apiKey === 'mock' || options.apiKey.startsWith('mock-');
    this.client = new OpenAI({ apiKey: this.isMock ? 'mock-key' : options.apiKey });
    this.model = options.model ?? 'gpt-4o';
    this.temperature = options.temperature ?? 0.3;
    if (this.isMock) {
      logger.info('AIService initialized in Mock Mode (offline)');
    }
  }

  // ─── Core Chat Completion ─────────────────────────────────

  private async complete(prompt: string, maxTokens = 2000): Promise<string> {
    if (this.isMock) {
      return '';
    }
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

    if (this.isMock) {
      return `
<div style="font-family:'Inter',sans-serif;color:#1e293b;line-height:1.6;max-width:800px;margin:0 auto;padding:20px">
  <header style="text-align:center;margin-bottom:24px;border-bottom:2px solid #3b82f6;padding-bottom:16px">
    <h1 style="margin:0;font-size:28px;color:#1e3a8a">${profile.name}</h1>
    <p style="margin:4px 0">${profile.email} | ${profile.phone} | ${profile.location}</p>
    <p style="margin:4px 0"><a href="${profile.linkedin || '#'}" style="color:#2563eb;text-decoration:none">LinkedIn</a> | <a href="${profile.github || '#'}" style="color:#2563eb;text-decoration:none">GitHub</a></p>
  </header>
  
  <section style="margin-bottom:20px">
    <h2 style="color:#1e3a8a;border-bottom:1px solid #e2e8f0;padding-bottom:4px;font-size:18px">Professional Summary</h2>
    <p>Targeted resume for <strong>${job.title}</strong> at <strong>${job.company}</strong>. Experienced Full Stack Engineer with expertise in building scalable applications, microservices, and optimizing system latencies. Proven track record aligning with the core requirements of this role.</p>
  </section>

  <section style="margin-bottom:20px">
    <h2 style="color:#1e3a8a;border-bottom:1px solid #e2e8f0;padding-bottom:4px;font-size:18px">Technical Skills</h2>
    <p><strong>Languages:</strong> ${profile.skills.languages.join(', ')}</p>
    <p><strong>Frontend:</strong> ${profile.skills.frontend.join(', ')}</p>
    <p><strong>Backend:</strong> ${profile.skills.backend.join(', ')}</p>
    <p><strong>Databases & Tools:</strong> ${[...profile.skills.databases, ...profile.skills.tools].join(', ')}</p>
  </section>

  <section style="margin-bottom:20px">
    <h2 style="color:#1e3a8a;border-bottom:1px solid #e2e8f0;padding-bottom:4px;font-size:18px">Work Experience</h2>
    ${profile.experience.map((exp) => `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-weight:bold;color:#0f172a">
          <span>${exp.role}</span>
          <span>${exp.duration}</span>
        </div>
        <div style="color:#4b5563;font-style:italic;margin-bottom:4px">${exp.company}</div>
        <ul style="margin:0;padding-left:20px">
          ${exp.highlights.map((h) => `<li>${h}</li>`).join('')}
        </ul>
      </div>
    `).join('')}
  </section>

  <section>
    <h2 style="color:#1e3a8a;border-bottom:1px solid #e2e8f0;padding-bottom:4px;font-size:18px">Education & Certifications</h2>
    <p>${profile.education.map((e) => `${e.degree} - ${e.institution} (${e.year})`).join(', ')}</p>
    <p><strong>Certifications:</strong> ${profile.certifications.join(', ')}</p>
  </section>
</div>`;
    }

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

    if (this.isMock) {
      const recentExp = profile.experience[0];
      return `
<div style="font-family:'Inter',sans-serif;color:#1e293b;line-height:1.7;max-width:700px;margin:0 auto;padding:20px">
  <p style="margin-bottom:20px">Dear Hiring Team at ${job.company},</p>
  
  <p style="margin-bottom:16px">I am writing to express my enthusiastic interest in the <strong>${job.title}</strong> role. As a ${profile.title} with a strong foundation in ${profile.skills.languages.slice(0, 3).join(', ')} and backend engineering, I have spent the last few years developing resilient APIs and modern web applications that deliver high-impact results.</p>
  
  <p style="margin-bottom:16px">In my recent position as ${recentExp?.role} at ${recentExp?.company}, I was responsible for key initiatives including reducing API latency and leading system design choices. I notice that your team values engineering quality and speed, which aligns directly with my focus on clean architecture and high-performance infrastructure.</p>
  
  <p style="margin-bottom:16px">I am excited by the opportunity to bring my skills in ${profile.skills.backend.slice(0, 3).join(', ')} to ${job.company}. I look forward to the possibility of discussing how my experience fits your team's current challenges.</p>
  
  <p style="margin-top:24px">Sincerely,<br><strong>${profile.name}</strong></p>
</div>`;
    }

    const prompt = Prompts.generateCoverLetter(job, profile, tone);
    const html = await this.complete(prompt, 2000);

    return this.extractHtml(html);
  }

  // ─── Job Relevance Filtering ──────────────────────────────

  async checkJobRelevance(job: JobPosting, profile: CandidateProfile): Promise<RelevanceResult> {
    logger.debug(`Checking relevance: ${job.title} at ${job.company}`);

    if (this.isMock) {
      const titleLower = job.title.toLowerCase();
      const isRelevant = profile.targetRoles.some(
        (role) => titleLower.includes(role.toLowerCase()) || role.toLowerCase().includes(titleLower)
      );
      return {
        relevant: isRelevant,
        confidence: isRelevant ? 95 : 20,
        reason: isRelevant
          ? `[Mock] Job title '${job.title}' closely matches target role parameters and candidate core experience.`
          : `[Mock] Job title '${job.title}' is not within the primary target roles list.`,
        keyRequirements: ['TypeScript', 'React', 'Node.js'],
      };
    }

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

    if (this.isMock) {
      return {
        requiredSkills: ['TypeScript', 'Node.js', 'React', 'SQL'],
        niceToHaveSkills: ['Docker', 'AWS', 'Next.js'],
        experienceYears: { min: 2, max: 6 },
        jobType: job.jobType || 'full-time',
        seniorityLevel: job.title.toLowerCase().includes('senior') ? 'senior' : 'mid',
        keyResponsibilities: [
          'Design and implement high-performance APIs.',
          'Collaborate with product managers and engineers.',
          'Optimize frontend user experience.'
        ],
        benefits: ['Competitive salary', 'Flexible working hours', 'Health insurance'],
        salaryRange: job.salary || '18-24 LPA',
        companyStage: 'growth',
        interviewInsights: 'Online coding round, followed by system design and behavioral discussions.'
      };
    }

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

    if (this.isMock) {
      const topMatches = jobs.slice(0, 2).map((j) => `${j.title} at ${j.company}`).join(' and ');
      return `JobHermes conducted a daily scan analyzing ${totalScraped} job listings across ${companiesCovered.length} sites. After multi-dimensional filtering, ${jobs.length} jobs matched your candidate profile. The most notable opportunities are ${topMatches || 'roles matching your skills'}. We recommend reviewing these matches and generating tailored resumes to apply.`;
    }

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

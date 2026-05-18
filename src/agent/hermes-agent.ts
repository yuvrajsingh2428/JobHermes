// ============================================================
// Hermes Agent – Central orchestration layer for all tasks
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { AgentTask, CandidateProfile, CompanyTarget, JobPosting } from '../types';
import { ScraperService } from '../scraper/scraper';
import { ScoringService } from '../scoring/scorer';
import { AIService } from '../ai/openai-service';
import { StorageService } from '../storage/database';
import { ReportGenerator } from '../reports/report-generator';
import { DocumentService } from '../ai/document-service';
import { logger } from '../utils/logger';
import { readJsonFile } from '../utils/helpers';
import { HermesConfig } from '../types';

export class HermesAgent {
  private scraper: ScraperService;
  private scorer: ScoringService;
  private ai: AIService;
  private storage: StorageService;
  private reporter: ReportGenerator;
  private documents: DocumentService;
  private config: HermesConfig;
  private tasks: Map<string, AgentTask> = new Map();

  constructor(config: HermesConfig) {
    this.config = config;

    this.scraper = new ScraperService({
      userAgent: config.userAgent,
      timeout: config.requestTimeoutMs,
      delayMs: config.requestDelayMs,
      retries: config.maxRetries,
    });

    this.scorer = new ScoringService();

    this.ai = new AIService({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      temperature: config.temperature,
    });

    this.storage = new StorageService(config.databasePath);

    this.reporter = new ReportGenerator(config.reportsDir);

    this.documents = new DocumentService(
      this.ai,
      this.reporter,
      this.storage,
      config.documentsDir
    );

    logger.section('Hermes Agent Initialized');
    logger.info('Config loaded', {
      model: config.openaiModel,
      db: config.databasePath,
      reports: config.reportsDir,
    });
  }

  // ─── Task Registry ─────────────────────────────────────────

  private createTask(type: AgentTask['type'], payload?: unknown): AgentTask {
    const task: AgentTask = {
      id: uuidv4(),
      type,
      status: 'pending',
      payload,
      startedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  private completeTask(task: AgentTask, result?: unknown): void {
    task.status = 'done';
    task.result = result;
    task.completedAt = new Date().toISOString();
    logger.debug(`Task completed: ${task.type} [${task.id}]`);
  }

  private failTask(task: AgentTask, error: string): void {
    task.status = 'failed';
    task.error = error;
    task.completedAt = new Date().toISOString();
    logger.error(`Task failed: ${task.type} [${task.id}]`, { error });
  }

  // ─── Main Daily Scan ───────────────────────────────────────

  async runDailyScan(): Promise<void> {
    logger.section('Daily Job Scan Starting');

    const task = this.createTask('scrape');
    task.status = 'running';

    const runId = this.storage.startScanRun();

    try {
      const profile = this.loadProfile();
      const targets = this.loadTargets();
      const enabledTargets = targets.filter((t) => t.enabled);

      // 1. Scrape
      logger.info(`Scraping ${enabledTargets.length} sources...`);
      const scrapeResults = await this.scraper.scrapeAll(enabledTargets, this.config.scrapeConcurrency);

      const allRawJobs: JobPosting[] = scrapeResults.flatMap((r) =>
        r.jobs.map((j) => ({
          ...j,
          scrapedAt: r.scrapedAt,
          source: r.company,
          status: 'new' as const,
          isApplied: false,
          description: j.description || '',
        }))
      );

      logger.info(`Total raw jobs: ${allRawJobs.length}`);

      // 2. Score all jobs
      const scored = this.scorer.scoreAll(allRawJobs, profile);

      // 3. Filter by threshold
      const filtered = this.scorer.filterByThreshold(scored, this.config.minScoreThreshold);
      logger.info(`After scoring filter (>= ${this.config.minScoreThreshold}): ${filtered.length} jobs`);

      // 4. Store in DB
      for (const job of filtered) {
        const id = this.storage.upsertJob(job);
        if (job.score !== undefined && job.scoreBreakdown) {
          this.storage.updateJobScore(id, job.score, job.scoreBreakdown);
        }
      }

      // 5. Generate report
      const topJobs = this.storage.getTopJobs(this.config.topJobsCount, this.config.minScoreThreshold);
      const companiesCovered = enabledTargets.map((t) => t.name);

      let aiSummary: string | undefined;
      try {
        aiSummary = await this.ai.generateDailySummary(topJobs, allRawJobs.length, companiesCovered);
      } catch (err) {
        logger.warn('AI summary generation failed', { error: String(err) });
      }

      const report = this.reporter.buildReport(topJobs, companiesCovered, aiSummary);
      const reportPath = this.reporter.generateDailyReport(report, aiSummary);

      this.storage.logReport(reportPath, topJobs.length);
      this.storage.completeScanRun(runId, allRawJobs.length, filtered.length, companiesCovered);

      this.completeTask(task, { jobsFound: filtered.length, reportPath });

      logger.success(`Daily scan complete! Report: ${reportPath}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.failTask(task, errMsg);
      this.storage.failScanRun(runId, errMsg);
      throw err;
    }
  }

  // ─── Report Only ───────────────────────────────────────────

  async generateReport(): Promise<string> {
    logger.section('Generating Report from Stored Jobs');

    const task = this.createTask('report');
    task.status = 'running';

    try {
      const topJobs = this.storage.getTopJobs(this.config.topJobsCount, this.config.minScoreThreshold);
      const targets = this.loadTargets();
      const companiesCovered = targets.filter((t) => t.enabled).map((t) => t.name);

      let aiSummary: string | undefined;
      try {
        aiSummary = await this.ai.generateDailySummary(topJobs, topJobs.length, companiesCovered);
      } catch {
        // AI summary is optional
      }

      const report = this.reporter.buildReport(topJobs, companiesCovered, aiSummary);
      const reportPath = this.reporter.generateDailyReport(report, aiSummary);

      this.storage.logReport(reportPath, topJobs.length);
      this.completeTask(task, { reportPath });

      return reportPath;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.failTask(task, errMsg);
      throw err;
    }
  }

  // ─── Resume Generation ────────────────────────────────────

  async generateResume(jobId: number): Promise<string> {
    const profile = this.loadProfile();
    const task = this.createTask('resume', { jobId });
    task.status = 'running';

    try {
      const filePath = await this.documents.generateResume(jobId, profile);
      this.completeTask(task, { filePath });
      return filePath;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.failTask(task, errMsg);
      throw err;
    }
  }

  // ─── Cover Letter Generation ──────────────────────────────

  async generateCoverLetter(
    jobId: number,
    tone: 'professional' | 'enthusiastic' | 'concise' = 'professional'
  ): Promise<string> {
    const profile = this.loadProfile();
    const task = this.createTask('cover-letter', { jobId, tone });
    task.status = 'running';

    try {
      const filePath = await this.documents.generateCoverLetter(jobId, profile, tone);
      this.completeTask(task, { filePath });
      return filePath;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.failTask(task, errMsg);
      throw err;
    }
  }

  // ─── Application Pack (Resume + Cover Letter) ─────────────

  async generateApplicationPack(
    jobId: number,
    tone: 'professional' | 'enthusiastic' | 'concise' = 'professional'
  ): Promise<{ resumePath: string; coverLetterPath: string }> {
    const profile = this.loadProfile();
    return this.documents.generateApplicationPack(jobId, profile, tone);
  }

  // ─── Getters ───────────────────────────────────────────────

  getTopJobs(limit?: number): JobPosting[] {
    return this.storage.getTopJobs(limit ?? this.config.topJobsCount, this.config.minScoreThreshold);
  }

  getAllJobs(): JobPosting[] {
    return this.storage.getAllJobs();
  }

  getJobById(id: number): JobPosting | undefined {
    return this.storage.getJobById(id);
  }

  getTasks(): AgentTask[] {
    return [...this.tasks.values()];
  }

  getStorage(): StorageService {
    return this.storage;
  }

  // ─── Config Helpers ────────────────────────────────────────

  private loadProfile(): CandidateProfile {
    return readJsonFile<CandidateProfile>(this.config.candidateProfilePath);
  }

  private loadTargets(): CompanyTarget[] {
    return readJsonFile<CompanyTarget[]>(this.config.companyTargetsPath);
  }

  shutdown(): void {
    this.storage.close();
    logger.info('Hermes Agent shut down');
  }
}

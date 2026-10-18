// ============================================================
// Hermes Agent – Central orchestration layer for all tasks
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { AgentTask, CandidateProfile, CompanyTarget, JobPosting, HermesConfig } from '../types';
import { fetchAllTargetsDetailed, fetchAllTargets } from '../sources';
import { scoringService, ScoringService, ScoringContext } from '../scoring/scorer';
import { AIService } from '../ai/openai-service';
import { StorageService } from '../storage/database';
import { DocumentService } from '../ai/document-service';
import { logger } from '../utils/logger';
import { readJsonFile } from '../utils/helpers';

export class HermesAgent {
  private scorer: ScoringService;
  private ai: AIService;
  private storage: StorageService;
  private documents: DocumentService;
  private config: HermesConfig;
  private tasks: Map<string, AgentTask> = new Map();
  private isScanning = false;

  constructor(config: HermesConfig) {
    this.config = config;

    this.scorer = scoringService;

    this.ai = new AIService({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      temperature: config.temperature,
    });

    this.storage = new StorageService(config.databasePath);

    this.documents = new DocumentService(this.ai, this.storage, config.documentsDir);

    logger.section('JobHermes SDET Copilot Initialized');
    logger.info('Config loaded', {
      model: config.openaiModel,
      db: config.databasePath,
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
    if (this.isScanning) {
      logger.warn('Scan already in progress, skipping scan request.');
      return;
    }
    this.isScanning = true;
    logger.section('Daily SDET Job Scan Starting');

    const task = this.createTask('scrape');
    task.status = 'running';

    const runId = this.storage.startScanRun();

    try {
      const profile = this.loadProfile();
      const targets = this.loadTargets();
      const enabledTargets = targets.filter((t) => t.enabled && t.verified);

      // 1. Fetch from structured ATS adapters
      logger.info(`Fetching jobs across ${enabledTargets.length} company sources...`);
      const { jobs: rawJobs, targetResults } = await fetchAllTargetsDetailed(
        enabledTargets,
        this.config.scrapeConcurrency
      );
      logger.info(`Total unique raw jobs collected: ${rawJobs.length}`);

      // 2. Build company contexts with signal and QA opening awareness
      const companyQaCounts = new Map<string, number>();
      for (const j of rawJobs) {
        if (/qa|sdet|test|quality/i.test(j.title)) {
          const compKey = j.company.toLowerCase().trim();
          companyQaCounts.set(compKey, (companyQaCounts.get(compKey) || 0) + 1);
        }
      }

      const companyContexts = new Map<string, ScoringContext>();
      const distinctCompanies = new Set(rawJobs.map((j) => j.company.toLowerCase().trim()));
      for (const compName of distinctCompanies) {
        const comp = this.storage.getCompanyByName(compName);
        let hasSignal = false;
        let signalType: string | undefined;
        let signalDetail = '';
        let signalSource: string | undefined;
        if (comp && comp.id) {
          const signals = this.storage.getSignalsForCompany(comp.id);
          if (signals.length > 0) {
            hasSignal = true;
            signalType = signals[0].signalType;
            signalDetail = signals[0].detail;
            signalSource = signals[0].source;
          }
        }
        companyContexts.set(compName, {
          companyOpenQaCount: companyQaCounts.get(compName) || 0,
          hasCompanySignal: hasSignal,
          signalType,
          signalDetail,
          signalSource,
        });
      }

      logger.info('Scoring jobs with SDET scoring model...');
      const scoredJobs = this.scorer.scoreAll(rawJobs, profile, companyContexts);

      // 3. Filter by threshold and identify near misses (40–59)
      const qualified = scoredJobs.filter((j) => (j.score ?? 0) >= this.config.minScoreThreshold);
      const nearMisses = scoredJobs.filter(
        (j) => (j.score ?? 0) >= 40 && (j.score ?? 0) < this.config.minScoreThreshold
      );

      logger.info(
        `After scoring filter (>= ${this.config.minScoreThreshold}): ${qualified.length} matching jobs`
      );
      logger.info(`Near misses (40–59): ${nearMisses.length}`);

      if (nearMisses.length > 0) {
        logger.section('Near Misses (Score 40–59)');
        nearMisses.forEach((j, i) => {
          logger.info(`  #${i + 1} [Score: ${j.score}] ${j.title} @ ${j.company} (${j.location})`);
          logger.info(
            `     Missing: ${j.scoreBreakdown?.missingSkills.slice(0, 3).join(', ') || 'none'}`
          );
          logger.info(`     Key Reasons: ${j.reasons?.slice(0, 2).join(' | ')}`);
        });
      }

      // 4. Store in SQLite DB (both qualified >= 60 and near-misses 40-59)
      for (const job of qualified) {
        const id = this.storage.upsertJob({ ...job, nearMiss: false });
        if (job.score !== undefined && job.scoreBreakdown) {
          this.storage.updateJobScore(id, job.score, job.scoreBreakdown);
        }
      }
      for (const job of nearMisses) {
        const id = this.storage.upsertJob({ ...job, nearMiss: true });
        if (job.score !== undefined && job.scoreBreakdown) {
          this.storage.updateJobScore(id, job.score, job.scoreBreakdown);
        }
      }

      // Update stale/closed job sightings ONLY for companies where fetch succeeded (HTTP 200, valid parsed payload)
      for (const res of targetResults) {
        const compName = res.target.name;
        if (!res.success) {
          logger.warn(
            `Stale-job detection skipped for ${compName}: fetch failed (${res.errorType || 'error'}${res.statusCode ? ` HTTP ${res.statusCode}` : ''}).`
          );
          continue;
        }

        const urlSet = new Set(res.jobs.map((j) => j.url));
        const sightings = this.storage.recordJobSightings(compName, urlSet, {
          fetchSucceeded: true,
          skipIfEmptyWhenHadJobs: true,
        });

        if (sightings.newlyClosed.length > 0) {
          logger.info(
            `Closed ${sightings.newlyClosed.length} stale jobs for ${compName} absent for 2 consecutive scans.`
          );
        }
      }

      // 5. Generate AI summary
      const topJobs = this.storage.getTopJobs(
        this.config.topJobsCount,
        this.config.minScoreThreshold
      );
      const companiesCovered = enabledTargets.map((t) => t.name);

      let aiSummary: string | undefined;
      try {
        aiSummary = await this.ai.generateDailySummary(topJobs, rawJobs.length, companiesCovered);
        logger.info('AI Daily Summary:', { summary: aiSummary });
      } catch (err) {
        logger.warn('AI summary generation skipped', { error: String(err) });
      }

      this.storage.completeScanRun(runId, rawJobs.length, qualified.length, companiesCovered);
      this.completeTask(task, { jobsFound: qualified.length, topCount: topJobs.length });

      logger.success(`Daily scan complete! Found ${qualified.length} qualified SDET roles.`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.failTask(task, errMsg);
      this.storage.failScanRun(runId, errMsg);
      throw err;
    } finally {
      this.isScanning = false;
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
    return this.storage.getTopJobs(
      limit ?? this.config.topJobsCount,
      this.config.minScoreThreshold
    );
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

  updateJobStatus(id: number, status: string, notes?: string): void {
    this.storage.updateJobStatus(id, status as any, notes);
  }

  isCurrentlyScanning(): boolean {
    return this.isScanning;
  }

  async scanAllQaTitles(): Promise<
    Array<{
      title: string;
      company: string;
      location: string;
      url: string;
      source: string;
      isSdetMatch: boolean;
    }>
  > {
    const targets = this.loadTargets().filter((t) => t.enabled && t.verified);
    const rawJobs = await fetchAllTargets(targets, this.config.scrapeConcurrency);

    const qaRegex = /\b(qa|quality|test|sdet|automation|assurance|testing)\b/i;
    const qaJobs = rawJobs.filter((j) => qaRegex.test(j.title));

    const sdetRegex =
      /\b(sdet|software (?:development )?engineer in test|qa automation|test automation|automation test engineer|set)\b/i;

    return qaJobs.map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      source: j.source,
      isSdetMatch: sdetRegex.test(j.title),
    }));
  }

  shutdown(): void {
    this.storage.close();
    logger.info('Hermes Agent shut down');
  }
}

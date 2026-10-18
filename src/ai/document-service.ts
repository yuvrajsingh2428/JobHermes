// ============================================================
// Document Service – Resume & Cover Letter pipeline
// ============================================================

import path from 'path';
import { CandidateProfile, ApplicationRecord } from '../types';
import { AIService } from '../ai/openai-service';
import { StorageService } from '../storage/database';
import { logger } from '../utils/logger';
import { ensureDir, writeTextFile, sanitizeFilename, getTimestampString } from '../utils/helpers';

export class DocumentService {
  private ai: AIService;
  private storage: StorageService;
  private documentsDir: string;

  constructor(ai: AIService, storage: StorageService, documentsDir: string) {
    this.ai = ai;
    this.storage = storage;
    this.documentsDir = documentsDir;
    ensureDir(documentsDir);
  }

  private wrapDocumentHtml(content: string, title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #fff; color: #1e293b; margin: 0; padding: 40px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  }

  async generateResume(jobId: number, profile: CandidateProfile): Promise<string> {
    const job = this.storage.getJobById(jobId);
    if (!job) throw new Error(`Job ID ${jobId} not found`);

    logger.section(`Generating Resume: ${job.title} @ ${job.company}`);

    const content = await this.ai.generateResume(job, profile);
    const wrapped = this.wrapDocumentHtml(content, `${profile.name} - Resume - ${job.title}`);

    const dir = path.join(this.documentsDir, 'resumes');
    ensureDir(dir);

    const filename = `resume-${sanitizeFilename(job.company)}-${sanitizeFilename(job.title)}-${getTimestampString()}.html`;
    const filePath = path.join(dir, filename);
    writeTextFile(filePath, wrapped);

    logger.success(`Resume saved: ${filePath}`);
    return filePath;
  }

  async generateCoverLetter(
    jobId: number,
    profile: CandidateProfile,
    tone: 'professional' | 'enthusiastic' | 'concise' = 'professional'
  ): Promise<string> {
    const job = this.storage.getJobById(jobId);
    if (!job) throw new Error(`Job ID ${jobId} not found`);

    logger.section(`Generating Cover Letter: ${job.title} @ ${job.company}`);

    const content = await this.ai.generateCoverLetter(job, profile, tone);
    const wrapped = this.wrapDocumentHtml(content, `${profile.name} - Cover Letter - ${job.title}`);

    const dir = path.join(this.documentsDir, 'cover-letters');
    ensureDir(dir);

    const filename = `cover-letter-${sanitizeFilename(job.company)}-${sanitizeFilename(job.title)}-${getTimestampString()}.html`;
    const filePath = path.join(dir, filename);
    writeTextFile(filePath, wrapped);

    logger.success(`Cover letter saved: ${filePath}`);
    return filePath;
  }

  async generateApplicationPack(
    jobId: number,
    profile: CandidateProfile,
    tone: 'professional' | 'enthusiastic' | 'concise' = 'professional'
  ): Promise<{ resumePath: string; coverLetterPath: string }> {
    const [resumePath, coverLetterPath] = await Promise.all([
      this.generateResume(jobId, profile),
      this.generateCoverLetter(jobId, profile, tone),
    ]);

    const job = this.storage.getJobById(jobId);
    if (job) {
      const record: Omit<ApplicationRecord, 'id'> = {
        jobId,
        appliedAt: new Date().toISOString(),
        resumePath,
        coverLetterPath,
      };
      this.storage.addApplication(record);
      this.storage.markApplied(jobId, new Date().toISOString());
    }

    return { resumePath, coverLetterPath };
  }
}

// ============================================================
// Resume Tailor – Markdown Reordering, Diff & Keyword-Gap Analyzer
// ============================================================

import fs from 'fs';
import path from 'path';
import { CandidateProfile, JobPosting, hasFillMarkers } from '../types';
import { logger } from '../utils/logger';

export interface TailoredResumeResult {
  tailoredMarkdown: string;
  matchedKeywords: string[];
  missingKeywords: string[];
  diffSummary: string;
  outputPath?: string;
}

export class ResumeTailor {
  /**
   * Tailors a base Markdown resume for a target job posting
   */
  tailorResume(
    baseResumePath = './config/base-resume.md',
    job: JobPosting,
    profile: CandidateProfile,
    options?: { allowFillForDemo?: boolean; saveDir?: string }
  ): TailoredResumeResult {
    const resolvedPath = path.resolve(baseResumePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Base resume file not found at: ${resolvedPath}`);
    }

    const baseContent = fs.readFileSync(resolvedPath, 'utf-8');

    // Fail-safe guard against unresolved [FILL] markers
    if (!options?.allowFillForDemo) {
      if (baseContent.includes('[FILL')) {
        throw new Error(
          `Refusing to tailor resume: ${baseResumePath} contains unresolved [FILL] markers. Edit the base resume template first.`
        );
      }
      const profileFill = hasFillMarkers(profile);
      if (profileFill.hasFill) {
        throw new Error(
          `Refusing to tailor resume: candidate profile contains unresolved [FILL] markers (${profileFill.markerPaths.slice(0, 3).join(', ')}).`
        );
      }
    }

    const matchedKeywords = job.scoreBreakdown?.matchedSkills || [];
    const missingKeywords = job.scoreBreakdown?.missingSkills || [];

    // Parse sections and reorder bullet points based on matched keywords
    const lines = baseContent.split(/\r?\n/);
    const outputLines: string[] = [];
    const bulletBuffer: string[] = [];

    const flushBullets = () => {
      if (bulletBuffer.length === 0) return;
      // Score each bullet by how many matched keywords it contains
      const scoredBullets = bulletBuffer.map((b) => {
        let matchCount = 0;
        const lower = b.toLowerCase();
        for (const kw of matchedKeywords) {
          if (lower.includes(kw.toLowerCase())) matchCount++;
        }
        return { text: b, score: matchCount };
      });

      // Sort descending by relevance
      scoredBullets.sort((a, b) => b.score - a.score);
      scoredBullets.forEach((item) => outputLines.push(item.text));
      bulletBuffer.length = 0;
    };

    for (const line of lines) {
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        bulletBuffer.push(line);
      } else {
        flushBullets();
        outputLines.push(line);
      }
    }
    flushBullets();

    const tailoredMarkdown = outputLines.join('\n');

    // Build diff summary
    const diffSummary = [
      `### Tailoring Summary for ${job.title} @ ${job.company}`,
      `• Matched Keywords Highlighted: ${matchedKeywords.join(', ') || 'None'}`,
      `• Missing Keywords Gap: ${missingKeywords.join(', ') || 'None'}`,
      `• Bullet points prioritized to highlight automation frameworks and CI/CD tools.`,
    ].join('\n');

    let outputPath: string | undefined;
    if (options?.saveDir) {
      const outDir = path.resolve(options.saveDir);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const cleanCompany = job.company.toLowerCase().replace(/[^a-z0-9]/g, '-');
      outputPath = path.join(outDir, `resume-${cleanCompany}-${job.id || 'draft'}.md`);
      fs.writeFileSync(outputPath, tailoredMarkdown, 'utf-8');
      logger.success(`Tailored resume saved to: ${outputPath}`);
    }

    return {
      tailoredMarkdown,
      matchedKeywords,
      missingKeywords,
      diffSummary,
      outputPath,
    };
  }
}

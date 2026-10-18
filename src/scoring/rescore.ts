// ============================================================
// JobHermes – Rescoring Engine & Integrity Sync
// ============================================================

import { StorageService } from '../storage/database';
import { CandidateProfile, ScoreBreakdown } from '../types';
import { scoringService, ScoringContext } from './scorer';

export interface RescoreResult {
  jobId: number;
  title: string;
  company: string;
  oldScore: number | null;
  newScore: number;
  oldStatus: string;
  newStatus: string;
  breakdown: ScoreBreakdown;
}

/**
 * Re-evaluates every tracked job posting against current candidate profile
 * and active verified signals (excluding demo/test signals).
 * Resets stale 'applied' status to 'new' if no real application record exists.
 */
export function rescoreAllJobs(
  storage: StorageService,
  profile: CandidateProfile
): RescoreResult[] {
  const jobs = storage.getAllJobs();
  const companies = storage.getAllCompanies();
  const applications = storage.getApplications();
  const results: RescoreResult[] = [];

  for (const job of jobs) {
    if (!job.id) continue;

    // Resolve company and non-demo signals
    const comp = companies.find(
      (c) => c.name.toLowerCase().trim() === job.company.toLowerCase().trim()
    );

    const validSignals = comp?.id
      ? storage.getSignals(comp.id).filter((s) => s.source !== 'demo' && s.source !== 'test')
      : [];

    const context: ScoringContext = {
      hasCompanySignal: validSignals.length > 0,
      signalType: validSignals[0]?.signalType,
      signalDetail: validSignals[0]?.detail,
      signalSource: validSignals[0]?.source,
    };

    const breakdown = scoringService.scoreJob(job, profile, context);
    const oldScore = job.score ?? null;
    const oldStatus = job.status;

    // Update job score and breakdown in DB
    storage.updateJobScore(job.id, breakdown.total, breakdown);

    // Reset status from 'applied' to 'new' unless a real application record exists
    let newStatus = oldStatus;
    const hasRealApplication = applications.some((app) => app.jobId === job.id);
    if ((job.status === 'applied' || job.isApplied) && !hasRealApplication) {
      storage.resetApplicationStatus(job.id, 'new');
      newStatus = 'new';
    }

    results.push({
      jobId: job.id,
      title: job.title,
      company: job.company,
      oldScore,
      newScore: breakdown.total,
      oldStatus,
      newStatus,
      breakdown,
    });
  }

  return results;
}

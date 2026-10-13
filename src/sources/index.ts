// ============================================================
// Sources Dispatcher – Orchestrates all ATS and feed adapters
// ============================================================

import { CompanyTarget, RawJob } from '../types';
import { JobSource, deduplicateJobs } from './types';
import { greenhouseSource } from './greenhouse';
import { leverSource } from './lever';
import { ashbySource } from './ashby';
import { workableSource } from './workable';
import { remotiveSource } from './remotive';
import { remoteOKSource } from './remoteok';
import { adzunaSource } from './adzuna';
import { playwrightFallbackSource } from './playwright-fallback';
import { logger } from '../utils/logger';

const ADAPTERS: Record<string, JobSource> = {
  greenhouse: greenhouseSource,
  lever: leverSource,
  ashby: ashbySource,
  workable: workableSource,
  remotive: remotiveSource,
  remoteok: remoteOKSource,
  custom: playwrightFallbackSource,
};

export function getSourceAdapter(ats: string): JobSource | undefined {
  return ADAPTERS[ats];
}

export async function fetchJobsForTarget(target: CompanyTarget): Promise<RawJob[]> {
  const adapter = getSourceAdapter(target.ats);
  if (!adapter) {
    logger.warn(`No adapter found for ATS type '${target.ats}' (${target.name})`);
    return [];
  }

  try {
    return await adapter.fetchJobs(target);
  } catch (err) {
    logger.error(`Failed to fetch jobs for ${target.name} via ${target.ats}`, { error: String(err) });
    return [];
  }
}

export async function fetchAllTargets(targets: CompanyTarget[], concurrency = 3): Promise<RawJob[]> {
  const enabled = targets.filter((t) => t.enabled);
  logger.info(`Fetching jobs across ${enabled.length} enabled targets...`);

  const allJobs: RawJob[] = [];

  for (let i = 0; i < enabled.length; i += concurrency) {
    const batch = enabled.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map((t) => fetchJobsForTarget(t)));

    for (const r of results) {
      if (r.status === 'fulfilled') {
        allJobs.push(...r.value);
      }
    }
  }

  // Also query Adzuna if credentials exist
  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
    try {
      const adzunaJobs = await adzunaSource.fetchJobs({
        name: 'Adzuna India Aggregator',
        domain: 'adzuna.com',
        ats: 'custom',
        slug: 'adzuna-in',
        sizeBucket: 'large',
        locations: ['India'],
        enabled: true,
        verified: true,
      });
      allJobs.push(...adzunaJobs);
    } catch {
      // Ignore
    }
  }

  const deduped = deduplicateJobs(allJobs);
  logger.success(`Fetched total ${allJobs.length} raw jobs, deduplicated to ${deduped.length} unique opportunities.`);
  return deduped;
}

export {
  JobSource,
  deduplicateJobs,
  greenhouseSource,
  leverSource,
  ashbySource,
  workableSource,
  remotiveSource,
  remoteOKSource,
  adzunaSource,
  playwrightFallbackSource,
};

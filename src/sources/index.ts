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

export interface TargetFetchResult {
  target: CompanyTarget;
  success: boolean;
  statusCode?: number;
  jobs: RawJob[];
  error?: string;
  errorType?: 'timeout' | 'http_error' | 'parse_error' | 'network_error' | 'unknown';
}

export async function fetchJobsForTargetDetailed(
  target: CompanyTarget
): Promise<TargetFetchResult> {
  const adapter = getSourceAdapter(target.ats);
  if (!adapter) {
    logger.warn(`No adapter found for ATS type '${target.ats}' (${target.name})`);
    return {
      target,
      success: false,
      jobs: [],
      error: `No adapter found for ATS type '${target.ats}'`,
      errorType: 'unknown',
    };
  }

  try {
    const jobs = await adapter.fetchJobs(target);
    return {
      target,
      success: true,
      statusCode: 200,
      jobs,
    };
  } catch (err: any) {
    let errorType: 'timeout' | 'http_error' | 'parse_error' | 'network_error' = 'network_error';
    let statusCode: number | undefined;

    if (err.name === 'FetchError' || err.errorType) {
      errorType = err.errorType;
      statusCode = err.statusCode;
    } else if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message)) {
      errorType = 'timeout';
    } else if (/HTTP\s+(\d{3})/i.test(err.message)) {
      errorType = 'http_error';
      const m = err.message.match(/HTTP\s+(\d{3})/i);
      if (m) statusCode = parseInt(m[1], 10);
    } else if (/JSON|syntax|parse|cannot read/i.test(err.message)) {
      errorType = 'parse_error';
    }

    logger.warn(
      `Fetch failed for ${target.name} [${errorType}${statusCode ? ` HTTP ${statusCode}` : ''}]: ${err.message}`
    );

    return {
      target,
      success: false,
      statusCode,
      jobs: [],
      error: err.message,
      errorType,
    };
  }
}

export async function fetchJobsForTarget(target: CompanyTarget): Promise<RawJob[]> {
  const res = await fetchJobsForTargetDetailed(target);
  return res.jobs;
}

export async function fetchAllTargetsDetailed(
  targets: CompanyTarget[],
  concurrency = 3
): Promise<{ jobs: RawJob[]; targetResults: TargetFetchResult[] }> {
  const enabled = targets.filter((t) => t.enabled);
  logger.info(`Fetching jobs across ${enabled.length} enabled targets...`);

  const allJobs: RawJob[] = [];
  const targetResults: TargetFetchResult[] = [];

  for (let i = 0; i < enabled.length; i += concurrency) {
    const batch = enabled.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map((t) => fetchJobsForTargetDetailed(t)));

    for (const r of results) {
      if (r.status === 'fulfilled') {
        targetResults.push(r.value);
        if (r.value.success) {
          allJobs.push(...r.value.jobs);
        }
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
  logger.success(
    `Fetched total ${allJobs.length} raw jobs, deduplicated to ${deduped.length} unique opportunities.`
  );
  return { jobs: deduped, targetResults };
}

export async function fetchAllTargets(
  targets: CompanyTarget[],
  concurrency = 3
): Promise<RawJob[]> {
  const detailed = await fetchAllTargetsDetailed(targets, concurrency);
  return detailed.jobs;
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

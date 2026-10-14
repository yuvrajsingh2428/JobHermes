// ============================================================
// Job Sources – Interfaces and normalization utilities
// ============================================================

import { CompanyTarget, RawJob } from '../types';

export interface JobSource {
  name: string;
  fetchJobs(target: CompanyTarget): Promise<RawJob[]>;
}

export function cleanCanonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Strip common tracking query params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gh_src', 'lever-source'];
    trackingParams.forEach((p) => parsed.searchParams.delete(p));
    // Remove trailing slash from pathname if present
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function normalizeJobTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deduplicateJobs(jobs: RawJob[]): RawJob[] {
  const seenUrls = new Set<string>();
  const seenCompoundKeys = new Set<string>();
  const results: RawJob[] = [];

  for (const job of jobs) {
    const canonUrl = cleanCanonicalUrl(job.url);
    const compoundKey = `${job.company.toLowerCase().trim()}::${normalizeJobTitle(job.title)}::${(job.location || '').toLowerCase().trim()}`;

    if (seenUrls.has(canonUrl) || seenCompoundKeys.has(compoundKey)) {
      continue;
    }

    seenUrls.add(canonUrl);
    seenCompoundKeys.add(compoundKey);
    results.push({ ...job, url: canonUrl });
  }

  return results;
}

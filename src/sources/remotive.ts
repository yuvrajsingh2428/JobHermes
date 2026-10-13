// ============================================================
// Remotive Adapter – remotive.com/api/remote-jobs?category=qa
// ============================================================

import { CompanyTarget, RawJob } from '../types';
import { JobSource } from './types';
import { httpClient } from './http-client';
import { stripHtml } from '../utils/helpers';
import { logger } from '../utils/logger';

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  job_type?: string;
  publication_date?: string;
  salary?: string;
  description?: string;
}

interface RemotiveResponse {
  jobs: RemotiveJob[];
}

const QA_KEYWORDS = /\b(sdet|qa|test|automation|quality|software engineer in test)\b/i;

export class RemotiveSource implements JobSource {
  name = 'remotive';

  async fetchJobs(target: CompanyTarget): Promise<RawJob[]> {
    const url = 'https://remotive.com/api/remote-jobs?category=qa';

    try {
      const res = await httpClient.get<RemotiveResponse>(url, { cacheTtlMs: 2 * 60 * 60 * 1000 });

      if (res.status !== 200 || !res.data || !Array.isArray(res.data.jobs)) {
        logger.warn('Remotive fetch returned non-200 or invalid payload', { status: res.status });
        return [];
      }

      // Filter for QA/SDET keywords
      const relevant = res.data.jobs.filter((j) => QA_KEYWORDS.test(j.title));

      return relevant.map((j) => ({
        title: j.title.trim(),
        company: j.company_name || target.name,
        location: j.candidate_required_location || 'Remote',
        isRemote: true,
        url: j.url,
        description: j.description ? stripHtml(j.description) : '',
        postedAt: j.publication_date,
        source: 'remotive',
        rawSalary: j.salary || undefined,
        externalId: String(j.id),
      }));
    } catch (err) {
      logger.error('Error fetching Remotive jobs', { error: String(err) });
      return [];
    }
  }
}

export const remotiveSource = new RemotiveSource();

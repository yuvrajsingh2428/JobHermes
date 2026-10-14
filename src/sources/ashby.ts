// ============================================================
// Ashby Adapter – api.ashbyhq.com/posting-api/job-board/{slug}
// ============================================================

import { CompanyTarget, RawJob } from '../types';
import { JobSource } from './types';
import { httpClient } from './http-client';
import { logger } from '../utils/logger';

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  department?: string;
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

export class AshbySource implements JobSource {
  name = 'ashby';

  async fetchJobs(target: CompanyTarget): Promise<RawJob[]> {
    const slug = target.slug;
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;

    try {
      const res = await httpClient.get<AshbyResponse>(url);

      if (res.status === 404) {
        logger.warn(`Ashby board not found for slug '${slug}' (${target.name})`);
        return [];
      }

      if (res.status !== 200 || !res.data || !Array.isArray(res.data.jobs)) {
        logger.warn(`Ashby fetch non-200 or invalid payload for ${target.name}`, { status: res.status });
        return [];
      }

      return res.data.jobs.map((j) => {
        const loc = j.location || '';
        const isRemote = Boolean(j.isRemote) || /remote/i.test(loc) || /remote/i.test(j.title);
        const jobUrl = j.jobUrl || j.applyUrl || `https://jobs.ashbyhq.com/${slug}/${j.id}`;

        return {
          title: j.title.trim(),
          company: target.name,
          location: loc,
          isRemote,
          url: jobUrl,
          description: j.descriptionPlain || '',
          postedAt: j.publishedAt,
          source: 'ashby',
          externalId: j.id,
        };
      });
    } catch (err) {
      logger.error(`Error fetching Ashby jobs for ${target.name} (${slug})`, { error: String(err) });
      return [];
    }
  }
}

export const ashbySource = new AshbySource();

// ============================================================
// Workable Adapter – apply.workable.com/api/v1/widget/accounts/{slug}
// ============================================================

import { CompanyTarget, RawJob } from '../types';
import { JobSource } from './types';
import { httpClient } from './http-client';
import { logger } from '../utils/logger';

interface WorkableJob {
  title: string;
  shortcode: string;
  url?: string;
  city?: string;
  state?: string;
  country?: string;
  telecommuting?: boolean;
  published_on?: string;
  description?: string;
}

interface WorkableResponse {
  name?: string;
  jobs: WorkableJob[];
}

export class WorkableSource implements JobSource {
  name = 'workable';

  async fetchJobs(target: CompanyTarget): Promise<RawJob[]> {
    const slug = target.slug;
    const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`;

    try {
      const res = await httpClient.get<WorkableResponse>(url);

      if (res.status === 404) {
        logger.warn(`Workable widget not found for slug '${slug}' (${target.name})`);
        return [];
      }

      if (res.status !== 200 || !res.data || !Array.isArray(res.data.jobs)) {
        logger.warn(`Workable fetch non-200 or invalid payload for ${target.name}`, { status: res.status });
        return [];
      }

      return res.data.jobs.map((j) => {
        const locParts = [j.city, j.state, j.country].filter(Boolean);
        const loc = locParts.join(', ') || (j.telecommuting ? 'Remote' : '');
        const isRemote = Boolean(j.telecommuting) || /remote/i.test(loc) || /remote/i.test(j.title);
        const jobUrl = j.url || `https://apply.workable.com/${slug}/j/${j.shortcode}/`;

        return {
          title: j.title.trim(),
          company: target.name,
          location: loc,
          isRemote,
          url: jobUrl,
          description: j.description || '',
          postedAt: j.published_on,
          source: 'workable',
          externalId: j.shortcode,
        };
      });
    } catch (err) {
      logger.error(`Error fetching Workable jobs for ${target.name} (${slug})`, { error: String(err) });
      return [];
    }
  }
}

export const workableSource = new WorkableSource();

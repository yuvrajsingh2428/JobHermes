// ============================================================
// Adzuna India Adapter – Optional aggregator behind env flags
// ============================================================

import { CompanyTarget, RawJob } from '../types';
import { JobSource } from './types';
import { httpClient } from './http-client';
import { logger } from '../utils/logger';

interface AdzunaJob {
  id: string;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url: string;
  description?: string;
  created?: string;
  salary_min?: number;
  salary_max?: number;
}

interface AdzunaResponse {
  results: AdzunaJob[];
}

export class AdzunaSource implements JobSource {
  name = 'adzuna';

  async fetchJobs(target: CompanyTarget): Promise<RawJob[]> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;

    if (!appId || !appKey) {
      logger.debug(
        'Adzuna API credentials not configured (ADZUNA_APP_ID / ADZUNA_APP_KEY), skipping gracefully.'
      );
      return [];
    }

    const keyword = encodeURIComponent('SDET QA Automation');
    const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${appId}&app_key=${appKey}&what=${keyword}&results_per_page=25`;

    try {
      const res = await httpClient.get<AdzunaResponse>(url, { cacheTtlMs: 2 * 60 * 60 * 1000 });

      if (res.status !== 200 || !res.data || !Array.isArray(res.data.results)) {
        logger.warn('Adzuna API returned non-200 or invalid payload', { status: res.status });
        return [];
      }

      return res.data.results.map((j) => {
        const companyName = j.company?.display_name || target.name;
        const loc = j.location?.display_name || 'India';
        const isRemote = /remote/i.test(loc) || /remote/i.test(j.title);

        let salaryStr: string | undefined;
        if (j.salary_min && j.salary_max) {
          salaryStr = `${j.salary_min} - ${j.salary_max} INR`;
        }

        return {
          title: j.title.trim(),
          company: companyName,
          location: loc,
          isRemote,
          url: j.redirect_url,
          description: j.description || '',
          postedAt: j.created,
          source: 'adzuna',
          rawSalary: salaryStr,
          externalId: j.id,
        };
      });
    } catch (err) {
      logger.error('Error fetching Adzuna jobs', { error: String(err) });
      return [];
    }
  }
}

export const adzunaSource = new AdzunaSource();

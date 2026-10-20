// ============================================================
// Greenhouse Adapter – boards-api.greenhouse.io
// ============================================================

import { CompanyTarget, RawJob } from '../types';
import { JobSource, FetchError } from './types';
import { httpClient } from './http-client';
import { stripHtml } from '../utils/helpers';
import { logger } from '../utils/logger';

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  updated_at?: string;
  content?: string;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export class GreenhouseSource implements JobSource {
  name = 'greenhouse';

  async fetchJobs(target: CompanyTarget): Promise<RawJob[]> {
    const slug = target.slug;
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;

    try {
      const res = await httpClient.get<GreenhouseResponse>(url);

      if (res.status === 404) {
        throw new FetchError(
          `Greenhouse board not found for slug '${slug}' (${target.name})`,
          'http_error',
          404
        );
      }

      if (res.status >= 400) {
        throw new FetchError(
          `Greenhouse fetch failed with HTTP ${res.status} for ${target.name}`,
          'http_error',
          res.status
        );
      }

      if (res.status !== 200 || !res.data || !Array.isArray(res.data.jobs)) {
        throw new FetchError(
          `Greenhouse invalid payload for ${target.name}`,
          'parse_error',
          res.status
        );
      }

      return res.data.jobs.map((j) => {
        const loc = j.location?.name || '';
        const isRemote = /remote/i.test(loc) || /remote/i.test(j.title);
        const description = j.content ? stripHtml(j.content) : '';

        return {
          title: j.title.trim(),
          company: target.name,
          location: loc,
          isRemote,
          url: j.absolute_url,
          description,
          postedAt: j.updated_at,
          source: 'greenhouse',
          externalId: String(j.id),
        };
      });
    } catch (err) {
      logger.error(`Error fetching Greenhouse jobs for ${target.name} (${slug})`, {
        error: String(err),
      });
      throw err;
    }
  }
}

export const greenhouseSource = new GreenhouseSource();

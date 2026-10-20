// ============================================================
// Lever Adapter – api.lever.co/v0/postings/{slug}?mode=json
// ============================================================

import { CompanyTarget, RawJob } from '../types';
import { JobSource, FetchError } from './types';
import { httpClient } from './http-client';
import { logger } from '../utils/logger';

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
    workplaceType?: string;
  };
  descriptionPlain?: string;
  additionalPlain?: string;
}

export class LeverSource implements JobSource {
  name = 'lever';

  async fetchJobs(target: CompanyTarget): Promise<RawJob[]> {
    const slug = target.slug;
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;

    try {
      const res = await httpClient.get<LeverJob[]>(url);

      if (res.status === 404) {
        throw new FetchError(
          `Lever postings not found for slug '${slug}' (${target.name})`,
          'http_error',
          404
        );
      }

      if (res.status >= 400) {
        throw new FetchError(
          `Lever fetch failed with HTTP ${res.status} for ${target.name}`,
          'http_error',
          res.status
        );
      }

      if (res.status !== 200 || !Array.isArray(res.data)) {
        throw new FetchError(
          `Lever fetch invalid payload for ${target.name}`,
          'parse_error',
          res.status
        );
      }

      return res.data.map((j) => {
        const loc = j.categories?.location || '';
        const workplace = (j.categories?.workplaceType || '').toLowerCase();
        const isRemote = workplace === 'remote' || /remote/i.test(loc) || /remote/i.test(j.text);
        const description = [j.descriptionPlain || '', j.additionalPlain || '']
          .filter(Boolean)
          .join('\n\n');

        return {
          title: j.text.trim(),
          company: target.name,
          location: loc,
          isRemote,
          url: j.hostedUrl,
          description,
          postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
          source: 'lever',
          externalId: j.id,
        };
      });
    } catch (err) {
      logger.error(`Error fetching Lever jobs for ${target.name} (${slug})`, {
        error: String(err),
      });
      throw err;
    }
  }
}

export const leverSource = new LeverSource();

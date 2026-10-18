// ============================================================
// RemoteOK Adapter – remoteok.com/api?tag=qa
// ============================================================

import { CompanyTarget, RawJob } from '../types';
import { JobSource } from './types';
import { httpClient } from './http-client';
import { stripHtml } from '../utils/helpers';
import { logger } from '../utils/logger';

interface RemoteOKItem {
  id?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  url?: string;
  apply_url?: string;
}

const QA_KEYWORDS = /\b(sdet|qa|test|automation|quality|software engineer in test)\b/i;

export class RemoteOKSource implements JobSource {
  name = 'remoteok';

  async fetchJobs(target: CompanyTarget): Promise<RawJob[]> {
    const url = 'https://remoteok.com/api?tag=qa';

    try {
      const res = await httpClient.get<unknown[]>(url, { cacheTtlMs: 2 * 60 * 60 * 1000 });

      if (res.status !== 200 || !Array.isArray(res.data)) {
        logger.warn('RemoteOK fetch returned non-200 or invalid payload', { status: res.status });
        return [];
      }

      // Filter out meta objects (first item usually has legal/meta without 'position')
      const jobs = res.data.filter(
        (item): item is RemoteOKItem =>
          typeof item === 'object' &&
          item !== null &&
          'position' in item &&
          typeof (item as RemoteOKItem).position === 'string'
      );

      const relevant = jobs.filter((j) => QA_KEYWORDS.test(j.position || ''));

      return relevant.map((j) => {
        const title = (j.position || '').trim();
        const jobUrl = j.apply_url || j.url || `https://remoteok.com/remote-jobs/${j.id}`;
        const description = j.description ? stripHtml(j.description) : '';

        return {
          title,
          company: j.company || target.name,
          location: j.location || 'Remote',
          isRemote: true,
          url: jobUrl,
          description,
          postedAt: j.date || (j.epoch ? new Date(j.epoch * 1000).toISOString() : undefined),
          source: 'remoteok',
          externalId: j.id ? String(j.id) : undefined,
        };
      });
    } catch (err) {
      logger.error('Error fetching RemoteOK jobs', { error: String(err) });
      return [];
    }
  }
}

export const remoteOKSource = new RemoteOKSource();

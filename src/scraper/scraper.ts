// ============================================================
// Job Scraper Service – Scrapes job boards using TinyFetch
// ============================================================

import { TinyFetch } from './tinyfetch';
import { CompanyTarget, RawJob, ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { sleep, stripHtml, truncate } from '../utils/helpers';
import * as cheerio from 'cheerio';

export class ScraperService {
  private fetcher: TinyFetch;

  constructor(options?: {
    userAgent?: string;
    timeout?: number;
    delayMs?: number;
    retries?: number;
  }) {
    this.fetcher = new TinyFetch(options);
  }

  // ─── Main Scrape Method ────────────────────────────────────

  async scrapeCompany(target: CompanyTarget): Promise<ScrapeResult> {
    logger.info(`🔍 Scraping: ${target.name}`, { url: target.careers_url });

    const result: ScrapeResult = {
      company: target.name,
      source: target.careers_url,
      jobs: [],
      scrapedAt: new Date().toISOString(),
    };

    try {
      const fetchResult = await this.fetcher.fetch({
        url: target.careers_url,
        retries: 3,
      });

      if (!fetchResult.success) {
        result.error = `HTTP ${fetchResult.status}: ${fetchResult.error || 'Unknown error'}`;
        logger.warn(`Scrape failed for ${target.name}`, { error: result.error });
        return result;
      }

      const jobs = this.parseJobListings(fetchResult.html, target);
      result.jobs = jobs;
      logger.info(`✅ ${target.name}: found ${jobs.length} jobs`);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      logger.error(`Scrape error for ${target.name}`, { error: result.error });
    }

    return result;
  }

  async scrapeAll(targets: CompanyTarget[], concurrency = 3): Promise<ScrapeResult[]> {
    const enabled = targets.filter((t) => t.enabled);
    logger.info(`Starting scrape for ${enabled.length} companies`);

    const results: ScrapeResult[] = [];

    // Process in batches to respect concurrency
    for (let i = 0; i < enabled.length; i += concurrency) {
      const batch = enabled.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(batch.map((t) => this.scrapeCompany(t)));

      for (const r of batchResults) {
        if (r.status === 'fulfilled') results.push(r.value);
      }

      if (i + concurrency < enabled.length) {
        await sleep(2000);
      }
    }

    const totalJobs = results.reduce((sum, r) => sum + r.jobs.length, 0);
    logger.success(`Scrape complete: ${totalJobs} jobs from ${results.length} sources`);

    return results;
  }

  // ─── Parser Strategies ─────────────────────────────────────

  private parseJobListings(html: string, target: CompanyTarget): RawJob[] {
    // Try JSON-LD first (most reliable)
    const structuredJobs = this.parseJsonLd(html, target);
    if (structuredJobs.length > 0) return structuredJobs;

    // Fall back to heuristic HTML parsing
    return this.parseHtmlHeuristic(html, target);
  }

  private parseJsonLd(html: string, target: CompanyTarget): RawJob[] {
    const structured = this.fetcher.extractStructuredData(html);
    const jobs: RawJob[] = [];

    for (const data of structured) {
      if (data['@type'] === 'JobPosting') {
        jobs.push(this.jsonLdToRawJob(data, target));
      } else if (data['@type'] === 'ItemList' && Array.isArray(data['itemListElement'])) {
        const elements = data['itemListElement'] as Record<string, unknown>[];
        for (const el of elements) {
          const item = el['item'] as Record<string, unknown> | undefined;
          if (item?.['@type'] === 'JobPosting') {
            jobs.push(this.jsonLdToRawJob(item, target));
          }
        }
      }
    }

    return jobs;
  }

  private jsonLdToRawJob(data: Record<string, unknown>, target: CompanyTarget): RawJob {
    const hiringOrg = data['hiringOrganization'] as Record<string, unknown> | undefined;
    const jobLocation = data['jobLocation'] as Record<string, unknown> | undefined;
    const address = jobLocation?.['address'] as Record<string, unknown> | undefined;

    const baseSalary = data['baseSalary'] as Record<string, unknown> | undefined;
    const salaryValue = baseSalary?.['value'] as Record<string, unknown> | undefined;

    return {
      title: String(data['title'] || data['name'] || ''),
      company: String(hiringOrg?.['name'] || target.name),
      location: String(
        address?.['addressLocality'] || address?.['addressRegion'] || jobLocation?.['name'] || ''
      ),
      url: String(data['url'] || data['@id'] || ''),
      description: stripHtml(String(data['description'] || '')),
      salary: salaryValue
        ? `${salaryValue['minValue'] || ''}-${salaryValue['maxValue'] || ''} ${baseSalary?.['currency'] || 'INR'}`
        : undefined,
      jobType: String(data['employmentType'] || ''),
      postedAt: String(data['datePosted'] || ''),
    };
  }

  private parseHtmlHeuristic(html: string, target: CompanyTarget): RawJob[] {
    const $ = cheerio.load(html);
    const jobs: RawJob[] = [];

    // Common job listing selectors across major job boards
    const containerSelectors = [
      '[data-job-id]',
      '[class*="job-card"]',
      '[class*="job-item"]',
      '[class*="job-listing"]',
      '[class*="JobCard"]',
      '[class*="job_listing"]',
      'li[class*="job"]',
      '.job',
      '.jobs-search-results__list-item',
      '[class*="result-card"]',
    ];

    let container = '';
    for (const sel of containerSelectors) {
      if ($(sel).length > 0) {
        container = sel;
        break;
      }
    }

    if (!container) {
      // Generic: look for lists of links that look like job titles
      logger.debug(`No job container found for ${target.name}, using link heuristic`);
      return this.extractJobLinks(html, target);
    }

    $(container).each((_, el) => {
      const titleSelectors = ['h2', 'h3', '.title', '[class*="title"]', '[class*="job-title"]', 'a'];
      let title = '';
      for (const sel of titleSelectors) {
        const text = $(el).find(sel).first().text().trim();
        if (text.length > 5 && text.length < 150) {
          title = text;
          break;
        }
      }

      const link = $(el).find('a').first().attr('href') || '';
      const fullUrl = link.startsWith('http') ? link : this.resolveUrl(link, target.careers_url);

      const locationEl = $(el).find('[class*="location"], [class*="Location"]').first().text().trim();
      const salaryEl = $(el).find('[class*="salary"], [class*="Salary"], [class*="compensation"]').first().text().trim();
      const companyEl = $(el).find('[class*="company"], [class*="Company"]').first().text().trim();

      if (title && fullUrl) {
        jobs.push({
          title,
          company: companyEl || target.name,
          location: locationEl || 'India',
          url: fullUrl,
          description: truncate(stripHtml($(el).text()), 500),
          salary: salaryEl || undefined,
        });
      }
    });

    return jobs;
  }

  private extractJobLinks(html: string, target: CompanyTarget): RawJob[] {
    const $ = cheerio.load(html);
    const jobs: RawJob[] = [];
    const seen = new Set<string>();

    const jobKeywords = /engineer|developer|analyst|manager|designer|scientist|architect|lead|senior|junior/i;

    $('a').each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href') || '';

      if (text.length > 10 && text.length < 120 && jobKeywords.test(text) && href) {
        const fullUrl = href.startsWith('http') ? href : this.resolveUrl(href, target.careers_url);
        if (!seen.has(fullUrl)) {
          seen.add(fullUrl);
          jobs.push({
            title: text,
            company: target.name,
            location: 'India',
            url: fullUrl,
            description: '',
          });
        }
      }
    });

    return jobs.slice(0, 30); // Cap at 30 to avoid noise
  }

  private resolveUrl(href: string, base: string): string {
    try {
      return new URL(href, base).toString();
    } catch {
      return href;
    }
  }

  // ─── Job Detail Fetcher ────────────────────────────────────

  async fetchJobDetail(url: string): Promise<string> {
    const result = await this.fetcher.fetch({ url });
    if (!result.success) return '';

    const $ = cheerio.load(result.html);

    // Try common job description containers
    const descSelectors = [
      '[class*="description"]',
      '[class*="job-detail"]',
      '[class*="job-content"]',
      'article',
      'main',
      '#job-description',
    ];

    for (const sel of descSelectors) {
      const text = $(sel).first().text().trim();
      if (text.length > 100) {
        return truncate(stripHtml(text), 3000);
      }
    }

    return truncate(stripHtml(result.html), 2000);
  }
}

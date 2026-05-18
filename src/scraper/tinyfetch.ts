// ============================================================
// TinyFetch – Lightweight HTTP scraping client with retry,
// rate limiting, and structured response parsing
// ============================================================

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { FetchOptions, FetchResult } from '../types';
import { logger } from '../utils/logger';
import { sleep, withRetry } from '../utils/helpers';

export class TinyFetch {
  private client: AxiosInstance;
  private defaultDelay: number;
  private defaultRetries: number;

  constructor(options?: {
    userAgent?: string;
    timeout?: number;
    delayMs?: number;
    retries?: number;
  }) {
    this.defaultDelay = options?.delayMs ?? 1500;
    this.defaultRetries = options?.retries ?? 3;

    this.client = axios.create({
      timeout: options?.timeout ?? 10000,
      headers: {
        'User-Agent':
          options?.userAgent ??
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });
  }

  // ─── Core Fetch ────────────────────────────────────────────

  async fetch(options: FetchOptions): Promise<FetchResult> {
    const startTime = Date.now();
    const retries = options.retries ?? this.defaultRetries;
    const delay = options.delayMs ?? this.defaultDelay;

    try {
      const response: AxiosResponse<string> = await withRetry(
        () =>
          this.client.get<string>(options.url, {
            headers: options.headers,
            timeout: options.timeout,
          }),
        retries,
        delay
      );

      await sleep(delay);

      return {
        url: options.url,
        status: response.status,
        html: response.data || '',
        success: response.status >= 200 && response.status < 400,
        responseTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn('TinyFetch error', { url: options.url, error: errMsg });

      return {
        url: options.url,
        status: 0,
        html: '',
        success: false,
        error: errMsg,
        responseTimeMs: Date.now() - startTime,
      };
    }
  }

  // ─── HTML Parsing Helpers ──────────────────────────────────

  parse(html: string): ReturnType<typeof cheerio.load> {
    return cheerio.load(html);
  }

  /**
   * Extract job listings matching a selector pattern
   */
  extractJobLinks(
    html: string,
    selectors: {
      container: string;
      title?: string;
      link?: string;
      company?: string;
      location?: string;
      salary?: string;
    }
  ): Array<{ title: string; url: string; company?: string; location?: string; salary?: string }> {
    const $ = this.parse(html);
    const results: Array<{ title: string; url: string; company?: string; location?: string; salary?: string }> = [];

    $(selectors.container).each((_, el) => {
      const titleEl = selectors.title ? $(el).find(selectors.title) : $(el).find('h2, h3, h4, a');
      const linkEl = selectors.link ? $(el).find(selectors.link) : $(el).find('a');

      const title = titleEl.first().text().trim();
      const rawUrl = linkEl.first().attr('href') || '';
      const company = selectors.company ? $(el).find(selectors.company).text().trim() : undefined;
      const location = selectors.location ? $(el).find(selectors.location).text().trim() : undefined;
      const salary = selectors.salary ? $(el).find(selectors.salary).text().trim() : undefined;

      if (title && rawUrl) {
        results.push({ title, url: rawUrl, company, location, salary });
      }
    });

    return results;
  }

  /**
   * Extract JSON-LD structured data from a page
   */
  extractStructuredData(html: string): Record<string, unknown>[] {
    const $ = this.parse(html);
    const results: Record<string, unknown>[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || '{}') as Record<string, unknown>;
        results.push(json);
      } catch {
        // Skip invalid JSON
      }
    });

    return results;
  }

  /**
   * Extract text content from a page element
   */
  extractText(html: string, selector: string): string {
    const $ = this.parse(html);
    return $(selector).text().trim();
  }

  /**
   * Extract all links matching a pattern from a page
   */
  extractLinks(html: string, baseUrl: string, pattern?: RegExp): string[] {
    const $ = this.parse(html);
    const links = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      try {
        const absoluteUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
        if (!pattern || pattern.test(absoluteUrl)) {
          links.add(absoluteUrl);
        }
      } catch {
        // Skip invalid URLs
      }
    });

    return [...links];
  }

  /**
   * Fetch multiple URLs with rate limiting
   */
  async fetchMultiple(
    urls: string[],
    options?: Partial<FetchOptions>
  ): Promise<FetchResult[]> {
    const results: FetchResult[] = [];

    for (const url of urls) {
      const result = await this.fetch({ url, ...options });
      results.push(result);
      await sleep(this.defaultDelay);
    }

    return results;
  }
}

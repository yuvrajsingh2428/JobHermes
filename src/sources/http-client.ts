// ============================================================
// Shared HTTP Client – Rate limiting, backoff, cache, User-Agent
// ============================================================

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { sourceCache } from './cache';
import { logger } from '../utils/logger';

export interface HttpClientOptions {
  userAgent?: string;
  timeoutMs?: number;
  minHostDelayMs?: number;
  maxRetries?: number;
}

export interface RequestOptions extends AxiosRequestConfig {
  useCache?: boolean;
  cacheTtlMs?: number;
  retries?: number;
}

export class HttpClient {
  private client: AxiosInstance;
  private hostQueues = new Map<string, Promise<void>>();
  private minHostDelayMs: number;
  private maxRetries: number;

  constructor(options?: HttpClientOptions) {
    const userAgent =
      options?.userAgent ??
      'JobHermes-Copilot/1.0 (+https://github.com/yuvrajsingh2428/JobHermes; SDET Job Search Copilot)';
    this.minHostDelayMs = options?.minHostDelayMs ?? 1200;
    this.maxRetries = options?.maxRetries ?? 3;

    this.client = axios.create({
      timeout: options?.timeoutMs ?? 15000,
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      validateStatus: (status) => status < 500, // Handle 5xx manually in retry loop
    });
  }

  private getHost(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'default';
    }
  }

  /**
   * Serializes requests per host with minimum delay to respect rate limits
   */
  private async rateLimitHost(host: string): Promise<void> {
    const prev = this.hostQueues.get(host) || Promise.resolve();
    let resolveCurrent: () => void = () => {};
    const current = new Promise<void>((res) => {
      resolveCurrent = res;
    });

    // Update the queue tail
    this.hostQueues.set(host, current);

    // Wait for previous request on this host to complete + delay
    await prev;
    await new Promise((resolve) => setTimeout(resolve, this.minHostDelayMs));
    resolveCurrent();
  }

  async get<T = unknown>(
    url: string,
    options?: RequestOptions
  ): Promise<{ data: T; status: number; fromCache: boolean }> {
    const useCache = options?.useCache ?? true;
    const cacheKey = `GET:${url}:${JSON.stringify(options?.params || {})}`;

    if (useCache) {
      const cached = sourceCache.get<T>(cacheKey);
      if (cached !== null) {
        return { data: cached, status: 200, fromCache: true };
      }
    }

    const host = this.getHost(url);
    const maxRetries = options?.retries ?? this.maxRetries;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      await this.rateLimitHost(host);

      try {
        const response: AxiosResponse<T> = await this.client.get<T>(url, options);

        if (response.status === 429 || response.status >= 500) {
          attempt++;
          if (attempt > maxRetries) {
            throw new Error(`HTTP ${response.status} from ${url} after ${maxRetries} retries`);
          }

          let backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          const retryAfter = response.headers['retry-after'];
          if (retryAfter) {
            const parsed = parseInt(retryAfter, 10);
            if (!isNaN(parsed)) backoffMs = parsed * 1000;
          }

          logger.warn(
            `Backing off ${Math.round(backoffMs)}ms due to HTTP ${response.status} from ${host}`
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        if (response.status >= 200 && response.status < 300) {
          if (useCache) {
            sourceCache.set(cacheKey, response.data, options?.cacheTtlMs);
          }
          return { data: response.data, status: response.status, fromCache: false };
        }

        // 3xx / 4xx (e.g. 404, 403)
        return { data: response.data, status: response.status, fromCache: false };
      } catch (err) {
        attempt++;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt > maxRetries) {
          break;
        }
        const backoffMs = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    throw lastError || new Error(`Failed to GET ${url}`);
  }
}

export const httpClient = new HttpClient();

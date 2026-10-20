// ============================================================
// Hunter.io Adapter – Optional enrichment with monthly quota cap
// ============================================================

import { StorageService } from '../storage/database';
import { httpClient } from '../sources/http-client';
import { logger } from '../utils/logger';

export interface HunterDomainSearchResult {
  domain: string;
  pattern?: string;
  emails: Array<{
    value: string;
    type: string;
    confidence: number;
    firstName?: string;
    lastName?: string;
    position?: string;
  }>;
}

export interface HunterEmailFinderResult {
  email?: string;
  score?: number;
  position?: string;
}

export interface HunterVerificationResult {
  email: string;
  status: 'valid' | 'invalid' | 'accept_all' | 'unknown';
  score?: number;
}

export class HunterAdapter {
  private apiKey?: string;
  private storage: StorageService;
  private monthlyCap: number;

  constructor(storage: StorageService, monthlyCap = 25) {
    this.apiKey = process.env.HUNTER_API_KEY;
    this.storage = storage;
    this.monthlyCap = parseInt(process.env.HUNTER_MONTHLY_CAP || String(monthlyCap), 10);
  }

  private getCurrentMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private getApiKey(): string | undefined {
    return this.apiKey || process.env.HUNTER_API_KEY;
  }

  private canMakeCall(): { allowed: boolean; reason?: string } {
    const key = this.getApiKey();
    if (!key) {
      return { allowed: false, reason: 'HUNTER_API_KEY is not set' };
    }

    const month = this.getCurrentMonth();
    const currentUsage = this.storage.getApiUsage('hunter', month);
    if (currentUsage >= this.monthlyCap) {
      logger.warn(
        `Hunter.io monthly quota cap (${this.monthlyCap}) reached for ${month}. Refusing call.`
      );
      return {
        allowed: false,
        reason: `Monthly cap of ${this.monthlyCap} calls reached for ${month}`,
      };
    }

    return { allowed: true };
  }

  private recordCall(): void {
    const month = this.getCurrentMonth();
    const count = this.storage.incrementApiUsage('hunter', month);
    logger.debug(`Hunter.io API call recorded. Monthly total: ${count}/${this.monthlyCap}`);
  }

  async domainSearch(domain: string): Promise<HunterDomainSearchResult | null> {
    const check = this.canMakeCall();
    if (!check.allowed) return null;

    const apiKey = this.getApiKey();
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`;
    try {
      const res = await httpClient.get<any>(url, {
        useCache: true,
        cacheTtlMs: 24 * 60 * 60 * 1000,
      });
      if (res.status === 200 && res.data?.data) {
        if (!res.fromCache) this.recordCall();
        const data = res.data.data;
        return {
          domain: data.domain,
          pattern: data.pattern,
          emails: (data.emails || []).map((e: any) => ({
            value: e.value,
            type: e.type,
            confidence: e.confidence,
            firstName: e.first_name,
            lastName: e.last_name,
            position: e.position,
          })),
        };
      }
      return null;
    } catch (err: any) {
      logger.warn(`Hunter domainSearch error for ${domain}`, { error: err.message });
      return null;
    }
  }

  async emailFinder(
    domain: string,
    firstName: string,
    lastName: string
  ): Promise<HunterEmailFinderResult | null> {
    const check = this.canMakeCall();
    if (!check.allowed) return null;

    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${this.apiKey}`;
    try {
      const res = await httpClient.get<any>(url, { useCache: true });
      if (res.status === 200 && res.data?.data) {
        if (!res.fromCache) this.recordCall();
        const data = res.data.data;
        return {
          email: data.email,
          score: data.score,
          position: data.position,
        };
      }
      return null;
    } catch (err: any) {
      logger.warn(`Hunter emailFinder error for ${firstName} ${lastName} @ ${domain}`, {
        error: err.message,
      });
      return null;
    }
  }

  async verifyEmail(email: string): Promise<HunterVerificationResult | null> {
    const check = this.canMakeCall();
    if (!check.allowed) return null;

    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${this.apiKey}`;
    try {
      const res = await httpClient.get<any>(url, { useCache: true });
      if (res.status === 200 && res.data?.data) {
        if (!res.fromCache) this.recordCall();
        const data = res.data.data;
        return {
          email,
          status:
            data.result === 'deliverable'
              ? 'valid'
              : data.result === 'undeliverable'
                ? 'invalid'
                : 'unknown',
          score: data.score,
        };
      }
      return null;
    } catch (err: any) {
      logger.warn(`Hunter verifyEmail error for ${email}`, { error: err.message });
      return null;
    }
  }
}

// ============================================================
// Playwright Fallback Adapter – For custom JS-rendered career pages
// ============================================================

import { chromium, Browser } from 'playwright';
import { CompanyTarget, RawJob } from '../types';
import { JobSource } from './types';
import { logger } from '../utils/logger';

export class PlaywrightFallbackSource implements JobSource {
  name = 'playwright_custom';

  async fetchJobs(target: CompanyTarget): Promise<RawJob[]> {
    const customUrl = target.customUrl || target.slug;
    if (!customUrl || (!customUrl.startsWith('http') && !customUrl.startsWith('file://'))) {
      logger.debug(`No valid custom URL for Playwright fallback on ${target.name}`);
      return [];
    }

    const listSelector = target.listSelector || '[data-job-id], .job-card, .job-item, li[class*="job"]';
    const titleSelector = target.titleSelector || 'h2, h3, h4, .title, a';
    const linkSelector = target.linkSelector || 'a';

    let browser: Browser | null = null;
    const results: RawJob[] = [];

    try {
      logger.info(`Running Playwright fallback scraper for ${target.name}`, { url: customUrl });
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      await page.goto(customUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait a short moment for dynamic JS hydration (skip wait for local file:// fixtures)
      if (!customUrl.startsWith('file://')) {
        await page.waitForTimeout(2500);
      }

      const jobCards = await page.$$(listSelector);
      logger.info(`Found ${jobCards.length} potential cards for ${target.name}`);

      for (const card of jobCards) {
        try {
          const titleEl = await card.$(titleSelector);
          const title = titleEl ? (await titleEl.innerText()).trim() : '';

          const linkEl = await card.$(linkSelector);
          const href = linkEl ? await linkEl.getAttribute('href') : '';

          if (title && href && title.length > 3) {
            let fullUrl = href;
            try {
              fullUrl = new URL(href, customUrl).toString();
            } catch {
              fullUrl = href;
            }

            const isRemote = /remote/i.test(title);

            results.push({
              title,
              company: target.name,
              location: 'India',
              isRemote,
              url: fullUrl,
              description: '',
              source: 'playwright_custom',
            });
          }
        } catch {
          // Skip card parsing error
        }
      }
    } catch (err) {
      logger.error(`Playwright fallback failed for ${target.name}`, { error: String(err) });
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }

    return results;
  }
}

export const playwrightFallbackSource = new PlaywrightFallbackSource();

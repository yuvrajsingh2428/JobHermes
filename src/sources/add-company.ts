// ============================================================
// Add Company CLI Tool – Detects ATS, extracts slug, validates & saves
// ============================================================

import fs from 'fs';
import path from 'path';
import { CompanyTarget, AtsProvider } from '../types';
import { verifyTargetSlug } from './verify-targets';
import { logger } from '../utils/logger';

export interface DetectedAts {
  ats: AtsProvider;
  slug: string;
  isCustom: boolean;
}

export function detectAtsFromUrl(rawUrl: string): DetectedAts {
  let urlObj: URL;
  try {
    urlObj = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { ats: 'custom', slug: rawUrl, isCustom: true };
  }

  const hostname = urlObj.hostname.toLowerCase();
  const pathname = urlObj.pathname.replace(/^\/+|\/+$/g, '');
  const segments = pathname.split('/').filter(Boolean);

  // 1. Greenhouse (e.g. boards.greenhouse.io/postman or postman.greenhouse.io)
  if (hostname.includes('greenhouse.io')) {
    if (segments.length > 0 && segments[0] !== 'embed') {
      return { ats: 'greenhouse', slug: segments[0], isCustom: false };
    }
    const hostParts = hostname.split('.');
    if (hostParts.length > 2 && hostParts[0] !== 'boards') {
      return { ats: 'greenhouse', slug: hostParts[0], isCustom: false };
    }
  }

  // 2. Lever (e.g. jobs.lever.co/cred or cred.lever.co)
  if (hostname.includes('lever.co')) {
    if (segments.length > 0) {
      return { ats: 'lever', slug: segments[0], isCustom: false };
    }
    const hostParts = hostname.split('.');
    if (hostParts.length > 2 && hostParts[0] !== 'jobs') {
      return { ats: 'lever', slug: hostParts[0], isCustom: false };
    }
  }

  // 3. Ashby (e.g. jobs.ashbyhq.com/wingify)
  if (hostname.includes('ashbyhq.com')) {
    if (segments.length > 0) {
      return { ats: 'ashby', slug: segments[0], isCustom: false };
    }
  }

  // 4. Workable (e.g. apply.workable.com/leadsquared or leadsquared.workable.com)
  if (hostname.includes('workable.com')) {
    if (segments.length > 0 && segments[0] !== 'j') {
      return { ats: 'workable', slug: segments[0], isCustom: false };
    }
    const hostParts = hostname.split('.');
    if (hostParts.length > 2 && hostParts[0] !== 'apply') {
      return { ats: 'workable', slug: hostParts[0], isCustom: false };
    }
  }

  return { ats: 'custom', slug: rawUrl, isCustom: true };
}

export function inferCompanyName(slug: string, domain: string): string {
  if (slug && !slug.startsWith('http') && slug.length < 30) {
    const cleaned = slug.replace(/[-_]/g, ' ');
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  const domainParts = domain.replace(/^www\./, '').split('.');
  const name = domainParts[0] || 'Unknown Company';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export async function addCompanyFromUrl(
  careersUrl: string,
  configPath = './config/company-targets.json'
): Promise<CompanyTarget> {
  const normalizedUrl = careersUrl.trim();
  let domain = 'custom.com';
  try {
    const parsed = new URL(
      normalizedUrl.startsWith('http') ? normalizedUrl : `https://${normalizedUrl}`
    );
    domain = parsed.hostname.replace(/^www\./, '');
  } catch {
    // Ignore
  }

  const detected = detectAtsFromUrl(normalizedUrl);
  const companyName = inferCompanyName(detected.slug, domain);

  const targetEntry: CompanyTarget = {
    name: companyName,
    domain,
    ats: detected.ats,
    slug: detected.slug,
    sizeBucket: 'mid',
    locations: ['India', 'Remote India'],
    enabled: true,
    verified: false,
    notes: `Added via add-company from ${normalizedUrl}`,
    ...(detected.isCustom
      ? {
          customUrl: normalizedUrl,
          listSelector: '[data-job-id], .job-card, .job-listing, li[class*="job"]',
          titleSelector: 'h2, h3, .title, a',
          linkSelector: 'a',
        }
      : {}),
  };

  logger.section(`Add Company Target: ${companyName}`);
  logger.info(`Detected ATS: [${detected.ats}] | Slug: "${detected.slug}"`);

  if (!detected.isCustom) {
    logger.info('Verifying slug against live ATS API...');
    const verification = await verifyTargetSlug(targetEntry);
    if (verification.status === 'working') {
      targetEntry.verified = true;
      logger.success(
        `✅ Live ATS verification successful! Found ${verification.jobCount ?? 0} active postings.`
      );
    } else {
      logger.warn(`⚠️ Slug verification returned: ${verification.message}`);
    }
  } else {
    logger.warn(`Unrecognised career portal URL pattern. Added as ats: "custom".`);
    console.log('\n============================================================');
    console.log('       PLAYWRIGHT FALLBACK SELECTORS CONFIGURATION          ');
    console.log('============================================================');
    console.log(`Company: ${companyName} (${normalizedUrl})`);
    console.log(
      'To scrape this custom JS-rendered page, configure selectors in config/company-targets.json:'
    );
    console.log(
      '  • listSelector:  CSS selector for each job card container (e.g. ".job-card", "li.job")'
    );
    console.log(
      '  • titleSelector: CSS selector for the job title inside each card (e.g. "h3", ".job-title")'
    );
    console.log(
      '  • linkSelector:  CSS selector for the details/apply link inside each card (e.g. "a")'
    );
    console.log('============================================================\n');
  }

  // Load existing targets and update/append
  const resolvedPath = path.resolve(configPath);
  let targets: CompanyTarget[] = [];
  if (fs.existsSync(resolvedPath)) {
    targets = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  }

  const existingIdx = targets.findIndex(
    (t) =>
      (t.slug && t.slug === targetEntry.slug && t.ats === targetEntry.ats) ||
      t.name.toLowerCase() === targetEntry.name.toLowerCase()
  );

  if (existingIdx >= 0) {
    targets[existingIdx] = { ...targets[existingIdx], ...targetEntry };
    logger.info(`Updated existing target entry for ${targetEntry.name}`);
  } else {
    targets.push(targetEntry);
    logger.success(`Added new target entry for ${targetEntry.name}`);
  }

  fs.writeFileSync(resolvedPath, JSON.stringify(targets, null, 2), 'utf-8');
  return targetEntry;
}

// ============================================================
// Target Verification Tool – Validates ATS slugs against live endpoints
// ============================================================

import fs from 'fs';
import path from 'path';
import { CompanyTarget, CompanyTargetSchema } from '../types';
import { httpClient } from './http-client';
import { logger } from '../utils/logger';

export interface VerificationResult {
  name: string;
  ats: string;
  slug: string;
  status: 'working' | 'not_found' | 'error' | 'skipped';
  jobCount?: number;
  statusCode?: number;
  message?: string;
}

export async function verifyTargetSlug(target: CompanyTarget): Promise<VerificationResult> {
  const { ats, slug, name } = target;

  if (ats === 'custom') {
    return { name, ats, slug, status: 'skipped', message: 'Custom / Playwright targets skipped in API verification' };
  }

  let testUrl = '';
  if (ats === 'greenhouse') {
    testUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
  } else if (ats === 'lever') {
    testUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  } else if (ats === 'ashby') {
    testUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
  } else if (ats === 'workable') {
    testUrl = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`;
  } else if (ats === 'remotive') {
    testUrl = 'https://remotive.com/api/remote-jobs?category=qa';
  } else if (ats === 'remoteok') {
    testUrl = 'https://remoteok.com/api?tag=qa';
  }

  try {
    const res = await httpClient.get<any>(testUrl, { useCache: false, retries: 1 });

    if (res.status === 200) {
      let count = 0;
      if (Array.isArray(res.data)) count = res.data.length;
      else if (res.data?.jobs && Array.isArray(res.data.jobs)) count = res.data.jobs.length;

      return {
        name,
        ats,
        slug,
        status: 'working',
        statusCode: 200,
        jobCount: count,
        message: `Active board with ${count} total postings`,
      };
    }

    if (res.status === 404) {
      return {
        name,
        ats,
        slug,
        status: 'not_found',
        statusCode: 404,
        message: `Board slug "${slug}" not found (HTTP 404)`,
      };
    }

    return {
      name,
      ats,
      slug,
      status: 'error',
      statusCode: res.status,
      message: `HTTP ${res.status}`,
    };
  } catch (err: any) {
    return {
      name,
      ats,
      slug,
      status: 'error',
      message: err?.message || String(err),
    };
  }
}

export async function runVerifyTargets(configPath = './config/company-targets.json'): Promise<VerificationResult[]> {
  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Targets file not found: ${resolvedPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  const targets: CompanyTarget[] = raw.map((item: unknown) => CompanyTargetSchema.parse(item));

  logger.section(`Verifying ${targets.length} Target Company Slugs`);

  const results: VerificationResult[] = [];
  const updatedTargets = [...targets];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    logger.info(`Checking [${target.ats}] ${target.name} (slug: ${target.slug})...`);
    const res = await verifyTargetSlug(target);
    results.push(res);

    if (res.status === 'working') {
      updatedTargets[i].verified = true;
      logger.success(`  -> VERIFIED: ${target.name} (${res.jobCount} postings found)`);
    } else {
      updatedTargets[i].verified = false;
      logger.warn(`  -> FAILED: ${target.name} - ${res.message}`);
    }
  }

  // Save updated verified flags to disk
  fs.writeFileSync(resolvedPath, JSON.stringify(updatedTargets, null, 2), 'utf-8');

  // Format summary report
  const working = results.filter((r) => r.status === 'working');
  const notFound = results.filter((r) => r.status === 'not_found');
  const errors = results.filter((r) => r.status === 'error');
  const skipped = results.filter((r) => r.status === 'skipped');

  console.log('\n============================================================');
  console.log('              TARGET ATS VERIFICATION REPORT                ');
  console.log('============================================================');
  console.log(`Total Targets Checked: ${results.length}`);
  console.log(`✅ Verified & Working: ${working.length}`);
  console.log(`❌ Slug Not Found:    ${notFound.length}`);
  console.log(`⚠️ Errors / Blocked:  ${errors.length}`);
  console.log(`⏭️ Skipped (Custom):  ${skipped.length}`);
  console.log('------------------------------------------------------------');

  if (working.length > 0) {
    console.log('\n✅ WORKING SLUGS:');
    working.forEach((w) => console.log(`  • [${w.ats.padEnd(10)}] ${w.name.padEnd(25)} slug: "${w.slug}" (${w.jobCount} jobs)`));
  }

  if (notFound.length > 0) {
    console.log('\n❌ SLUGS TO FIX (HTTP 404):');
    notFound.forEach((n) => console.log(`  • [${n.ats.padEnd(10)}] ${n.name.padEnd(25)} slug: "${n.slug}" -> ${n.message}`));
  }

  if (errors.length > 0) {
    console.log('\n⚠️ ERRORS:');
    errors.forEach((e) => console.log(`  • [${e.ats.padEnd(10)}] ${e.name.padEnd(25)} slug: "${e.slug}" -> ${e.message}`));
  }

  console.log('============================================================\n');

  return results;
}

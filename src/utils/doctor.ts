// ============================================================
// JobHermes Doctor – Environment, Config, and Health Diagnostics
// ============================================================

import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { hasFillMarkers } from '../types';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export function runDoctor(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  logger.section('JobHermes Copilot Health Diagnostic (doctor)');

  // 1. Environment file
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    checks.push({ name: 'Environment File (.env)', status: 'ok', message: 'Found .env file' });
  } else {
    checks.push({ name: 'Environment File (.env)', status: 'warn', message: 'Missing .env file (using defaults or process.env)' });
  }

  // 2. OpenAI API Key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes('your-openai-api-key')) {
    checks.push({
      name: 'OpenAI API Key',
      status: 'warn',
      message: 'OPENAI_API_KEY is unset or default. Set a valid key or "mock" for offline mode.',
    });
  } else if (apiKey.startsWith('mock')) {
    checks.push({ name: 'OpenAI API Key', status: 'ok', message: 'Configured in offline Mock Mode' });
  } else {
    checks.push({ name: 'OpenAI API Key', status: 'ok', message: 'Configured with live OpenAI key' });
  }

  // 3. Candidate Profile Review Flag
  const profilePath = path.resolve('./config/candidate-profile.json');
  if (fs.existsSync(profilePath)) {
    try {
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      if (profile.profile_reviewed === true) {
        checks.push({ name: 'Candidate Profile Review', status: 'ok', message: 'profile_reviewed: true' });
      } else {
        checks.push({
          name: 'Candidate Profile Review',
          status: 'warn',
          message: 'Skills list has default assumed values. Review config/candidate-profile.json and set "profile_reviewed": true.',
        });
      }

      // Check [FILL] markers
      const fillCheck = hasFillMarkers(profile);
      if (fillCheck.hasFill) {
        checks.push({
          name: 'Profile [FILL] Markers',
          status: 'warn',
          message: `${fillCheck.markerPaths.length} [FILL] markers remaining in candidate-profile.json`,
        });
      } else {
        checks.push({ name: 'Profile [FILL] Markers', status: 'ok', message: 'No [FILL] markers found in profile' });
      }
    } catch (err: any) {
      checks.push({ name: 'Candidate Profile JSON', status: 'error', message: `Invalid JSON: ${err.message}` });
    }
  } else {
    checks.push({ name: 'Candidate Profile JSON', status: 'error', message: 'config/candidate-profile.json not found' });
  }

  // 4. Base Resume
  const resumePath = path.resolve('./config/base-resume.md');
  if (fs.existsSync(resumePath)) {
    const content = fs.readFileSync(resumePath, 'utf-8');
    if (content.includes('[FILL')) {
      checks.push({
        name: 'Base Resume Markdown',
        status: 'warn',
        message: 'config/base-resume.md has [FILL] markers to customize before document generation.',
      });
    } else {
      checks.push({ name: 'Base Resume Markdown', status: 'ok', message: 'Base resume loaded without [FILL] markers' });
    }
  } else {
    checks.push({ name: 'Base Resume Markdown', status: 'error', message: 'config/base-resume.md not found' });
  }

  // 5. Company Targets
  const targetsPath = path.resolve('./config/company-targets.json');
  if (fs.existsSync(targetsPath)) {
    try {
      const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));
      const verified = targets.filter((t: any) => t.verified).length;
      checks.push({
        name: 'Company Targets',
        status: 'ok',
        message: `${targets.length} targets configured (${verified} verified active)`,
      });
    } catch (err: any) {
      checks.push({ name: 'Company Targets', status: 'error', message: `Invalid JSON: ${err.message}` });
    }
  }

  // 6. Database
  const dbDir = path.resolve('./data');
  if (fs.existsSync(dbDir)) {
    checks.push({ name: 'Database Directory', status: 'ok', message: './data exists' });
  } else {
    checks.push({ name: 'Database Directory', status: 'warn', message: './data will be created on initial run' });
  }

  // 7. Email Send Safety
  const sendReal = process.env.SEND_REAL_EMAILS === 'true';
  if (sendReal) {
    checks.push({
      name: 'Email Send Mode',
      status: 'warn',
      message: 'SEND_REAL_EMAILS=true (Live sending enabled). Ensure Gmail OAuth2/SMTP is configured.',
    });
  } else {
    checks.push({
      name: 'Email Send Mode',
      status: 'ok',
      message: 'Dry-run active (SEND_REAL_EMAILS is false). Emails will output locally to .eml files.',
    });
  }

  // Output formatting
  console.log('\n============================================================');
  console.log('                 SYSTEM HEALTH REPORT (doctor)              ');
  console.log('============================================================');
  for (const c of checks) {
    const symbol = c.status === 'ok' ? '✅ OK   ' : c.status === 'warn' ? '⚠️ WARN ' : '❌ ERROR';
    console.log(`  ${symbol} | ${c.name.padEnd(28)} | ${c.message}`);
  }
  console.log('============================================================\n');

  return checks;
}

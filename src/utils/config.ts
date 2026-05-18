// ============================================================
// Config Loader – Validates and loads all environment variables
// ============================================================

import dotenv from 'dotenv';

import { HermesConfig } from '../types';

dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`❌ Missing required environment variable: ${key}`);
  }
  return val;
}

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const num = parseInt(val, 10);
  if (isNaN(num)) throw new Error(`❌ Environment variable ${key} must be a number, got: ${val}`);
  return num;
}

export function loadConfig(): HermesConfig {
  const openaiApiKey = requireEnv('OPENAI_API_KEY');

  return {
    openaiApiKey,
    openaiModel: getEnv('OPENAI_MODEL', 'gpt-4o'),
    temperature: parseFloat(getEnv('OPENAI_TEMPERATURE', '0.3')),
    databasePath: getEnv('DATABASE_PATH', './data/jobhermes.db'),
    reportsDir: getEnv('REPORTS_DIR', './output/reports'),
    documentsDir: getEnv('DOCUMENTS_DIR', './output/documents'),
    logLevel: getEnv('LOG_LEVEL', 'info'),
    logDir: getEnv('LOG_DIR', './logs'),
    cronSchedule: getEnv('CRON_SCHEDULE', '30 3 * * *'),
    timezone: getEnv('TIMEZONE', 'Asia/Kolkata'),
    scrapeConcurrency: getEnvNumber('SCRAPE_CONCURRENCY', 3),
    requestDelayMs: getEnvNumber('REQUEST_DELAY_MS', 1500),
    maxRetries: getEnvNumber('MAX_RETRIES', 3),
    candidateProfilePath: getEnv('CANDIDATE_PROFILE_PATH', './config/candidate-profile.json'),
    companyTargetsPath: getEnv('COMPANY_TARGETS_PATH', './config/company-targets.json'),
    minScoreThreshold: getEnvNumber('MIN_SCORE_THRESHOLD', 60),
    topJobsCount: getEnvNumber('TOP_JOBS_COUNT', 10),
    userAgent: getEnv(
      'USER_AGENT',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    ),
    requestTimeoutMs: getEnvNumber('REQUEST_TIMEOUT_MS', 10000),
  };
}

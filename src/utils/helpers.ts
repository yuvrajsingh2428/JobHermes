// ============================================================
// General Utilities – Helpers used across the project
// ============================================================

import fs from 'fs';
import path from 'path';

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure a directory exists, creating it recursively if needed
 */
export function ensureDir(dirPath: string): void {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
}

/**
 * Read and parse a JSON file safely
 */
export function readJsonFile<T>(filePath: string): T {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Write JSON to a file with pretty formatting
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(path.resolve(filePath), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Write a text/HTML file
 */
export function writeTextFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(path.resolve(filePath), content, 'utf-8');
}

/**
 * Get today's date string in YYYY-MM-DD format
 */
export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get a formatted timestamp string for filenames
 */
export function getTimestampString(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Sanitize a string for use as a filename
 */
export function sanitizeFilename(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Extract plain text from HTML
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Retry an async function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        await sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error('Unknown error after retries');
}

/**
 * Run tasks with limited concurrency
 */
export async function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = 3
): Promise<R[]> {
  const results: R[] = [];
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    chunks.push(items.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
  }

  return results;
}

/**
 * Calculate overlap ratio between two string arrays
 */
export function calculateSetOverlap(a: string[], b: string[]): number {
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  const intersection = [...setA].filter((x) => setB.has(x));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let unitIndex = 0;
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }
  return `${val.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Parse salary string to LPA number (rough extraction)
 */
export function parseSalaryLPA(salaryStr: string): number | null {
  if (!salaryStr) return null;
  const match = salaryStr.match(/(\d+(?:\.\d+)?)\s*(?:L|LPA|lpa|lakhs?)/i);
  if (match) return parseFloat(match[1]);
  const crMatch = salaryStr.match(/(\d+(?:\.\d+)?)\s*(?:Cr|CPA|crore)/i);
  if (crMatch) return parseFloat(crMatch[1]) * 100;
  return null;
}

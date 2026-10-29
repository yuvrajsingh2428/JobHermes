// ============================================================
// Backup & Export Service – Database Snapshots and CSV/JSON Exports
// ============================================================

import fs from 'fs';
import path from 'path';
import { StorageService } from '../storage/database';
import { logger } from './logger';

export type ExportEntity = 'jobs' | 'contacts' | 'outreach' | 'applications';
export type ExportFormat = 'csv' | 'json';

export interface BackupResult {
  success: boolean;
  backupPath: string;
  sizeBytes: number;
  timestamp: string;
}

export interface ExportResult {
  entity: ExportEntity;
  format: ExportFormat;
  filePath: string;
  recordCount: number;
}

/**
 * Escapes and quotes a string value according to RFC 4180 standards.
 */
export function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str: string;
  if (typeof val === 'object') {
    str = JSON.stringify(val);
  } else {
    str = String(val);
  }

  // Quote if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts an array of objects into standard CSV text.
 */
export function objectsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(escapeCsvField).join(',');
  const lines = rows.map((row) => headers.map((h) => escapeCsvField(row[h])).join(','));
  return [headerLine, ...lines].join('\r\n');
}

/**
 * Creates a timestamped SQLite database snapshot in the backups directory.
 */
export function createDatabaseBackup(
  dbPath = './data/jobhermes.db',
  backupDir = './data/backups'
): BackupResult {
  const resolvedDb = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDb)) {
    throw new Error(`Database file not found: ${resolvedDb}`);
  }

  const resolvedBackupDir = path.resolve(backupDir);
  if (!fs.existsSync(resolvedBackupDir)) {
    fs.mkdirSync(resolvedBackupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(resolvedBackupDir, `jobhermes-${timestamp}.db`);

  // Copy database file
  fs.copyFileSync(resolvedDb, backupPath);
  const stats = fs.statSync(backupPath);

  logger.success(`Database backup created: ${backupPath} (${(stats.size / 1024).toFixed(1)} KB)`);

  return {
    success: true,
    backupPath,
    sizeBytes: stats.size,
    timestamp,
  };
}

/**
 * Exports database entities (jobs, contacts, outreach, applications) to CSV or JSON.
 */
export function exportData(
  storage: StorageService,
  entity: ExportEntity,
  format: ExportFormat = 'csv',
  outputDir = './output/exports'
): ExportResult {
  const resolvedDir = path.resolve(outputDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  let records: Record<string, unknown>[] = [];

  switch (entity) {
    case 'jobs':
      records = storage.getAllJobs() as unknown as Record<string, unknown>[];
      break;
    case 'contacts':
      records = storage.getAllContacts() as unknown as Record<string, unknown>[];
      break;
    case 'outreach':
      records = storage.getAllOutreach() as unknown as Record<string, unknown>[];
      break;
    case 'applications':
      records = storage.getApplications() as unknown as Record<string, unknown>[];
      break;
    default:
      throw new Error(`Unsupported export entity: ${entity}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${entity}-${timestamp}.${format}`;
  const filePath = path.join(resolvedDir, fileName);

  if (format === 'json') {
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
  } else {
    const csvContent = objectsToCsv(records);
    fs.writeFileSync(filePath, csvContent, 'utf-8');
  }

  logger.success(`Exported ${records.length} ${entity} records to: ${filePath}`);

  return {
    entity,
    format,
    filePath,
    recordCount: records.length,
  };
}

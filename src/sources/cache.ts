// ============================================================
// Local Source Cache – Prevents re-hammering APIs during re-runs
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

export class SourceCache {
  private cacheDir: string;
  private defaultTtlMs: number;
  private memoryMap = new Map<string, CacheEntry<unknown>>();

  constructor(cacheDir = './data/cache', defaultTtlMs = 60 * 60 * 1000) {
    // 1 hour default
    this.cacheDir = path.resolve(cacheDir);
    this.defaultTtlMs = defaultTtlMs;
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch {
      // Fallback to memory-only if filesystem fails
    }
  }

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  get<T>(key: string): T | null {
    const now = Date.now();
    const mem = this.memoryMap.get(key);
    if (mem) {
      if (mem.expiresAt > now) return mem.data as T;
      this.memoryMap.delete(key);
    }

    const filePath = path.join(this.cacheDir, `${this.hashKey(key)}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const entry = JSON.parse(raw) as CacheEntry<T>;
        if (entry.expiresAt > now) {
          this.memoryMap.set(key, entry);
          return entry.data;
        } else {
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      // Return null on read/parse error
    }

    return null;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    if (this.memoryMap.size >= 500) {
      const oldestKey = this.memoryMap.keys().next().value;
      if (oldestKey) this.memoryMap.delete(oldestKey);
    }
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    const entry: CacheEntry<T> = { expiresAt, data };
    this.memoryMap.set(key, entry as CacheEntry<unknown>);

    const filePath = path.join(this.cacheDir, `${this.hashKey(key)}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
    } catch {
      // Memory fallback ok
    }
  }

  clear(): void {
    this.memoryMap.clear();
    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
      }
    } catch {
      // Ignore
    }
  }
}

export const sourceCache = new SourceCache();

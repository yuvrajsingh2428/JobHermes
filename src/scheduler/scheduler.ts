// ============================================================
// Scheduler – node-cron integration for daily automated scans
// ============================================================

import cron from 'node-cron';
import { HermesAgent } from '../agent/hermes-agent';
import { logger } from '../utils/logger';

export class Scheduler {
  private agent: HermesAgent;
  private cronExpression: string;
  private timezone: string;
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(agent: HermesAgent, cronExpression: string, timezone = 'Asia/Kolkata') {
    this.agent = agent;
    this.cronExpression = cronExpression;
    this.timezone = timezone;
  }

  start(): void {
    if (!cron.validate(this.cronExpression)) {
      throw new Error(`Invalid cron expression: ${this.cronExpression}`);
    }

    logger.info(`Scheduler starting`, {
      cron: this.cronExpression,
      timezone: this.timezone,
    });

    this.task = cron.schedule(
      this.cronExpression,
      async () => {
        if (this.isRunning) {
          logger.warn('Scan already in progress, skipping scheduled run');
          return;
        }

        logger.section('Scheduled Daily Scan Triggered');
        this.isRunning = true;

        try {
          await this.agent.runDailyScan();
        } catch (err) {
          logger.error('Scheduled scan failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          this.isRunning = false;
        }
      },
      {
        timezone: this.timezone,
        scheduled: true,
      }
    );

    const nextRun = this.getNextRunTime();
    logger.success(`Scheduler active. Next run at: ${nextRun}`);
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('Scheduler stopped');
    }
  }

  getNextRunTime(): string {
    // Calculate next scheduled run (simplified)
    return `${this.cronExpression} (${this.timezone})`;
  }

  isActive(): boolean {
    return this.task !== null;
  }
}

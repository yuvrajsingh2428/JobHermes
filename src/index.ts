// ============================================================
// JobHermes – Main Entry Point
// ============================================================

import 'dotenv/config';
import { loadConfig } from './utils/config';
import { HermesAgent } from './agent/hermes-agent';
import { Scheduler } from './scheduler/scheduler';
import { logger } from './utils/logger';

const args = process.argv.slice(2);

async function main(): Promise<void> {
  logger.section('JobHermes Starting Up');

  // Load and validate config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error('Configuration error', { error: String(err) });
    process.exit(1);
  }

  const agent = new HermesAgent(config);

  // Handle CLI flags for one-off operations
  const flag = args[0];

  if (flag === '--scan') {
    // One-off immediate scan
    logger.info('Running immediate job scan...');
    await agent.runDailyScan();
    agent.shutdown();
    return;
  }

  if (flag === '--report') {
    // Generate report from existing DB data
    logger.info('Generating report from stored jobs...');
    const reportPath = await agent.generateReport();
    logger.success(`Report generated: ${reportPath}`);
    agent.shutdown();
    return;
  }

  if (flag === '--resume') {
    // Generate resume for a specific job ID
    const jobId = parseInt(args[1] || '0', 10);
    if (!jobId) {
      logger.error('Usage: npm run resume <job-id>');
      process.exit(1);
    }
    const resumePath = await agent.generateResume(jobId);
    logger.success(`Resume saved: ${resumePath}`);
    agent.shutdown();
    return;
  }

  if (flag === '--cover-letter') {
    // Generate cover letter for a specific job ID
    const jobId = parseInt(args[1] || '0', 10);
    const tone = (args[2] as 'professional' | 'enthusiastic' | 'concise') || 'professional';
    if (!jobId) {
      logger.error('Usage: npm run cover-letter <job-id> [professional|enthusiastic|concise]');
      process.exit(1);
    }
    const coverPath = await agent.generateCoverLetter(jobId, tone);
    logger.success(`Cover letter saved: ${coverPath}`);
    agent.shutdown();
    return;
  }

  if (flag === '--apply') {
    // Generate full application pack (resume + cover letter) for a job
    const jobId = parseInt(args[1] || '0', 10);
    const tone = (args[2] as 'professional' | 'enthusiastic' | 'concise') || 'professional';
    if (!jobId) {
      logger.error('Usage: ts-node src/index.ts --apply <job-id> [tone]');
      process.exit(1);
    }
    const { resumePath, coverLetterPath } = await agent.generateApplicationPack(jobId, tone);
    logger.success(`Application pack generated:`);
    logger.info(`  Resume:       ${resumePath}`);
    logger.info(`  Cover Letter: ${coverLetterPath}`);
    agent.shutdown();
    return;
  }

  if (flag === '--status') {
    // Show status from DB
    const storage = agent.getStorage();
    const total = storage.countJobs();
    const topJobs = agent.getTopJobs(5);
    logger.section('JobHermes Status');
    logger.info(`Total jobs in database: ${total}`);
    logger.info('Top 5 jobs:');
    topJobs.forEach((j, i) => {
      logger.info(`  ${i + 1}. [${j.score}] ${j.title} @ ${j.company} – ${j.location}`);
    });
    agent.shutdown();
    return;
  }

  // Default mode: run scheduler (daemon mode)
  logger.info('Starting in daemon mode (scheduled scans)...');

  const scheduler = new Scheduler(agent, config.cronSchedule, config.timezone);
  scheduler.start();

  // Optionally run an immediate scan on startup
  if (args.includes('--run-now')) {
    logger.info('Running immediate scan on startup...');
    await agent.runDailyScan();
  }

  // Graceful shutdown handlers
  const shutdown = () => {
    logger.section('Shutting Down');
    scheduler.stop();
    agent.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.success('JobHermes daemon is running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

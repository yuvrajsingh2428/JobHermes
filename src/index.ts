// ============================================================
// JobHermes – SDET Job-Search Copilot Main Entry Point
// ============================================================

import 'dotenv/config';
import fs from 'fs';
import { loadConfig } from './utils/config';
import { HermesAgent } from './agent/hermes-agent';
import { Scheduler } from './scheduler/scheduler';
import { logger } from './utils/logger';
import { DashboardServer } from './dashboard/server';
import { runVerifyTargets } from './sources/verify-targets';
import { hasFillMarkers } from './types';

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const flag = args[0];

  if (flag === 'verify-targets' || flag === '--verify-targets') {
    await runVerifyTargets();
    return;
  }

  if (flag === '--help' || flag === '-h') {
    logger.section('JobHermes SDET Copilot CLI Usage');
    logger.info('Options:');
    logger.info('  verify-targets                        Hit all ATS APIs in company-targets.json & report status');
    logger.info('  --scan                                Run an immediate job scan across active ATS sources');
    logger.info('  --resume <job-id>                     Generate a tailored resume for a job');
    logger.info('  --cover-letter <job-id> [tone]        Generate a tailored cover letter (professional | enthusiastic | concise)');
    logger.info('  --apply <job-id> [tone]               Generate application pack (resume + cover letter)');
    logger.info('  --status                              Display database statistics and top matched jobs');
    logger.info('  --dashboard                           Start the local Web Dashboard (127.0.0.1:3000)');
    logger.info('  --help, -h                            Show this help menu');
    logger.info('');
    logger.info('Note: If no arguments are provided, JobHermes runs in daemon mode (scheduled scans) and starts the dashboard.');
    return;
  }

  // Helper to assert candidate profile has no [FILL] markers before generating documents or sending emails
  function assertNoFillMarkers(profilePath: string, baseResumePath = './config/base-resume.md') {
    if (fs.existsSync(profilePath)) {
      const content = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      const profileCheck = hasFillMarkers(content);
      if (profileCheck.hasFill) {
        logger.error(`Refusing to run: Unresolved [FILL] markers found in ${profilePath}:`);
        profileCheck.markerPaths.slice(0, 5).forEach((m) => logger.error(`  - ${m}`));
        process.exit(1);
      }
    }
    if (fs.existsSync(baseResumePath)) {
      const resumeContent = fs.readFileSync(baseResumePath, 'utf-8');
      if (resumeContent.includes('[FILL')) {
        logger.error(`Refusing to run: Unresolved [FILL] markers found in ${baseResumePath}`);
        process.exit(1);
      }
    }
  }

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

  if (flag === '--scan') {
    logger.info('Running immediate job scan...');
    await agent.runDailyScan();
    agent.shutdown();
    return;
  }

  if (flag === '--resume') {
    assertNoFillMarkers(config.candidateProfilePath);
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
    assertNoFillMarkers(config.candidateProfilePath);
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
    assertNoFillMarkers(config.candidateProfilePath);
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

  if (flag === '--dashboard') {
    logger.info('Starting JobHermes Dashboard Server...');
    const dashboard = new DashboardServer(agent, 3000);
    dashboard.start();

    const shutdownDashboard = () => {
      logger.section('Shutting Down Dashboard');
      dashboard.stop();
      agent.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdownDashboard);
    process.on('SIGTERM', shutdownDashboard);
    return;
  }

  // Default mode: run scheduler (daemon mode) + dashboard server
  logger.info('Starting in daemon mode (scheduled scans)...');

  const scheduler = new Scheduler(agent, config.cronSchedule, config.timezone);
  scheduler.start();

  logger.info('Starting JobHermes Dashboard Server...');
  const dashboard = new DashboardServer(agent, 3000);
  dashboard.start();

  if (args.includes('--run-now')) {
    logger.info('Running immediate scan on startup...');
    await agent.runDailyScan();
  }

  const shutdown = () => {
    logger.section('Shutting Down');
    scheduler.stop();
    dashboard.stop();
    agent.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.success('JobHermes daemon & dashboard are running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

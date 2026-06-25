// ============================================================
// JobDashboard Server – Local Express server for UI
// ============================================================

import express from 'express';
import path from 'path';
import fs from 'fs';
import { HermesAgent } from '../agent/hermes-agent';
import { logger } from '../utils/logger';
import { ApplicationStatus } from '../types';

export class DashboardServer {
  private app: express.Application;
  private agent: HermesAgent;
  private port: number;
  private serverInstance: any;

  constructor(agent: HermesAgent, port = 3000) {
    this.agent = agent;
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    // Serve static files from the source public folder directly
    const publicPath = path.join(process.cwd(), 'src', 'dashboard', 'public');
    this.app.use(express.static(publicPath));
  }

  private setupRoutes() {
    // API: Retrieve general dashboard metrics
    this.app.get('/api/stats', (_req, res) => {
      try {
        const storage = this.agent.getStorage();
        const totalJobs = storage.countJobs();
        const apps = storage.getApplications();
        
        // Count jobs by status
        const allJobs = storage.getAllJobs();
        const statusCounts = allJobs.reduce((acc, job) => {
          acc[job.status] = (acc[job.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        // Calculate score distribution
        const distribution = [
          { range: '90-100', count: allJobs.filter((j) => (j.score ?? 0) >= 90).length },
          { range: '80-89', count: allJobs.filter((j) => (j.score ?? 0) >= 80 && (j.score ?? 0) < 90).length },
          { range: '70-79', count: allJobs.filter((j) => (j.score ?? 0) >= 70 && (j.score ?? 0) < 80).length },
          { range: '60-69', count: allJobs.filter((j) => (j.score ?? 0) >= 60 && (j.score ?? 0) < 70).length },
          { range: 'Below 60', count: allJobs.filter((j) => (j.score ?? 0) < 60).length },
        ];

        res.json({
          totalJobs,
          statusCounts,
          scoreDistribution: distribution,
          appliedCount: apps.length,
          recentApplications: apps.slice(0, 5)
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Retrieve list of jobs with query filters
    this.app.get('/api/jobs', (req, res) => {
      try {
        const status = req.query.status as ApplicationStatus | undefined;
        const minScore = req.query.minScore ? parseInt(req.query.minScore as string, 10) : undefined;
        const company = req.query.company as string | undefined;

        const jobs = this.agent.getStorage().getAllJobs({
          status,
          minScore,
          company,
          limit: 100
        });

        res.json(jobs);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Get details for a single job
    this.app.get('/api/jobs/:id', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const job = this.agent.getJobById(id);
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }
        res.json(job);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Update status and notes for a job
    this.app.patch('/api/jobs/:id', (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const { status, notes } = req.body;
        
        if (!status) {
          res.status(400).json({ error: 'Status is required' });
          return;
        }

        this.agent.updateJobStatus(id, status, notes);
        const updated = this.agent.getJobById(id);
        res.json({ success: true, job: updated });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Run daily scan on demand in background
    this.app.post('/api/scan', (_req, res) => {
      try {
        if (this.agent.isCurrentlyScanning()) {
          res.status(400).json({ error: 'Scan already in progress' });
          return;
        }

        // Run scan asynchronously
        this.agent.runDailyScan().then(() => {
          logger.info('Background job scan completed successfully.');
        }).catch(err => {
          logger.error('Background job scan failed', { error: String(err) });
        });

        res.json({ success: true, message: 'Scan started in background.' });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Check scanning status
    this.app.get('/api/scan/status', (_req, res) => {
      res.json({ isScanning: this.agent.isCurrentlyScanning() });
    });

    // API: Generate resume for a job
    this.app.post('/api/jobs/:id/resume', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const filePath = await this.agent.generateResume(id);
        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ success: true, filePath, html: content });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Generate cover letter for a job
    this.app.post('/api/jobs/:id/cover-letter', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const { tone } = req.body;
        const filePath = await this.agent.generateCoverLetter(id, tone || 'professional');
        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ success: true, filePath, html: content });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Generate application pack (both resume and cover letter)
    this.app.post('/api/jobs/:id/apply-pack', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const { tone } = req.body;
        const { resumePath, coverLetterPath } = await this.agent.generateApplicationPack(id, tone || 'professional');
        
        const resumeHtml = fs.readFileSync(resumePath, 'utf-8');
        const coverLetterHtml = fs.readFileSync(coverLetterPath, 'utf-8');

        res.json({
          success: true,
          resumePath,
          coverLetterPath,
          resumeHtml,
          coverLetterHtml
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Retrieve candidate profile configuration
    this.app.get('/api/profile', (_req, res) => {
      try {
        const profilePath = path.resolve((this.agent as any).config.candidateProfilePath);
        const data = fs.readFileSync(profilePath, 'utf-8');
        res.json(JSON.parse(data));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // API: Retrieve company targets configuration
    this.app.get('/api/targets', (_req, res) => {
      try {
        const targetsPath = path.resolve((this.agent as any).config.companyTargetsPath);
        const data = fs.readFileSync(targetsPath, 'utf-8');
        res.json(JSON.parse(data));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Catch-all route to serve dashboard index.html
    this.app.get('*', (_req, res) => {
      const indexPath = path.join(process.cwd(), 'src', 'dashboard', 'public', 'index.html');
      res.sendFile(indexPath);
    });
  }

  start() {
    this.serverInstance = this.app.listen(this.port, () => {
      logger.section('Web Dashboard Server Running');
      logger.info(`Access JobHermes dashboard at: http://localhost:${this.port}`);
    });
  }

  stop() {
    if (this.serverInstance) {
      this.serverInstance.close(() => {
        logger.info('Web Dashboard Server stopped');
      });
    }
  }
}

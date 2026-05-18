// ============================================================
// Report Generator – Creates rich HTML daily job reports
// ============================================================

import path from 'path';
import { JobPosting, DailyReport, ScoreBreakdown } from '../types';
import { logger } from '../utils/logger';
import { ensureDir, writeTextFile, getTodayString, getTimestampString } from '../utils/helpers';

export class ReportGenerator {
  private reportsDir: string;

  constructor(reportsDir: string) {
    this.reportsDir = reportsDir;
    ensureDir(reportsDir);
  }

  generateDailyReport(report: DailyReport, aiSummary?: string): string {
    const html = this.buildReportHtml(report, aiSummary);
    const filename = `report-${report.date}-${getTimestampString()}.html`;
    const filePath = path.join(this.reportsDir, filename);
    writeTextFile(filePath, html);
    logger.success(`Daily report saved: ${filePath}`);
    return filePath;
  }

  buildReport(jobs: JobPosting[], companiesCovered: string[], _aiSummary?: string): DailyReport {
    const today = getTodayString();
    const topJobs = jobs.slice(0, 20);
    const distribution = [
      { range: '90-100', count: jobs.filter((j) => (j.score ?? 0) >= 90).length },
      { range: '80-89', count: jobs.filter((j) => (j.score ?? 0) >= 80 && (j.score ?? 0) < 90).length },
      { range: '70-79', count: jobs.filter((j) => (j.score ?? 0) >= 70 && (j.score ?? 0) < 80).length },
      { range: '60-69', count: jobs.filter((j) => (j.score ?? 0) >= 60 && (j.score ?? 0) < 70).length },
      { range: 'Below 60', count: jobs.filter((j) => (j.score ?? 0) < 60).length },
    ];
    return {
      generatedAt: new Date().toISOString(),
      date: today,
      totalJobsScraped: jobs.length,
      totalJobsFiltered: topJobs.length,
      topJobs,
      applicationsSent: jobs.filter((j) => j.isApplied).length,
      companiesCovered,
      scoreDistribution: distribution,
    };
  }

  private scoreColor(score: number): string {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  }

  private statusBadge(status: string): string {
    const colors: Record<string, string> = {
      new: '#6366f1', reviewed: '#8b5cf6', applied: '#10b981',
      interviewing: '#f59e0b', offered: '#22c55e', rejected: '#ef4444', skipped: '#6b7280',
    };
    const color = colors[status] || '#6b7280';
    return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;text-transform:uppercase">${status}</span>`;
  }

  private buildReportHtml(report: DailyReport, aiSummary?: string): string {
    const formatDate = (iso: string) =>
      new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const jobCards = report.topJobs.map((job, i) => {
      const breakdown = job.scoreBreakdown as ScoreBreakdown | undefined;
      const bRows = breakdown ? [
        `<div style="font-size:12px;color:#94a3b8">Skills: ${breakdown.skillMatch}/30 | Title: ${breakdown.titleMatch}/20 | Location: ${breakdown.locationMatch}/15 | Exp: ${breakdown.experienceMatch}/15 | Salary: ${breakdown.salaryMatch}/10 | Prestige: ${breakdown.companyPrestige}/10</div>`
      ].join('') : '';

      return `<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="margin-bottom:6px"><span style="background:#1d4ed8;color:#93c5fd;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px">#${i + 1}</span> ${this.statusBadge(job.status)}</div>
            <h3 style="color:#f1f5f9;font-size:17px;font-weight:700;margin:6px 0 2px"><a href="${job.url}" style="color:#f1f5f9;text-decoration:none" target="_blank">${job.title}</a></h3>
            <div style="color:#60a5fa;font-size:14px;font-weight:600;margin-bottom:6px">${job.company}</div>
            <div style="color:#94a3b8;font-size:13px;margin-bottom:8px">📍 ${job.location}${job.salary ? ` · 💰 ${job.salary}` : ''}${job.jobType ? ` · ⏱ ${job.jobType}` : ''}</div>
            ${job.description ? `<p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:10px">${job.description.slice(0, 180)}${job.description.length > 180 ? '...' : ''}</p>` : ''}
            ${bRows}
            <div style="margin-top:10px"><a href="${job.url}" style="background:#1d4ed8;color:#fff;padding:7px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600" target="_blank">View Job →</a></div>
          </div>
          <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 14px;text-align:center;margin-left:16px;min-width:64px">
            <div style="font-size:22px;font-weight:800;color:${this.scoreColor(job.score ?? 0)}">${job.score ?? '?'}</div>
            <div style="font-size:10px;color:#64748b;text-transform:uppercase">SCORE</div>
          </div>
        </div>
      </div>`;
    }).join('');

    const distBars = report.scoreDistribution.map(({ range, count }) => {
      const maxCount = Math.max(...report.scoreDistribution.map((d) => d.count), 1);
      const pct = Math.round((count / maxCount) * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:70px;font-size:12px;color:#94a3b8;text-align:right">${range}</span>
        <div style="flex:1;background:#0f172a;border-radius:4px;height:22px">
          <div style="width:${pct}%;background:linear-gradient(90deg,#1d4ed8,#7c3aed);height:22px;border-radius:4px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px">
            <span style="color:#fff;font-size:12px;font-weight:600">${count}</span>
          </div>
        </div>
      </div>`;
    }).join('');

    const companiesList = report.companiesCovered.map((c) =>
      `<span style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:4px 10px;border-radius:6px;font-size:12px">${c}</span>`
    ).join(' ');

    const stats = [
      { label: 'Jobs Scraped', value: report.totalJobsScraped, icon: '🔍', color: '#6366f1' },
      { label: 'Filtered Matches', value: report.totalJobsFiltered, icon: '✅', color: '#10b981' },
      { label: 'Applications Sent', value: report.applicationsSent, icon: '📤', color: '#f59e0b' },
      { label: 'Companies Scanned', value: report.companiesCovered.length, icon: '🏢', color: '#8b5cf6' },
    ].map(({ label, value, icon, color }) =>
      `<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;text-align:center">
        <div style="font-size:28px;margin-bottom:4px">${icon}</div>
        <div style="font-size:30px;font-weight:800;color:${color}">${value}</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:2px">${label}</div>
      </div>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>JobHermes Daily Report – ${report.date}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#0f172a}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}</style>
</head>
<body>
  <div style="background:linear-gradient(135deg,#1e3a8a,#7c3aed,#1e3a8a);padding:40px 24px;text-align:center">
    <div style="font-size:34px;font-weight:900;background:linear-gradient(135deg,#60a5fa,#a78bfa,#f0abfc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px">⚡ JobHermes</div>
    <div style="color:#c4b5fd;font-size:14px;font-weight:500;margin-bottom:12px">Autonomous AI Job Hunting Agent</div>
    <div style="color:#e2e8f0;font-size:18px;font-weight:600">${formatDate(report.date)}</div>
    <div style="color:#94a3b8;font-size:12px;margin-top:4px">Generated at ${new Date(report.generatedAt).toLocaleTimeString('en-IN')}</div>
  </div>

  <div style="max-width:960px;margin:0 auto;padding:32px 16px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:32px">${stats}</div>

    ${aiSummary ? `<div style="background:linear-gradient(135deg,#1e1b4b,#1e293b);border:1px solid #4338ca;border-radius:12px;padding:24px;margin-bottom:32px">
      <div style="color:#a5b4fc;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">🤖 AI Summary</div>
      <p style="color:#c7d2fe;font-size:15px;line-height:1.7">${aiSummary}</p>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px;margin-bottom:32px;align-items:start">
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <h2 style="color:#f1f5f9;font-size:14px;font-weight:700;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">🏢 Companies Covered</h2>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${companiesList}</div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <h2 style="color:#f1f5f9;font-size:14px;font-weight:700;margin-bottom:14px;text-transform:uppercase;letter-spacing:0.05em">📊 Score Distribution</h2>
        ${distBars}
      </div>
    </div>

    <div>
      <h2 style="color:#f1f5f9;font-size:20px;font-weight:800;margin-bottom:20px">🎯 Top Matched Jobs</h2>
      ${jobCards || '<div style="text-align:center;color:#64748b;padding:40px">No jobs found today. Check back tomorrow!</div>'}
    </div>

    <div style="text-align:center;padding:40px 0 20px;color:#475569;font-size:12px">
      <div>⚡ Generated by <strong style="color:#7c3aed">JobHermes</strong> – Your autonomous AI job hunting agent</div>
      <div style="margin-top:4px">${report.date} · ${new Date(report.generatedAt).toLocaleTimeString('en-IN')}</div>
    </div>
  </div>
</body>
</html>`;
  }

  wrapResumeHtml(content: string, candidateName: string, jobTitle: string, company: string): string {
    if (content.includes('<!DOCTYPE html>')) return content;
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${candidateName} – Resume for ${jobTitle} at ${company}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>body{font-family:'Inter',sans-serif;max-width:800px;margin:0 auto;padding:40px 32px;color:#1e293b;line-height:1.6}h1{color:#0f172a}h2{color:#1e40af;border-bottom:2px solid #dbeafe;padding-bottom:4px;margin-top:24px}a{color:#1d4ed8}</style>
</head><body>${content}</body></html>`;
  }

  wrapCoverLetterHtml(content: string, candidateName: string, jobTitle: string, company: string): string {
    if (content.includes('<!DOCTYPE html>')) return content;
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${candidateName} – Cover Letter for ${jobTitle} at ${company}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>body{font-family:'Inter',sans-serif;max-width:700px;margin:0 auto;padding:60px 40px;color:#1e293b;line-height:1.8;font-size:15px}p{margin-bottom:16px}</style>
</head><body>${content}</body></html>`;
  }
}

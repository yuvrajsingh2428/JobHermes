# ⚡ JobHermes

> An autonomous AI-powered job hunting agent built with TypeScript, Node.js, OpenAI, and SQLite.

**JobHermes** is an automated job discovery and application assistant that runs on a scheduled workflow. It continuously scrapes job boards, analyzes and ranks opportunities based on your profile, stores job data locally, and generates clean, insightful HTML reports. On demand, JobHermes leverages GPT-4o to create personalized resumes and cover letters tailored to specific job descriptions, helping streamline the job application process.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔍 **Job Scraping** | TinyFetch HTTP client scrapes careers pages & job boards with retry + rate limiting |
| 🎯 **AI Scoring** | Multi-dimensional scoring (skills, title, location, experience, salary, prestige) |
| 🤖 **AI Filtering** | GPT-4o relevance check filters noise before storage |
| 💾 **SQLite Storage** | Persistent WAL-mode database with full application tracking |
| 📊 **HTML Reports** | Daily reports with dark-themed cards, score charts, and AI-written summaries |
| 📄 **Resume Generation** | ATS-optimized, role-tailored HTML resumes via GPT-4o |
| 💌 **Cover Letters** | Tone-controllable cover letters (professional / enthusiastic / concise) |
| 📦 **Application Pack** | Generate resume + cover letter together, auto-marked in DB |
| ⏰ **Scheduler** | Daily 9 AM IST scan via `node-cron` with timezone support |
| 🧭 **Hermes Agent** | Central orchestration layer managing all tasks with a task registry |
| 🖥️ **Web Dashboard** | Premium local dark-mode dashboard to monitor matches, edit statuses, and preview resumes |

---

## 🏗️ Project Structure

```
JobHermes/
├── src/
│   ├── agent/
│   │   └── hermes-agent.ts     # Central orchestrator
│   ├── ai/
│   │   ├── openai-service.ts   # OpenAI API integration
│   │   └── document-service.ts # Resume & cover letter pipeline
│   ├── prompts/
│   │   └── templates.ts        # All AI prompt templates
│   ├── reports/
│   │   └── report-generator.ts # HTML report builder
│   ├── scheduler/
│   │   └── scheduler.ts        # node-cron scheduler
│   ├── scoring/
│   │   └── scorer.ts           # Multi-dimensional job scorer
│   ├── scraper/
│   │   ├── tinyfetch.ts        # HTTP client (TinyFetch)
│   │   └── scraper.ts          # Job scraping strategies
│   ├── storage/
│   │   └── database.ts         # SQLite service (better-sqlite3)
│   ├── types/
│   │   └── index.ts            # All TypeScript types
│   ├── utils/
│   │   ├── config.ts           # Config/env loader
│   │   ├── helpers.ts          # General utilities
│   │   └── logger.ts           # Structured logger
│   └── index.ts                # Main entry point (CLI router)
├── config/
│   ├── candidate-profile.json  # YOUR profile (skills, experience, prefs)
│   └── company-targets.json    # Target companies & careers URLs
├── data/                       # SQLite DB (auto-created)
├── logs/                       # Daily log files (auto-created)
├── output/
│   ├── reports/                # HTML daily reports
│   └── documents/
│       ├── resumes/            # Generated resumes
│       └── cover-letters/      # Generated cover letters
├── .env                        # Your environment variables
├── .env.example                # Template
├── tsconfig.json
└── package.json
```

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <repo-url> jobhermes
cd jobhermes
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your `OPENAI_API_KEY` (required). All other values have sensible defaults.

### 3. Configure Your Profile

Edit `config/candidate-profile.json` with your:
- Name, contact details
- Skills (languages, frontend, backend, etc.)
- Work experience and education
- Target roles and preferred locations
- Salary expectations

### 4. Configure Target Companies

Edit `config/company-targets.json` to add/remove companies and their careers page URLs.

---

## 🖥️ Usage

### Run an immediate job scan
```bash
npm run scan
# or
npx ts-node src/index.ts --scan
```

### Generate today's report (from existing DB data)
```bash
npm run report
```

### Generate a tailored resume for a job
```bash
# Find the job ID from a report or --status command first
npx ts-node src/index.ts --resume <job-id>
```

### Generate a cover letter
```bash
npx ts-node src/index.ts --cover-letter <job-id> professional
# Tones: professional | enthusiastic | concise
```

### Generate full application pack (resume + cover letter)
```bash
npx ts-node src/index.ts --apply <job-id> professional
```

### Check status / top jobs in DB
```bash
npx ts-node src/index.ts --status
```

### Start the Web Dashboard
```bash
npx ts-node src/index.ts --dashboard
# Runs locally on http://localhost:3000
```

### Start daemon (scheduled mode, runs daily at 9 AM IST)
```bash
npm run dev
# With immediate first scan:
npx ts-node src/index.ts --run-now
```

### Build for production
```bash
npm run build
npm start
```

---

## ⚙️ Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | *required* | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | Model to use |
| `DATABASE_PATH` | `./data/jobhermes.db` | SQLite database location |
| `REPORTS_DIR` | `./output/reports` | Where HTML reports are saved |
| `DOCUMENTS_DIR` | `./output/documents` | Where resumes/CLs are saved |
| `CRON_SCHEDULE` | `30 3 * * *` | Cron expression (3:30 UTC = 9 AM IST) |
| `TIMEZONE` | `Asia/Kolkata` | Timezone for scheduler |
| `MIN_SCORE_THRESHOLD` | `60` | Minimum score to keep a job |
| `TOP_JOBS_COUNT` | `10` | Number of jobs in report |
| `SCRAPE_CONCURRENCY` | `3` | Parallel scraping requests |
| `REQUEST_DELAY_MS` | `1500` | Delay between requests (ms) |
| `MAX_RETRIES` | `3` | HTTP retry attempts |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

---

## 📊 Scoring Algorithm

Jobs are scored 0–100 across 6 dimensions:

| Dimension | Max Points | What It Measures |
|---|---|---|
| Skill Match | 30 | Overlap between job requirements and your skills |
| Title Match | 20 | How closely the job title matches your target roles |
| Location | 15 | Match against your preferred cities / remote preference |
| Experience | 15 | Whether required years matches your experience |
| Salary | 10 | Whether stated salary meets your minimum |
| Prestige | 10 | Company reputation (curated list of top-tier companies) |

---

## 🗄️ Database Schema

```sql
jobs              -- All scraped + scored job postings
applications      -- Application tracking (resume, CL paths, outcome)
scan_runs         -- History of each daily scan
report_log        -- History of generated reports
```

---

## 🤖 AI Pipeline

1. **Relevance Filter** → GPT checks if each job is relevant before storing
2. **Daily Summary** → GPT writes a human-readable summary of the day's scan
3. **Resume** → GPT tailors your profile to match the specific job description
4. **Cover Letter** → GPT writes a compelling letter with your chosen tone

---

## 📝 Adding More Job Sources

Edit `config/company-targets.json`:

```json
{
  "name": "YourTargetCompany",
  "careers_url": "https://company.com/careers",
  "search_keywords": ["software engineer", "backend"],
  "priority": "high",
  "enabled": true
}
```

---

## 🛠️ Development

```bash
# Type check only
npm run typecheck

# Build and watch
npm run build:watch

# View logs
cat logs/jobhermes-<date>.log
```

---

## 📦 Tech Stack

- **TypeScript** – Type-safe backend
- **Node.js** – Runtime
- **OpenAI SDK** – GPT-4o for AI features
- **better-sqlite3** – Fast synchronous SQLite
- **node-cron** – Cron scheduling
- **axios + cheerio** – HTTP scraping (TinyFetch layer)
- **dotenv** – Environment variable management
- **uuid** – Task ID generation

---

## ⚠️ Notes

- **Scraping**: Many company career pages are dynamic (React SPA). For those, you'll need to extend the scraper with Playwright/Puppeteer. The current TinyFetch implementation handles SSR/static pages well.
- **Rate Limiting**: `REQUEST_DELAY_MS` (default 1500ms) adds a polite delay between requests. Do not set below 1000ms.
- **API Costs**: GPT-4o calls are made per scan for summary generation. Use `gpt-4o-mini` to reduce costs for filtering.

---

*Built with ⚡ by JobHermes – Your autonomous AI job hunting agent*

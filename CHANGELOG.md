# Changelog

All notable changes to the JobHermes SDET Job-Search Copilot will be documented in this file.

## [Phase 5: CI/CD, Playwright E2E Tests, Quality Tooling & Portfolio Documentation] - 2026-10-18

### Added
- **Playwright Headless E2E Test Suite (`tests/e2e/dashboard-e2e.test.ts`)**:
  - Full browser verification against isolated demo sandbox database (`tests/fixtures/test-e2e-demo.db`).
  - Validates active job discovery and strict exclusion of stale closed jobs from primary views.
  - Verifies contact CSV import and table rendering with roles and unknown email statuses.
  - Verifies human-in-the-loop draft approval via UI and API token authentication.
  - Tests timezone-aware dry-run sending: verified blocked out of business hours (Sunday evening IST) and verified allowed within business window via fake clock injection (`fakeNow`), generating local RFC-822 `.eml` files.
- **GitHub Actions CI Workflow (`.github/workflows/ci.yml`)**:
  - Multi-version Node matrix (18.x, 20.x).
  - Enforces Prettier code style (`format:check`), ESLint (`lint`), TypeScript type checking (`typecheck`), unit tests (`test:unit`), offline contract tests (`test:contract`), REST API integration tests (`test:api`), and Playwright E2E tests (`test:e2e`).
  - Generates V8 code coverage report and uploads CI artifact on Node 20.x.
  - Operates strictly offline with recorded fixtures (zero live network dependency).
- **Code Quality & Pre-commit Tooling**:
  - ESLint configuration (`.eslintrc.json`) with `@typescript-eslint` recommended rules.
  - Prettier configuration (`.prettierrc`, `.prettierignore`) enforcing standardized formatting across TypeScript, HTML, CSS, and JSON.
  - Husky Git hooks (`.husky/pre-commit`) running lint, typecheck, and unit tests before any commit.
- **Coverage Tooling (`@vitest/coverage-v8`, `vitest.config.ts`)**:
  - Configured V8 coverage reporting outputs (`text`, `json`, `html`, `lcov`).
- **`first-run` Onboarding Command (`src/index.ts`)**:
  - Interactive status reporter checking profile review state, remaining `[FILL]` markers, verified company target count, human contacts per qualified role, and stored company research briefs.
  - Pure diagnostic reporter that guides user setup and refuses nothing.
- **Portfolio-Grade Documentation (`README.md`)**:
  - Comprehensive SDET Copilot pitch, Mermaid architecture diagram, 5-step setup guide, full configuration reference, "First Week" operational guide, ethical safety model, test strategy breakdown, and architectural design decisions.
  - Explicit `[DEMO OUTPUT]` labeling on all sample drafts.

## [Phase 4: Localhost Express Dashboard, Stale Job Detection & Scheduler] - 2026-10-17

### Added
- **Localhost-Only Express Dashboard Server (`src/dashboard/server.ts`)**:
  - Bound strictly to loopback interface `127.0.0.1` on port 3987 (or configurable `PORT`).
  - Bearer token authentication required for state mutations (`X-Hermes-Token` header) with token written to local file readable only by the OS user.
  - Complete REST API with 20 integration tests (`tests/api/dashboard.test.ts`).
  - 7 responsive dark-mode views: Today, Jobs, Companies & Signals, Contacts, Outreach Queue, Analytics, Settings & Health Diagnostics.
- **Database Migration 4: Near-Miss Tracking (`004_near_miss.sql`)**:
  - Added `near_miss` column to `jobs` table to index roles scoring 40–59 points.
- **Database Migration 5: Stale Job Detection (`005_stale_jobs.sql`)**:
  - Added `consecutive_missed_scans` column to `jobs` table.
  - Automatically transitions jobs absent for 2 consecutive scans to status `closed`.
  - Stale closed jobs are automatically excluded from the Today tab, top qualified jobs, and outreach generation.
- **Resilient Miss Counting (`src/storage/database.ts`, `src/sources/`)**:
  - Miss counters only increment when target fetch succeeded (HTTP 200, valid parsed payload).
  - On timeout, 4xx/5xx HTTP errors, parse failures, or empty responses from previously active targets, miss counting is skipped and a warning is logged.
  - Added 5 unit tests validating no jobs are closed on network or parsing failures.
- **Scoring Recalibration (`src/scoring/rescore.ts`)**:
  - Added `rescore` CLI command to recalculate scores for all jobs upon company signal changes.

## [Phase 3: Outreach Engine, Grounded Generation & Safety Rail Guards] - 2026-10-16

### Added
- **Database Migration 3: Outreach Pipeline (`003_outreach.sql`)**:
  - Added `outreach` table with variant tracking, approval status, local `.eml` paths, and outcome logging.
- **Grounded Draft Generator (`src/outreach/draft-generator.ts`)**:
  - Generates Variant A (direct proof), Variant B (role-targeted), and LinkedIn referral DMs.
  - Strictly enforces word counts (80–120 words), short subject lines (<8 words), one concrete proof point, and one low-friction ask.
  - Grounding guarantee: candidate achievements and skills are used verbatim from the candidate profile without fabricated purpose clauses.
  - Company claims must strictly cite stored research briefs or signals with verified URLs.
  - Added automated rule linter (`lintOutreachDraft`).
- **Safety Rails & Refusal Engine (`src/outreach/send-service.ts`)**:
  - Strict human-in-the-loop gate: drafts cannot be sent without explicit manual approval.
  - Timezone-aware send window: enforces Monday–Friday 09:00–18:00 in the recipient contact's local timezone.
  - Refuses real-mode sending on unresolved `[FILL]` markers, demo/sample data, unverified email addresses, and suppressed contacts.
  - Daily sending volume cap (default 5 emails/day) and bounce rate circuit breaker (>10% pause).
  - Dry-run mode active by default, writing formatted RFC-822 `.eml` files to `output/eml/`.
- **Automated Follow-Up Engine (`src/outreach/follow-up-service.ts`)**:
  - Detects sent outreach older than 6 business days with no reply and generates follow-up drafts.
  - Hard limit of 2 emails per contact; automatically terminates upon contact reply or suppression.
- **Resume Tailoring Engine (`src/outreach/resume-tailor.ts`)**:
  - Reorders Markdown resume sections and highlights matched keywords against job descriptions without fabricating skills or metrics.
- **Isolated Demo Sandbox (`src/utils/demo-sandbox.ts`)**:
  - Complete demo environment in `data/demo.db` with sample targets, contacts, signals, and jobs for safe exploration.

## [Phase 2: Database Migrations, Contacts, Signals & Application Tracking] - 2026-10-14

### Added
- **Database Migrations Engine (`src/storage/migrations.ts` & `src/storage/migrations/`)**:
  - `001_core.sql`: versioned DDL for `jobs`, `applications`, and `scan_runs`.
  - `002_contacts_signals.sql`: versioned DDL for `companies`, `contacts`, `signals`, `suppression_list`, and `api_usage`.
  - Idempotent migration runner executed on startup with WAL journal mode.
- **Application Tracking**:
  - Preserved direct application tracking in `applications` table and added `application add <jobId> [notes]` and `application list` CLI commands.
- **Target Ingestion CLI (`src/sources/add-company.ts`)**:
  - `add-company <careers-url>` CLI command with automatic ATS detection (Greenhouse, Lever, Ashby, Workable), slug extraction, live API validation, and Playwright fallback configuration instructions.
- **Doctor CLI Diagnostic (`src/utils/doctor.ts`)**:
  - Added `doctor` command that validates environment, API keys, targets, `[FILL]` markers, and warns until `"profile_reviewed": true` is set in `config/candidate-profile.json`.
- **Email Pattern Inferrer (`src/contacts/pattern-inferrer.ts`)**:
  - Corporate email pattern inferrer supporting `first.last`, `flast`, `firstlast`, `first_last`, `first`, and `lastf` with confidence heuristic, marked `guessed`.
- **Contact Service & CSV Importer (`src/contacts/contact-service.ts`)**:
  - Persona targeting heuristics tailored to company size: Startups (<50) -> Founder/CTO; Mid-size (50-500) -> QA Manager / Eng Manager; Enterprises (>500) -> Technical Recruiter.
  - `import-contacts <csv>` CLI command parsing company, name, role, email, timezone, and LinkedIn URL.
  - `contacts list [company]` and `contacts todo` CLI commands.
  - Per-contact recipient timezone support (defaulting to `Asia/Kolkata`) with send-window guard helper (`isWithinSendWindow`).
- **Hunter.io Enrichment Adapter (`src/contacts/hunter-adapter.ts`)**:
  - Optional domain search, email finder, and verification with monthly quota cap (default 25) tracked in `api_usage` SQLite table.
- **Company Signals CLI & Scorer Bonus**:
  - `signal add <company> <type> <detail> [url]` and `signal list [company]` CLI commands.
  - Wired company signals and multiple open QA role density into `HermesAgent` daily scan scoring loop (+10 pt hiring signal bonus, layoff penalty handling).
- **Playwright Fallback Contract Test**:
  - Added fixture-based contract test using `tests/fixtures/sources/custom-careers.html` to verify custom scraping without network dependency.
- **Unit Tests (`tests/unit/contacts.test.ts`, `tests/unit/add-company.test.ts`)**:
  - 18 new unit tests covering pattern inferrer, targeting rules, timezone send-window guard, CSV import, Hunter quota capping, and signal scorer bonus.

## [Phase 1: ATS Sources, HTTP Client & 100-Point SDET Scorer] - 2026-10-13

### Added
- **Branch**: Created `redesign/copilot`.
- **Shared HTTP Client (`src/sources/http-client.ts`)**: Built with custom User-Agent, per-host request queueing/rate-limiting, exponential backoff on 429/5xx, and caching.
- **Local Source Cache (`src/sources/cache.ts`)**: File & memory TTL caching to prevent hammering public APIs during re-runs.
- **ATS Adapters (`src/sources/`)**:
  - `GreenhouseSource` (`boards-api.greenhouse.io`)
  - `LeverSource` (`api.lever.co`)
  - `AshbySource` (`api.ashbyhq.com`)
  - `WorkableSource` (`apply.workable.com`)
  - `RemotiveSource` (`remotive.com`)
  - `RemoteOKSource` (`remoteok.com`)
  - `AdzunaSource` (Adzuna India aggregator, optional behind env flag)
  - `PlaywrightFallbackSource` (for custom JavaScript-rendered career pages)
- **Target Verification CLI (`src/sources/verify-targets.ts`)**: Hits all configured ATS endpoints in `config/company-targets.json`, reporting working vs. 404 slugs and updating `verified: true/false`.
- **SDET 100-Point Scoring Model (`src/scoring/scorer.ts`)**:
  - Title match (25 pts): exact SDET/Automation vs QA with automation vs manual rejection.
  - Skill match (30 pts): weighted SDET stack matching with synonym mapping (`src/scoring/skill-synonyms.ts`).
  - Experience fit (15 pts): parses 1-3 YOE sweet spot, handles freshers, and flags 4-6 YOE as `stretch: true`.
  - Location fit (10 pts): Delhi NCR / Bangalore / Remote.
  - Freshness (10 pts): <= 3d (10 pts), <= 7d (7 pts), <= 14d (4 pts).
  - Hiring signal bonus (10 pts): company open QA role density or recorded signals.
  - Salary bonus (5 pts): parsed LPA meeting minimum requirements.
  - Human-readable reason strings per dimension in `reasons[]` and `scoreBreakdown`.
- **Safety Guard (`hasFillMarkers`)**: Prohibits document generation and email sends when unresolved `[FILL]` placeholders exist in `config/candidate-profile.json` or `config/base-resume.md`.
- **Contract Tests (`tests/contract/sources.test.ts`)**: 7 fixture-based contract tests for all ATS adapters.
- **Target Seeds**: Seeded `config/company-targets.json` with 41 real companies and initialized candidate profile/resume templates with `[FILL]` markers.

### Removed
- `experiments/linkedin-spike/`: Removed entirely to prevent account ban risks and bypass non-functional CAPTCHAs.
- `src/scraper/`: Removed legacy Cheerio heuristic scrapers.
- `src/reports/report-generator.ts`: Removed legacy HTML report builder.
- Unused dependencies: Removed `exceljs`, `@types/exceljs`, and `node-fetch`.

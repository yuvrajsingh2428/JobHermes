# Changelog

All notable changes to the JobHermes SDET Job-Search Copilot will be documented in this file.

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
  - Persona targeting heuristics tailored to company size: Startups (<50) $\rightarrow$ Founder/CTO; Mid-size (50-500) $\rightarrow$ QA Manager / Eng Manager; Enterprises (>500) $\rightarrow$ Technical Recruiter.
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
  - 18 new unit tests covering pattern inferrer, targeting rules, timezone send-window guard, CSV import, Hunter quota capping, and signal scorer bonus (48 tests passing total).

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
  - Freshness (10 pts): $\le 3$d (10 pts), $\le 7$d (7 pts), $\le 14$d (4 pts).
  - Hiring signal bonus (10 pts): company open QA role density or recorded signals.
  - Salary bonus (5 pts): parsed LPA meeting minimum requirements.
  - Human-readable reason strings per dimension in `reasons[]` and `scoreBreakdown`.
- **Safety Guard (`hasFillMarkers`)**: Prohibits document generation and email sends when unresolved `[FILL]` placeholders exist in `config/candidate-profile.json` or `config/base-resume.md`.
- **Contract Tests (`tests/contract/sources.test.ts`)**: 7 fixture-based contract tests for all ATS adapters.
- **Unit Tests**:
  - `tests/unit/parsers.test.ts`: 9 tests for experience and salary regex extractors.
  - `tests/unit/scorer.test.ts`: 5 tests covering sweet spot, manual exclusion, stretch detection, and unstated YOE.
  - `tests/unit/fill-guard.test.ts`: 3 tests verifying `[FILL]` marker rejection.
- **Target Seeds**: Seeded `config/company-targets.json` with 41 real companies and initialized candidate profile/resume templates with `[FILL]` markers.

### Removed
- `experiments/linkedin-spike/`: Removed entirely to prevent account ban risks and bypass non-functional CAPTCHAs.
- `src/scraper/`: Removed legacy Cheerio heuristic scrapers.
- `src/reports/report-generator.ts`: Removed legacy HTML report builder.
- Unused dependencies: Removed `exceljs`, `@types/exceljs`, and `node-fetch`.

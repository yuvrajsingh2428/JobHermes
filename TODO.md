# Implementation Plan & TODO

## Phase 1: Cleanup, ATS Sources & 100-pt SDET Scorer
- [x] Delete `experiments/linkedin-spike/`, legacy scrapers, and reports
- [x] Clean unused dependencies (`exceljs`, `node-fetch`); add `zod`, `pino`, `vitest`, `nodemailer`
- [x] Seed `config/candidate-profile.json` and `config/base-resume.md` with explicit `[FILL]` markers
- [x] Implement shared HTTP client with per-host rate limiting, exponential backoff, and caching
- [x] Build ATS source adapters: Greenhouse, Lever, Ashby, Workable, Remotive, RemoteOK, Adzuna, Playwright fallback
- [x] Implement `verify-targets` CLI tool and seed 41 company targets
- [x] Implement 100-pt SDET scoring engine + synonym map + parsers
- [x] Write contract tests with recorded JSON fixtures and comprehensive unit tests (24/24 passing)

---

## Phase 2: Contacts & Company Research Layer
- [x] Versioned SQLite migration engine with `schema_migrations` table
- [x] New tables: `companies`, `contacts`, `signals`, `suppression_list`, `api_usage`
- [x] Preserve existing `applications` table for direct manual tracking (`application add`, `application list`)
- [x] Manual contact import: CLI command `import-contacts <csv>` + CSV parser
- [x] CLI command `signal add <company> <type> <detail> [url]` and scorer bonus integration
- [x] Contact targeting rules by company size (startup vs mid vs large)
- [x] Email pattern inferrer ({first}.{last}, etc.) with `guessed` status
- [x] Optional Hunter.io adapter with monthly quota cap (default 25) in SQLite
- [x] Per-company research brief storage
- [x] Optional per-contact recipient timezone support (default `Asia/Kolkata`) and send-window guard helper (`isWithinSendWindow`)
- [x] `add-company <careers-url>` CLI with ATS & slug detection, live API verification, and Playwright fallback configuration
- [x] `doctor` CLI diagnostic with candidate profile review warning
- [x] Playwright fallback contract test using saved HTML fixture

---

## Phase 3: Outreach Engine, Safety Guardrails & Tailoring
- [ ] `outreach` table and A/B draft generation (no fluff, fact-grounded)
- [ ] CLI review & approval: `outreach list`, `outreach approve <id>`, `outreach edit <id>`
- [ ] LinkedIn DM referral ask template generator (copy-to-clipboard)
- [ ] Safety guard: strict human approval gate, max 20 sends/day, min 90s delay with jitter, 9-18 recipient timezone window (contact timezone aware)
- [ ] Opt-out line and bounce circuit-breaker (>10% pause)
- [ ] Dry-run mode (`.eml` writer / console) default ON
- [ ] 6-day automated follow-up draft generator
- [ ] Base resume Markdown reordering, diff display, keyword-gap analyzer

---

## Phase 4: Express Dashboard (Localhost-Only) & Scheduler
- [ ] Express 127.0.0.1 localhost-only server
- [ ] 7 dashboard pages: Today, Jobs, Companies, Contacts, Outreach, Analytics, Settings
- [ ] Signal recording dashboard form
- [ ] Daily scan at 8:30 AM IST cron schedule

---

## Phase 5: CI/CD, E2E Tests & Portfolio README
- [ ] Playwright E2E tests for dashboard flows
- [ ] Supertest API tests for Express endpoints
- [ ] GitHub Actions CI workflow
- [ ] Portfolio-grade README with Mermaid diagrams and design decisions

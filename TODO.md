# Implementation Plan & Roadmap

## Phase 1: Cleanup, ATS Sources & 100-pt SDET Scorer
- [x] Delete legacy scrapers, unneeded reports, and fragile automation
- [x] Clean dependencies; add `zod`, `pino`, `vitest`, `better-sqlite3`
- [x] Seed `config/candidate-profile.json` and `config/base-resume.md` with explicit `[FILL]` markers
- [x] Implement shared HTTP client with per-host rate limiting, exponential backoff, and caching
- [x] Build ATS source adapters: Greenhouse, Lever, Ashby, Workable, Remotive, RemoteOK, Adzuna, Playwright fallback
- [x] Implement `verify-targets` CLI tool and seed verified company targets
- [x] Implement 100-pt SDET scoring engine + synonym map + parsers
- [x] Write contract tests with recorded JSON fixtures and comprehensive unit tests

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
- [x] Per-contact recipient timezone support (default `Asia/Kolkata`) and send-window guard helper (`isWithinSendWindow`)
- [x] `add-company <careers-url>` CLI with ATS & slug detection, live API verification, and Playwright fallback configuration
- [x] `doctor` CLI diagnostic with candidate profile review warning
- [x] Playwright fallback contract test using saved HTML fixture

---

## Phase 3: Outreach Engine, Safety Guardrails & Tailoring
- [x] `outreach` table and A/B draft generation (no fluff, fact-grounded)
- [x] Candidate sentences grounded strictly in profile fields verbatim (no AI-invented purpose clauses)
- [x] CLI review & approval: `outreach list`, `outreach approve <id>`, `outreach edit <id>`
- [x] LinkedIn DM referral ask template generator (copy-to-clipboard)
- [x] Safety guards: strict human approval gate, max 5 sends/day, 9-18 recipient timezone window (contact timezone aware)
- [x] Opt-out line and bounce circuit-breaker (>10% pause)
- [x] Dry-run mode (`.eml` writer) default ON
- [x] 6-day automated follow-up draft generator with max 2 emails per contact
- [x] Base resume Markdown reordering, diff display, keyword-gap analyzer (no skill fabrication)
- [x] Isolation of demo sandbox data into `data/demo.db` with demo-source signal suppression

---

## Phase 4: Express Dashboard (Localhost-Only) & Scheduler
- [x] Express 127.0.0.1 localhost-only server with bearer token security
- [x] 7 dashboard pages: Today, Jobs, Companies & Signals, Contacts, Outreach Queue, Analytics, Settings & Diagnostics
- [x] Near-miss tier (40-59 fit) tracking with migration 4
- [x] Stale job detection with migration 5 (`consecutive_missed_scans`, status 'closed', excluded from Today/outreach)
- [x] Resilient missed scan counting: only increments on successful 200 fetch; logs warning on timeout/HTTP error/parse error
- [x] Automated follow-up reviews and status editing
- [x] CLI `rescore` command to recalibrate fit without deleted signals

---

## Phase 5: CI/CD, E2E Tests & Portfolio Documentation
- [x] Playwright E2E test suite running against `demo.db` (approval, dry-run fake clock send, CSV import, job filtering, closed-job exclusion)
- [x] REST API integration tests covering all Express endpoints
- [x] ESLint (`.eslintrc.json`), Prettier (`.prettierrc`), and Husky pre-commit hook
- [x] GitHub Actions CI workflow (Node 20/22 matrix, lint, typecheck, unit, contract, API, E2E, coverage artifact, zero live network)
- [x] `first-run` CLI reporter checking configuration completeness
- [x] Production portfolio README with pitch, Mermaid architecture, 5-step quickstart, safety model, and design decisions
- [x] Updated CHANGELOG.md and TODO.md

---

## Known Limitations & Intentional Architectural Constraints

1. **No Automated Inbox / Reply Detection**: JobHermes intentionally does not connect to email providers via IMAP or Gmail API to read incoming mail. Reply tracking is recorded manually via CLI (`outreach reply <id> [outcome]`) or the Dashboard UI to avoid storing broad mailbox credentials or requesting sensitive permissions.
2. **Hunter.io Email Verification Is Optional**: Live email verification via Hunter.io is strictly optional and guarded by a configurable monthly quota cap (default: 25 calls/month in SQLite `api_usage`). When unset or exhausted, candidate contacts can be manually verified (`contacts verify <id>`) or imported with verified status.
3. **LinkedIn Outreach Is Manual by Design**: To strictly comply with LinkedIn Terms of Service and prevent account bans, JobHermes does not automate browser interactions or automated DM sending on LinkedIn. The copilot generates optimized, role-specific referral copy (<75 words) formatted for one-click copy and manual candidate delivery.
4. **Localhost-Only Single-User Security Model**: The Express dashboard server binds strictly to `127.0.0.1` and is protected by `X-Hermes-Token` authentication and strict Origin/Referer CSRF validation. It is intentionally designed as a local developer tool, not a multi-tenant or publicly accessible web service.
5. **Zero Fabrication of Candidate Skills & Experience**: Resume tailoring and outreach drafting strictly forbid adding skills, years of experience, or metrics not already present in the candidate profile or base resume. Any keyword gap is surfaced for candidate review rather than hallucinated.
6. **Clock Overrides Restricted to Test Execution**: Test clocks cannot be passed or overridden via HTTP parameters, request headers, or runtime environment variables in production mode. Dynamic time travel is only accessible via programmatically set in-memory hooks during test execution (`NODE_ENV === 'test'`).
7. **Jobs of a company that removes all postings are never auto-closed (empty-response guard)**: When an ATS API returns 200 with an empty job list for a company that previously had active jobs, miss counting is skipped to guard against transient empty responses. Consequently, jobs of a company that legitimately removes all postings are never auto-closed by the automated scanner.

---

## Backlog & Future Improvements
- [ ] Jobs of a company that removes all postings are never auto-closed (empty-response guard)



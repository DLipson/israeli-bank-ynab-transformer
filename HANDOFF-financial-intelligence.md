# Handoff — financial-intelligence

Living snapshot, updated after every phase. Last update: 2026-10-20 (Home redesign Phase 10 complete).

## Active task: Home redesign

- Main repo: `C:\Users\Dovid L\Dev\israeli-bank-ynab-transformer`; implementation worktree: `C:\Users\Dovid L\Dev\israeli-bank-ynab-transformer-home-redesign`.
- Branch: `home-redesign`, based on `master` at `352243c`. One branch for all phases; one commit per phase; do not push or merge.
- The plan and mockup are copied into the worktree. The local spec is not copied and must never be committed.
- Phases 0–10 are implemented. Phase 0: `npm test` passed (22 files, 205 tests); GUI TypeScript project check passed. Phase 1: `npm test` passed (23 files, 208 tests); `npm run build` passed. Real data through 19 Oct from the local cache: spent ₪19,766.44, income ₪18,095.81; the ₪30 difference from the spec sample is the positive uncategorized transaction counted as income only per the user. Phase 2: `npm test` passed (23 files, 218 tests); root build and GUI TypeScript check passed. Use Node 24.11.1: prefix PATH with `/c/Users/Dovid L/AppData/Local/nvm/v24.11.1` (PATH default is 22.13.1). The engine now returns five keyed available-until-payday lines, follows the new payday setting and legacy migration, calculates selected essentials and partial overrides, filters bills, and excludes overdraft from card exposure.
- `npm install` completed in the root and `gui`; `node_modules/israeli-bank-scrapers` links to `C:\Users\Dovid L\Dev\israeli-bank-scrapers`.
- User deleted the duplicate Leumi Cards schedules and the duplicate ₪30 איחוד הצלה entry in YNAB. No YNAB writes have been made by this task.

### Phase checklist

- [x] 0 — Data fixes: charge-date parsing and month-end income.
- [x] 1 — Engine: spent vs income.
- [x] 2 — Engine: available until payday.
- [x] 3 — Engine: category comparisons (`category-comparisons.ts`; 224 tests pass).
- [x] 4 — Engine: cards (`cards.ts`; 229 tests pass).
- [x] 5 — Spending API and Undo endpoints (240 tests pass; real-data GET checked on port 3002).
- [x] 6 — GUI shell and update chip (browser-checked with a fake scrape stream).
- [x] 7 — Home (browser-checked at 680/375 px, light/dark).
- [x] 8 — Inbox and Undo (YNAB writes faked in the browser; live Undo writes not yet tested).
- [x] 9 — Cards (browser-checked; colors change at the warning level and at 0).
- [x] 10 — Scrape (browser-checked with a fake event stream).
- [ ] 11 — Settings and links.
- [ ] 12 — Monthly report.
- [ ] 13 — Treat as refund (added 20 Oct).

### User decisions that override stale plan text

- `spentVsIncome` must include the full spending transaction list; savings transfers count from any source account.
- Bills count only when not a transfer, dated today through period end, and not already reflected by a similar same-account transaction within 25% amount and 5 days. Card-account charges remain eligible.
- Undo stays in the open Inbox's browser memory and clears on reload/restart. The server records IDs of schedules it creates; Undo may delete only those IDs.
- Positive uncategorized transactions count as income. Home will offer an explicit action to update the YNAB category when treating one as a refund; an optional link to its purchase is stored locally because YNAB does not link those transactions directly. Mock the YNAB update in tests; no live writes during development.
- Payday is a day of the month (or `month-start`); the period ends the day before payday. Migrate old `periodEnd` once; keep `flexibleCategoryIds` unchanged and start essentials empty. An unedited category in a current-period essentials override uses its calculated amount.
- Never run tests or browser actions that write to YNAB; any possible YNAB write requires stopping for the user. Use API mocks and ports 3002/5174; leave 3001/5173 running.

Decision log: `docs/financial-intelligence-notes.md`. Source plan: `IMPLEMENTATION-PLAN-home-redesign.md`. Mockup: `docs/mockups/home-redesign.html`.

## Previous project snapshot

The roadmap and code map below describe the pre-redesign state and are retained as historical context. The active checklist above is the current status.

## 1. Goal

A financial intelligence layer on top of YNAB for an Israeli household, built in this repo (this repo also scrapes Israeli banks/cards and imports to YNAB). Source: a ChatGPT conversation (`C:\Users\Dovid L\Downloads\_gpt_dump.txt`). Principles from it: YNAB is the source of truth; deterministic code calculates, the LLM only explains; installments are one part, not the whole design.

User preferences: ASD-STE100 style + ADHD-friendly output (action first, numbered steps, ≤5 items); no time/effort estimates; no Claude attribution in commits/PRs; atomic commits when asked; always confirm before any write to YNAB; browser tests in a separate tab with writes blocked (fetch override) — never navigate the user's tab; never stop servers someone else started.

## 2. Roadmap: original concept vs. status

Done:
- Cash-flow "left to spend until period end": bank incl. overdraft + card balances (spent at purchase) − scheduled outflows − **expected normal spending until period end** − buffer. YNAB-categories alternative with a mode switch.
- **Baseline + pace** (median of 6 months, configurable): normal month, pace up to the newest import, top 3 over pace, fixed categories paid/due.
- **Reports in the app** (weekly Sunday, start of month, end of month: actual vs. assigned vs. normal), saved by a daily Windows task.
- Credit exposure per shared-limit group + overdraft (limits by hand; user has not entered them yet).
- Installment ledger from memo `installment: "n/total"`; Coming months.
- Fixed payments = YNAB scheduled transactions; suggestions of new ones from history.
- Categorize (history, card sector, Big Pickle + Serper). Local YNAB cache with delta sync.
- **Anomaly detectors** (`src/engine/anomalies.ts`, last 30 days, dismissible): unusual charge, new payee, possible duplicate, category over a whole normal month, price increase. Shown in Review → Unusual, Home "Needs attention", and the weekly report.
- **UI reorganized**: top tabs Home / Scrape (+ past runs) / Review (Categorize + Schedules) / Reports / Setup (bank accounts, YNAB import, spending settings). Home = one number + pace line + "Needs attention" links + 3 summaries; Details holds the rest.

Not built yet, suggested order:
1. **Cash-flow forecast by date**: day-by-day balance to month end using card debit days (Leumi/Cal 2nd, small ones 10th/15th) and schedules; lowest point.
2. **Commitments view**: recurring + installments + user-entered one-offs for 3 months; share of future income already committed (needs expected income).
3. **Email delivery** of the reports (user chose in-app first; Gmail SMTP reachable through NetFree; credentials not set).
4. Installment detail ("ending soon", Tashlumim tracking account), card statement/payment days, Max limit from the scraper, LLM chat over the numbers (`/status`, `/why`), one "needs attention" panel.

## 3. Current state / not verified

- Daily task "IBYT spending reports" (Windows Task Scheduler): 10:00 daily, StartWhenAvailable, runs `npm run report:spending` in the main checkout; log `~/.config/israeli-bank-ynab-transformer/reports/last-run.log`. First run 2026-10-12 16:39: result 0. Reports state: weekly 2026-10-12, month-start 2026-10, month-end 2026-09. First real Sunday run: 2026-10-18.
- Servers on 3001/5173 run from the main checkout (started by the user or the other session); do not stop them without asking. Test new work in a sibling worktree on ports 3002/5174 (`PORT`, `API_PORT`; add temporary `api-worktree`/`gui-worktree` launch entries with forward-slash paths, remove them after).
- Bank data in YNAB as of 2026-10-09 (pace warns when ≥3 days old).
- Serper key saved; web-search path not yet seen on real data. 12 schedule suggestions pending. Card limits not entered.

## 4. Code map

- Engine: `src/engine/safe-spending.ts` (+tests), `src/engine/baseline.ts` (+tests), `src/engine/reports.ts` (+tests), services `safe-spending-service.ts`, `reports-service.ts`, runner `run-reports.ts`; route `src/server/routes/spending.ts` (`GET /api/spending`, `PUT /settings`, `POST /scheduled`, `POST /ignore`, `GET /reports`, `POST /reports/:type`); UI: `gui/src/App.tsx` (tabs, navigation), `gui/src/pages/HomePage.tsx`, `gui/src/pages/SpendingPage.tsx` (SpendingProvider + shared panels), `gui/src/lib/spending.ts` (useSpending hook, formatters).
- Categorize: `src/ynab/categorize.ts` (+tests), `categorize-service.ts`, `src/server/routes/categorize.ts`, `gui/src/pages/CategorizePage.tsx`.
- Cache: `src/ynab/transaction-cache.ts` → `~/.config/israeli-bank-ynab-transformer/ynab-cache/<budgetId>.json`. Config files in `~/.config/israeli-bank-ynab-transformer/`: `safe-spending.json`, `categorize-rejections.json`, `ynab-import.json`, `reports/`.
- Credentials (Windows Credential Manager): `israeli-bank-ynab-transformer:YNAB_API_TOKEN`, `…:SERPER_API_KEY`; read at most every 5 min.
- Manual read-only checks: `npx tsx scripts/try-spending.ts`, `scripts/try-categorize.ts [--llm]`, `scripts/try-llm.ts`.

## 5. Gotchas

- NetFree: Node needs `NODE_EXTRA_CA_CERTS=C:\ProgramData\NetFree\CA\netfree-ca-list.crt`. Blocked: DuckDuckGo, Exa, Tavily, Google Custom Search API. Allowed: google.com, Serper, Brave API, Google Places API, he.wikipedia, data.gov.il, smtp.gmail.com:465.
- YNAB: `GET /transactions` without `since_date` returns 1 year only. Imports match user-entered/scheduled transactions only on exact amount, same account, ±10 days. Transfers between budget accounts have no category.
- opencode/Big Pickle: free tier rejects a restricted `opencode.json`; opencode uses `PWD` not cwd; open stdin → 5-minute hang; `-f` swallows later args; kill via `taskkill /T /F`.
- Dev ports: `PORT` (API) and `API_PORT` (GUI proxy) env vars allow a second checkout on 3002/5174; with PowerShell use `npx vite --port 5174 --strictPort` (npm `--` args get lost).
- Line endings: repo files are LF; check with `git ls-files --eol`. Python text mode writes CRLF; Python string escapes broke on `\U` paths — prefer the Edit tool. `node -e` inside bash single quotes loses regex backslashes. Node and Git Bash resolve `/tmp` differently; use the scratchpad. Deleting a worktree with node_modules needs `Remove-Item -LiteralPath '\\?\<path>' -Recurse -Force`.
- `npm run dev:server` (tsx) has no watch. GUI typecheck `cd gui && npx tsc -b` can take 3-5 min.
- Dough (`C:\Users\Dovid L\Dev\dough`): reference only; user to decide keep/delete.
- Leumi scraper (2026-10-14): login was rejected by F5 ("Request Rejected") because the scraper submitted the form before the Next.js login app took over (native document POST). Fix, uncommitted on fork branch `leumi-via-home-page` (library built): home page -> click `.enter_account` -> wait for the login fields AND for `/api/v2/auth/key_exchange` (app started) before filling. Login tracing: fork `traceLeumiPage`/`logPageState`; this repo `src/scraper-trace.ts` (uses the other session's uncommitted `src/paths.ts`) -> Leumi log `[trace]` lines + `~/.config/israeli-bank-ynab-transformer/scraper-traces/leumi-<time>.log`. Waiting on the user's real run; then commit both repos.

## 6. Commands

- Run: preview configs `api` (3001) + `gui` (5173) in `.claude/launch.json`, or `npm run dev:all`.
- Tests: `npx vitest run` (176), `cd gui && npx vitest run` (6). Lint: `npx eslint src`, `cd gui && npx eslint src`.
- Reports: `npm run report:spending` (makes due reports).

## START HERE

Ask which roadmap item (§2 "Not built yet") to build next — recommended: the day-by-day cash-flow forecast (item 1). After merging backend changes, the user must restart the API server (tsx has no watch); the GUI reloads by itself and expects the new API fields. Write a short plan, get approval, build, test with writes blocked, commit when asked, update this file and the notes log.

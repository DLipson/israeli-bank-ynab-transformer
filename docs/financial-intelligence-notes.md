# Financial intelligence layer: decision log and setup notes

Started 2026-10-06. Keep this file current. Add new entries to the log at the end.

## Goal

The user wants a system on top of YNAB that answers these questions:

- How much can I safely spend this month?
- How much of my credit limit is in use, including future installments?
- How much will my cards charge each month for the next months?
- What is unusual in my spending?
- What do recurring payments, installments, and known one-off payments commit me to?

It must also send reports (weekly, start of month, end of month) and let the user ask questions to an LLM.
Rule from the source conversation: deterministic code calculates the numbers. The LLM only explains them.

The source conversation (ChatGPT) was in `C:\Users\Dovid L\Downloads\_gpt_dump.txt`. It proposes these layers:

1. YNAB is the source of truth.
2. A local state database: cards (limit, statement day, payment day), installments, recurring commitments, one-off commitments, assumptions.
3. An analysis engine: cash position, spending pace, baseline, anomalies, recurring charges, cash-flow forecast, credit exposure, safe spending.
4. An LLM layer: chat commands (`/status`, `/review`, `/plan`, `/forecast`, `/why`) and push reports.

Installments are only one part of the concept. Do not design the whole system around them.

## Facts about the existing code

Mark: (read) = checked in code or data. (inferred) = not checked.

### This repo (israeli-bank-ynab-transformer)

- It scrapes Israeli banks and cards, transforms the transactions, and imports them to YNAB through the API. (read)
- The YNAB token is in Windows Credential Manager, target `israeli-bank-ynab-transformer:YNAB_API_TOKEN`. See `src/windows-credential-manager.ts` and `scripts/windows-credential-manager.ps1`. (read)
- The scraper runs with `combineInstallments: false` (`src/scraper.ts`). (read)
- `src/transformer.ts` writes the installment number into the YNAB memo as JSON: `installment: "n/total"`. (read) The user confirmed that the YNAB transactions have this data.
- Scrape history: one JSON file per run, deleted after 90 days (`src/history.ts`). This is too short for trend analysis. (read)
- The "email feature" (`src/ynab/send-daily-report-email.ts`, `report-service.ts`) sends only a list of selected YNAB categories with their available balance, colored red, yellow, or green. It does no analysis. The user has never used it. (read)
- The API server (`src/server/index.ts`) uses port 3001. (read)

### israeli-bank-scrapers

- Each transaction has `installments: { number, total }`, `originalAmount`, and `chargedAmount` (`src/transactions.ts`). (read)
- The Max scraper reads `CreditLimit` and `OpenToBuy`. (read) The other card scrapers: not checked.

## Existing projects that were evaluated

| Project | What it covers | License |
|---|---|---|
| Dough (github.com/rollecode/dough) | Daily budget, burn rate, cash-flow simulation, bills, income, debts, AI advisor chat, daily AI summaries, MCP. Next.js 16 + SQLite. | AGPL-3.0 |
| Maronato/ynab-mcp | 26 MCP tools, including deterministic spending trends, anomaly detection, recurring charges, budget health. Local cache with delta sync. | MIT |
| Others named by ChatGPT (Avenir-MCP, Moneylight, Fintective, Daily Brief, PayPlan, List Debt, Actual, Lumy) | Ideas only. Not checked. | - |

Facts about Dough and Maronato come from their READMEs and from running Dough. Their code was not reviewed in depth.

## Current decision

- This repo stays the input pipeline (bank → YNAB).
- The analysis layer runs on top of YNAB.
- Candidate: fork Dough and add an Israeli credit-card model. The other options are: build in this repo and copy Dough's design and Maronato's tools, or run Dough unchanged and add a small module.
- Use Maronato's ynab-mcp unchanged for LLM chat questions (planned, not installed).
- The decision depends on a test: run Dough on real data and check its numbers.

The gap that no project covers: the Israeli credit-card model.
- Card charges leave the bank once a month on a fixed debit day.
- Installments use the credit limit now but use cash month by month.
- Each card has a credit limit that is separate from cash.

## Dough local setup

Location: `C:\Users\Dovid L\Dev\dough` (clone of upstream commit `1403f71`, 2026-10-05).

Start it:

```powershell
& "C:\Users\Dovid L\Dev\dough\run-dough.ps1"        # real data, data/dough.db
& "C:\Users\Dovid L\Dev\dough\run-dough.ps1" -Demo  # demo data, login demo@example.com / demo1234
```

In Claude Code, `.claude/launch.json` in this repo has a `dough` configuration for the browser preview.

URL: http://localhost:3031. Login user: `you` (created with the seed script; the password is the placeholder from the setup command).

### What `run-dough.ps1` does, and why

1. Puts Node 24.11.1 (from nvm) first on PATH. Dough's `better-sqlite3` 13 needs Node-API 10. The global Node 22.13.1 has Node-API 9, and the module crashed with an access violation. The global Node was not changed.
2. Sets `NODE_EXTRA_CA_CERTS` from the machine variable if it is empty. NetFree intercepts HTTPS. Its CA file is `C:\ProgramData\NetFree\CA\netfree-ca-list.crt`. Without it, YNAB calls fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.
3. Reads the YNAB token from Windows Credential Manager through this repo's credential script, and sets `YNAB_ACCESS_TOKEN`. On Windows PowerShell 5, the JSON argument needs escaped quotes, or PowerShell 5 removes them.
4. Starts Next.js on `127.0.0.1:3031`. Port 3001 belongs to this repo's API server. `127.0.0.1` keeps the app off the network.

### Local changes to Dough's code

- `src/lib/household.ts`: `getHouseholdSetting` and `getHouseholdSettings` use `process.env.YNAB_ACCESS_TOKEN` when the database has no `ynab_access_token`. Both have a `Local change` comment. Upstream README mentions `YNAB_ACCESS_TOKEN`, but upstream code does not read it.
- After code changes, run `npm run build` with Node 24 on PATH. `npm start` serves the built output.

### Other setup facts

- `.env.local` has `SESSION_SECRET` and `DOUGH_ENCRYPTION_KEY` (random, from `crypto.randomBytes`).
- Budget selected: "Lipson Budget". It was saved through `POST /api/household`.
- `npm install` reported 6 high-severity vulnerabilities. Not fixed.
- Dough's README supports only Linux and macOS. It runs on Windows with the changes above.

## First results from Dough (2026-10-06, before configuration)

Spending account, income, and bills were not set yet.

- Daily budget 2,440/day. "Available" 34,158. Dough spreads all account balances over 14 days and ignores money owed on the cards.
- Debts 0. Card balances do not count as debt.
- The YNAB credit-card payment category ("Leumi Cards", 7,252) shows as the top spending category.
- All amounts show €. The amounts are shekels.
- Dough's Settings page says nothing about credit cards, card debit days, or installments.

Dough's daily budget formula (from its Settings page): balance spread over 14 days, or until payday plus 1 day if payday is sooner. Bills and debts are subtracted. Future income is not counted.

## How Dough treats accounts (read in code, 2026-10-06)

- Dough syncs all YNAB accounts, including the cards (table `ynab_accounts`).
- The Accounts page shows only `checking`, `savings`, and `cash` (`SPENDING_TYPES` in `src/app/(app)/accounts/page.tsx`).
- "Available" on the dashboard = checking + savings balances, minus excluded accounts (`src/app/(app)/dashboard/page.tsx:250`). Credit cards and lines of credit are not counted.
- "Spending account" = `user_linked_accounts`. It marks which accounts are one person's own spending in a 2-person household. For a single user it has little effect.
- The user's YNAB has a checking account named "Credit Limit" with a balance of +40,000. It models the bank overdraft line. Dough counts it as cash, so "Available" is too high by 40,000.
- YNAB accounts: Main Account, Second Account, Credit Limit (checking); Leumi Cards, Max Card, 8400 - Cal (creditCard); Tashlumim (lineOfCredit, balance 0); 2 closed debt accounts.
- Currency: the `€` symbol was hard-coded 153 times in 32 files. There is no currency setting. Fixed by a local change (see below).
- The user wants "Credit Limit" (+40,000) counted as available money. It is part of what the user budgets from. Do not exclude it.

### How Dough models obligations (read in `src/lib/daily-budget.ts`, `src/lib/commitments.ts`, `src/app/api/debts/route.ts`)

Dough has no credit-card concept. The author is Finnish. (inferred: Finnish households mostly pay by debit card.)

- Daily budget = (checking + savings balance − obligations due in the window − saving goal) ÷ days in the window.
- Obligations come from only 2 sources:
  - Bills: entered manually, each with an amount and a due day.
  - Debts: only YNAB accounts of type `otherDebt`, each with a monthly payment and a due day entered manually.
- YNAB `creditCard` and `lineOfCredit` accounts are synced, but no calculation uses them.
- Result: card purchases do not lower "Available" until the card debit leaves the bank account. Then the money drops suddenly.
- The only workaround in Dough: a manual bill for each card, with the card debit day and the expected amount, updated every month.

## Local changes to Dough's code (complete list)

1. `src/lib/household.ts`: YNAB token fallback to `YNAB_ACCESS_TOKEN` (see the setup section).
2. Currency: every `€` replaced with `₪` in `src/` (sed). AI prompts say "shekels", not "euros". `currency: "EUR"` changed to `"ILS"` in `src/app/api/v1/budget/route.ts`, `src/app/api/v1/summary/route.ts`, `src/lib/dashboard-model.ts`. AI summary prompt (`src/lib/ai/default-prompts.ts`) uses a period as decimal separator. `src/lib/ai/finance-advisor.ts` says `Asia/Jerusalem`. Settings label says "local time" for the sync hour. Not changed: `src/lib/ticker.ts` (stock prices in EUR) and the Finnish text.
3. Credit cards count as available money (user request, 2026-10-06). New helper `isAvailableAccount()` in `src/lib/transaction-utils.ts` (types: checking, savings, creditCard). Used in `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/transactions/page.tsx`, `src/app/api/summary/route.ts`, `src/lib/ai/chat-respond.ts` (2 places), `src/lib/dashboard-model.ts`. `src/lib/budget-math.ts` `moneyLastsDays` SQL includes `creditCard`. The Accounts page shows credit cards (`SPENDING_TYPES`). Not changed: income-account picker, net worth. Result: "Available" went from 34,158 to 33,059 (Leumi Cards −1,303, Cal +204). Card debits are transfers, so they do not count twice.
4. These changes will conflict with upstream updates. Use `git diff` in the Dough folder to see them.

## Safe-spending spec (v1, approved 2026-10-12; fixed payments changed to YNAB scheduled transactions)

Agreed with the user:
- One total "left to spend" for the period. No per-day amount.
- Period: calendar month end by default; configurable (setting `periodEnd`).
- The overdraft ("Credit Limit" checking account, +40,000) always counts as money.
- Credit-card balances count as already spent on the day of purchase.
- Future installments stay OUT of the monthly number. They appear in credit exposure and in the obligations for coming months.
- Future income is never counted before it arrives.
- Buffer: configurable amount.
- Card limits: entered by hand, as groups; cards that share one limit go in one group.
- Two modes, both always calculated and shown; a switch picks the main one.

### Mode A: cash-flow
left = sum(checking + savings balances, including "Credit Limit")
     + sum(credit card balances)            (negative = owed)
     - fixed payments due from today to period end
     - buffer
Fixed payments: detected from history (monthly, same payee, similar amount and day of month),
confirmed or removed by the user; the confirmed list is saved. YNAB scheduled transactions
(none today) can be added to the list later. (Default chosen 2026-10-12; user may change it.)

### Mode B: YNAB categories
left = sum(Available) of the categories the user marks as flexible (setting `flexibleCategories`)
Shows a warning line when Ready to Assign is large (today: 32,688; October assigned: 0).

### Shown with both modes
- Explanation lines that build the total (e.g. "Bank +34,157", "Cards owed -1,099").
- One line that explains the gap between A and B.

### Credit exposure (separate number)
Per limit group: limit - (card balances owed in the group + future installments of cards in the group).
Overdraft group: limit = Credit Limit balance, used = negative part of the other checking accounts (inferred: Main Account is the overdrawn account; confirm).

### Obligations for coming months (separate list)
Per month: future installments (from memo `installment: "n/total"`) + confirmed fixed payments.
Today: installments 797 next month, 655, then 255 x 6, then 20 x 5; remaining total 3,080.

### Settings file
`~/.config/israeli-bank-ynab-transformer/safe-spending.json`:
{ mode: "cashflow" | "ynab", periodEnd: "month-end" | <day 1-31>, buffer: number,
  flexibleCategories: string[], creditLimits: [{ name, limit, accounts: string[] }],
  fixedPayments: [{ payee, amount, dayOfMonth, account, confirmed }] }

### Real data facts (2026-10-11/12, read)
- Accounts: Main -20,260; Second +14,417; Credit Limit +40,000; Leumi Cards -1,303; Max Card 0; 8400 - Cal +204; Tashlumim 0.
- Card debits from the bank: Leumi + Cal on the 2nd (since July 2026; before that the 10th); small ones on the 10th and 15th.
- YNAB scheduled transactions: 0.
- Card limits from scrapers: only Max reports CreditLimit (read in israeli-bank-scrapers max.ts).

## Plan: reports + spending baseline (draft v1, 2026-10-12, waiting for approval)

### A. Baseline and pace (engine)
- Two jobs, two inputs (revised 2026-10-12 after user challenge):
  - Describe the month (normal-month total, pace, reports): ALL real spending = outflows except transfers without a category (on-budget to on-budget). Rent, loans, installments, cash withdrawals, and uncategorized stay in.
  - Predict the rest of the month (the subtraction in left-to-spend): the same, minus what left-to-spend already counts (YNAB-scheduled payees on the same account, installment charges), so nothing counts twice.
  - Categories that are mostly one fixed payment (e.g. rent) show paid / not paid instead of a pace percentage.
- Baseline per category and in total: the median of the last 6 full months.
- Pace: compare spending so far this month with the median spending up to the same day in those 6 months (not a straight line, because spending is lumpy).
- Expected spending for the rest of the month = median month total - median spending up to today's day. Shown as a new line in the cash-flow number ("Expected normal spending, rest of month"), with a setting to turn it off.
- Output: total and per-category status (on pace / over pace by X%), top 3 over pace.

### B. Reports (same content in the app and by email)
- Weekly (default Sunday morning): left to spend (both modes), pace and top 3 categories over pace, scheduled payments in the next 7 days, credit unused per group, items needing attention (schedule suggestions, uncategorized transactions), data date (last import).
- Start of month (1st): last month in one line; this month's capacity; installments and scheduled payments this month; next 3 months of obligations.
- End of month (last day): actual vs. plan per category (spent vs. YNAB assigned and vs. baseline), total, biggest differences.
- In the app: a Reports sub-tab shows the latest report of each type, with "Send now by email".
- Email: Gmail SMTP (existing nodemailer code; smtp.gmail.com:465 is reachable through NetFree). Needs GMAIL_SMTP_USER, GMAIL_SMTP_APP_PASSWORD (Google app password), recipient; entered by the user in the app and stored in Windows Credential Manager.

### C. Scheduling
- One Windows Task Scheduler task runs `npm run report:send` daily at a set hour; the script decides which reports are due and remembers the last send per type (state file), so a missed day (PC off) sends once later ("run when available").
- Creating the task changes Windows configuration: only with the user's yes.
- The report uses YNAB data as of the last bank import; it shows that date.

### Open decisions
1. Delivery: email + in-app, or in-app only first?
2. Weekly day and hour.
3. Subtract expected normal spending in the cash-flow number by default?
4. Baseline window: 6 months?
5. Create the Windows scheduled task (after the build)?

## Next steps

1. Configure Dough: spending account, income, bills.
2. Check the daily budget and the cash-flow forecast against the known card debits.
3. Decide: fork Dough, build in this repo, or run Dough unchanged with a small module.
4. Decide how Dough should treat card balances (see "How Dough models obligations").

## Log

- 2026-10-06: Read the ChatGPT conversation. Compared it with this repo and with Dough and Maronato.
- 2026-10-06: Cloned Dough, installed it, fixed the Node-API problem with Node 24, built it, tested it with demo data.
- 2026-10-06: Shared the YNAB token from Windows Credential Manager. Fixed the PowerShell 5 quote problem and the NetFree certificate problem. Connected "Lipson Budget" and ran the first sync.
- 2026-10-06: Read how Dough models cards and obligations. Replaced the currency with ₪ in Dough, rebuilt, and checked the dashboard. User decided to keep "Credit Limit" in the available balance.
- 2026-10-06: Dough already syncs and counts card purchases as spending, and skips card-payment transfers. Changed Dough so credit-card balances count in "Available". Open issue: Dough's `isTransfer()` treats every "Uncategorized" transaction as a transfer, so uncategorized cash withdrawals (משיכת מזומן) do not count as spending.
- 2026-10-11: User confirmed the plan: build the core engine in this repo; stop changing Dough. Next: draft the safe-spending formula.
- 2026-10-11: New feature requested: a "Categorize" tab that suggests categories for uncategorized YNAB transactions from the last month, with an evidence note, accept/reject, and more than one option only when the evidence is split. Not started.
- 2026-10-11: LLM choice: opencode CLI 1.18.29 (`C:\ProgramData\chocolatey\bin\opencode.exe`) with model `opencode/big-pickle`. Test: `opencode run -m opencode/big-pickle --pure --format json "<prompt>"` returns JSON events in 14-23 s. The `websearch` tool fails with HTTP 418 from `mcp.exa.ai` (cause not verified; NetFree is possible). The `webfetch` tool works. Do not use `--auto`. The default agent can write files, so run it in an empty folder or with a restricted agent.
- 2026-10-11: Categorize feature decisions: YNAB already fills in payees with a consistent history, so the list holds mixed-history and new payees. Do not send amounts to Big Pickle.
- 2026-10-11: Memo formats found (from Dough's synced copy of YNAB transactions):
  - Current (this repo's `buildMemo`): JSON with `chargeDate`, `transactionDate`, `source`, `installment`, `originalAmount`, `originalCurrency`, `type`, `category` (bank merchant sector, card transactions only, e.g. "מזון ומשקאות", "שירותי תקשורת"), `bankMemo` (bank text).
  - Mid-2025: JSON with `notes` (same bank text) and `balance`.
  - Older import: JSON with `Secret Text` (same bank text), `אסמכתא`, `Account Number`, `balance`.
  - Plain text typed by hand (e.g. "car cleaning"), and "Entered automatically by YNAB" on reconciliation rows.
  - Bank text patterns (Leumi): "העברה אל: <name> <bank-branch-account> <purpose>", "העברה מאת: <name> <account> <purpose>", "נמשך מכרטיס המסתיים ב-XXXX במכשיר <ATM location>", "מתאריך <date> בכרטיס המסתיים ב-XXXX ב-<merchant>".
  - Correction: an earlier answer said `buildMemo` does not keep the bank category. It does (`memo.category`).
- 2026-10-11: Built the Categorize tab (not committed yet).
  - Backend: `src/ynab/categorize.ts` (pure logic + tests in `categorize.test.ts`), `src/ynab/categorize-service.ts` (YNAB, Serper, opencode), `src/server/routes/categorize.ts` (`/api/categorize`). GUI: `gui/src/pages/CategorizePage.tsx`.
  - Evidence order: payee/counterparty history (12 months) → card sector history → Big Pickle (name, sector, hand-typed memo, Serper results). Transfers to people and cash withdrawals never go to the LLM. Amounts and words of 5+ characters with digits never go to the LLM.
  - Matching key removes per-charge codes ("AMAZON MKTPL 5X3QQ2A" → "amazon mktpl").
  - Accept → YNAB PATCH category. Reject → `~/.config/israeli-bank-ynab-transformer/categorize-rejections.json`.
  - "Accept all strong history" only takes single history suggestions with share ≥ 0.8.
  - Manual checks: `npx tsx scripts/try-categorize.ts` (real data, read-only), `npx tsx scripts/try-llm.ts` (made-up payees).
- 2026-10-11: opencode findings:
  - Big Pickle free tier returns 403 "free tier can only be used from within OpenCode" when the folder has an opencode.json that restricts permissions. So the model keeps its tools. Mitigation: empty temp folder, prompt forbids tools, any answer with a tool event is discarded.
  - opencode picks its project folder from the PWD environment variable, not the process cwd. Without `PWD` set, a test made it write into this repo (test file removed).
  - `-f` consumes every later argument as a file name.
  - With an open stdin pipe, `opencode run` waits ~5 minutes before it starts. Use `stdio: ["ignore", ...]`. Answer time then: ~5 s.
  - Killing the Chocolatey shim does not kill opencode; use `taskkill /T /F`.
- 2026-10-11: NetFree blocks: DuckDuckGo, Tavily, Exa, Google Custom Search API (all HTTP 418). Bing redirects to Google. Allowed: google.com pages, Serper (google.serper.dev), Brave Search API, Google Places API, he.wikipedia.org, data.gov.il. User chose Serper. User asked to call Serper's playground endpoints without a key; declined (bypasses their auth). The Serper key goes into the Categorize tab and is stored in Windows Credential Manager as SERPER_API_KEY.
- 2026-10-11: Real data (last 31 days): 23 uncategorized, 21 with history suggestions, 2 transfers to people with no suggestion, 0 left for the LLM.
- 2026-10-11: Fixed transfer matching. Transfers are now identified by direction + bank-branch-account with leading zeros removed (e.g. "account out 12-695-479415"), not by name. Reasons: standing orders use "העברה ל:" (not "אל:"), name order changes ("חיים ורשלייסר" / "ורשלייסר חיים דב"), and zeros differ ("00479415" / "000479415"). Also reads the older non-JSON memo format `{ chargeDate: '…', notes: '…' }`.
- 2026-10-11: History loading today: each Reload makes 3 YNAB calls (uncategorized last 31 days, all transactions last 12 months, categories). Not cached. Candidate: local cache with YNAB delta requests (`last_knowledge_of_server`), shared with the core engine later.
- 2026-10-11: Built the YNAB transaction cache with delta sync (`src/ynab/transaction-cache.ts`). File: `~/.config/israeli-bank-ynab-transformer/ynab-cache/<budgetId>.json` (`serverKnowledge` + all transactions, ~1-2 MB). First load: `?since_date=2000-01-01` (without since_date YNAB returns only the last year: 1,358 vs 2,173 transactions). Later loads: `?last_knowledge_of_server=N`, merged by id, deleted ones removed. The Categorize tab now reads uncategorized and history from the cache (2 YNAB calls per Reload: transaction delta + categories). Load time: ~4 s first, ~2 s after.
- 2026-10-11: Open question to user: transfer matching by account only loses the name (joint accounts, people with 2 accounts, memos without a number). Proposed: match by account OR order-free name, note says which matched; optionally rank mixed options by local amount similarity (amounts stay local).
- 2026-10-11: Transfer matching is now account OR order-free name (all words of the shorter name in the longer, minimum 2 words), with a note that says what matched. Split history options are ranked by past uses with exactly the same amount (local only).
- 2026-10-11: INCIDENT: while testing the days field in the shared browser pane, a missed click left focus on the page, and the page-wide Enter shortcut accepted a suggestion. 1 real YNAB write: 5 Oct 2026 משיכת מזומן −₪807.90 → 🛒 Groceries (sent twice, same value). User checked and kept it. Fix: shortcuts only act on a focused card; repeated accepts of one id are ignored. Rule for future browser tests: block /api/categorize/accept and /reject in the page (fetch override) and use a separate tab.
- 2026-10-11: Days field: edited in place in the title; applies on Enter/blur; Esc or invalid (not 1-365) reverts; remembered in localStorage (`categorize-days`). Days change calls `/api/categorize?days=N&sync=0`, which reuses the server's in-memory history (no YNAB call); accepts update that copy.
- 2026-10-11: Performance fixes:
  - `hydrateEnvWithStoredBankCredentials` started PowerShell + compiled C# on every request (~1.5 s, spawnSync blocks the server). Now at most every 5 minutes; this app's own saves/deletes force a re-read. Accounts tab: up to 10 s → 0.2 s.
  - History index copied arrays on each add (quadratic): buildItems 1.2 s → 0.1 s.
  - React dev mode ran the first load twice (2 YNAB syncs); guarded with a ref.
  - Result: Categorize first open/Reload ~1.6 s (server) / 0.5 s warm; days change 0.3 s.
- 2026-10-12: Drafted the safe-spending spec with the user (see "Safe-spending spec (draft v1)"). Waiting for approval before engine code.
- 2026-10-12: User approved the spec and confirmed Main Account is the overdrawn account. Built the engine on branch `safe-spending` (from `categorize-tab`).
- 2026-10-12: Change requested by the user: YNAB scheduled transactions are the fixed payments (the user started using them; rent ₪5,500 already scheduled). The engine suggests new scheduled transactions from history (monthly, same payee+account in 3 of last 4 months, amount within 25%, day within 5 days; no cash, transfers, or installments; not already covered by a schedule on the same account with amount within 25% and day within 5 days). The local "confirmed fixed payments" list was dropped; only ignored suggestions are stored locally.
- 2026-10-12: YNAB OpenAPI spec (read): an imported transaction with import_id is matched to an existing user-entered transaction "on the same account, with the same amount, and with a date +/-10 days". So scheduled amounts must be exact; suggestions flag amounts that varied. Scheduled create: POST /budgets/{id}/scheduled_transactions, frequency enum never..everyOtherYear, date in the future, at most 5 years ahead. YNAB now documents /plans/{plan_id} paths; /budgets still works.
- 2026-10-12: Engine files: `src/engine/safe-spending.ts` (+ `.test.ts`, 11 tests), `src/engine/safe-spending-service.ts`, `src/server/routes/spending.ts` (`GET /api/spending`, `PUT /settings`, `POST /scheduled`, `POST /ignore`), GUI `gui/src/pages/SpendingPage.tsx` (Spending tab), `scripts/try-spending.ts`. Settings: `~/.config/israeli-bank-ynab-transformer/safe-spending.json`.
- 2026-10-12: Real data today: cash-flow ₪33,059, YNAB categories ₪3,519 (Ready to Assign ₪32,688), overdraft unused ₪19,740 of ₪40,000, 13 suggested schedules. Card limits not set yet. Not committed yet.
- 2026-10-12: Spending tab navigation: 3 sub-tabs (Overview, Schedules with a count badge, Settings); Overview shows a "Review" banner when suggestions exist. Suggestions are compact one-line rows (name, amount, date, category, Create, Ignore) that expand to edit; Create uses the values on the line. Row: 32-42 px (was ~110 px). Not committed yet.
- 2026-10-12: Leumi scraper failing since 2026-10-05 ("net::ERR_ABORTED at https://www.leumi.co.il/he", "Navigation timeout of 30000 ms exceeded"; worked on 2026-10-06). Diagnosis (tested without credentials):
  - www.leumi.co.il/he: the "load" event never fires within 45 s in Chrome (NetFree 418 on doubleclick trackers; Radware bot manager validate.perfdrive.com serves hCaptcha to embedded rate widgets). The page itself is 200 and has the `.enter_account` link to https://hb2.bankleumi.co.il/H/Login.html.
  - hb2.bankleumi.co.il/H/Login.html: curl 200 in 0.5 s; headless Chrome gets NO response (45 s timeout, stays about:blank); a visible Chrome window loads it in ~6 s (redirect to /staticcontent/gate-keeper/he/...) with the full login form.
  - Fix (no bot-detection evasion): fork `israeli-bank-scrapers/src/scrapers/leumi.ts` goes straight to `${BASE_URL}/H/Login.html` with waitUntil "domcontentloaded" and waits for the form fields; this repo forces a visible browser for banks with `requiresVisibleBrowser` (Leumi) in `src/banks.ts` / `src/scraper.ts`. Fork rebuilt (`npm run build:js && npm run build:types`); this repo links to it (node_modules symlink).
  - Verified 2026-10-12: the user ran a real Leumi scrape from the app and it worked. Fork commit: `a165cec` on branch `fix/leumi-direct-login` in israeli-bank-scrapers.
- 2026-10-12: User merged both branches into master and saved the Serper key. Handoff replaced by `HANDOFF-financial-intelligence.md` (living snapshot, updated after every step; includes the full roadmap from the original conversation).
- 2026-10-12: Wrote the reports + baseline plan (see "Plan: reports + spending baseline"). Checked: Gmail SMTP reachable through NetFree (smtp.gmail.com:465 TLS ok); Gmail env vars not set; no Windows scheduled task exists.
- 2026-10-12: Plan decisions: (1) in-app reports only first, email later; (2) weekly report Sunday 10:00; (4) baseline 6 months, configurable; (5) create the Windows scheduled task after the build. (3) still open: subtract expected normal spending (rest of month) in the cash-flow number? Recommended yes, with a setting. Rough real numbers shown to the user: normal month ~25,600 variable, ~14,800 by day 11; October by day 11 only 4,246 (data probably not fully imported).
- 2026-10-12: Revised baseline inputs after the user asked if the excluded data is needed: keep all real spending for describing the month and for pace; exclude scheduled payments and installments only from the rest-of-month prediction; exclude only uncategorized transfers (on-budget to on-budget) everywhere.
- 2026-10-12: CORRECTION: headless Chrome is NOT blocked by hb2.bankleumi.co.il. Retests loaded the login form headless 3/3 times (1.3-4.7 s); curl with a HeadlessChrome User-Agent gets the same redirects as normal Chrome. The earlier 45 s "no response" was a one-off. The `requiresVisibleBrowser` rule for Leumi (commit 0a020f3) was reverted on request; the user will test a headless Leumi scrape.
- 2026-10-12: Merged upstream eshaham/israeli-bank-scrapers into the fork on branch `merge-upstream-2026-10` (fork commits 162f8dc merge, d39ed02 test, 270daec style, 67c02f9 forex dates). Only conflict: import block of src/scrapers/leumi/leumi.ts (upstream moved leumi.ts into src/scrapers/leumi/). New from upstream: Leumi foreign-currency accounts, Isracard and Visa Cal card balances, Mizrahi change-password fix. Fork jest: 20 suites pass (35 tests skipped, need credentials). Upstream's leumi-forex.ts used toISOString() (UTC); changed to toISOString(true) like the fork's other scrapers. Library rebuilt; this repo: tsc ok, 152 tests pass.
- 2026-10-12: Upstream's own Leumi login fix (inferred to fail here): it still opens www.leumi.co.il/he first with waitUntil "load", which did not finish in 45 s on this network (NetFree 418 on trackers, Radware hCaptcha in rate iframes); then it does goto /authenticate/logon plus waitForNavigation(networkidle2), the extra wait the fork removed in 864926f. Most upstream users are not behind NetFree (inferred), so their "load" event fires.
- 2026-10-12: Headless Leumi scrape (user) failed with "GENERIC - net::ERR_ABORTED at https://hb2.bankleumi.co.il/H/Login.html". Could not reproduce: 11/11 headless runs with the scraper's own LeumiScraper setup opened the login form (4-25 s; server response time varies 5-22 s). /H/Login.html -> 302 gate-keeper/ -> script moves to gate-keeper/he/. Fork commit eb2e567 on merge-upstream-2026-10: LeumiScraper.navigateTo ignores ERR_ABORTED for the login URL only; checkReadiness still requires the login form. Cause not confirmed.
- 2026-10-12: Built roadmap items 1 + 2 in a worktree (`../israeli-bank-ynab-transformer-reports`, branch `reports-baseline`), because another session was reverting a commit in the main checkout. Commits: dev-server ports via env (PORT / API_PORT), spending baseline + expected normal spending in cash-flow, reports (weekly / month-start / month-end, saved in config `reports/`, `npm run report:spending` for a daily task), Pace card + Reports sub-tab + 2 settings.
- 2026-10-12: Baseline findings on real data: pace must use the newest import date (data 3 days old made October look -73%); one-payment categories need "fixed" handling (rent showed -100%); small bases need a ₪200 minimum (Clothing +467% on ₪316); September had ₪9,971 uncategorized spending (cash), which made the two reports disagree until both used the same spending list. Normal month: ₪26,951. Cash-flow with expected spending: ₪21,815.
- 2026-10-12: Rebased onto master (other session had added 2 commits; only the notes log conflicted, both entries kept) and fast-forwarded master to `cb01830`. 169 tests pass. Created Windows task "IBYT spending reports": daily 10:00, StartWhenAvailable, 15-minute limit, runs `npm run report:spending` in the main checkout with NODE_EXTRA_CA_CERTS; log at `~/.config/israeli-bank-ynab-transformer/reports/last-run.log`. First run: result 0, "No report is due today." Worktree removed (needed the \?\ long-path prefix to delete node_modules).
- 2026-10-12: Verified by the user: headless Leumi scrapes work with fork commits eb2e567 (ignore ERR_ABORTED on the login URL) and this repo's 3b96480 (one retry for timeouts and net::ERR_ errors). Fork branch merge-upstream-2026-10 is not yet merged into the fork's master.

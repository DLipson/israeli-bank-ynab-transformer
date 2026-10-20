# Implementation plan: Home redesign

Status: 20 Oct 2026. Phases 0–13 are built on branch `home-redesign` (one commit each; see the notes log). Not pushed or merged.

## Sources: read these first

| Source | What it decides |
|---|---|
| `YNAB Spending Overview and Planning Assistant.md` (spec, local only, never commit) | What each number means, the rules, and the "Thresholds" table. If the spec and this plan disagree, the spec wins. Tell the user. |
| `docs/mockups/home-redesign.html` (open it in a browser) | How each screen looks and acts. Copy the layout, the behavior, and the wording. Do not copy its CSS: the app uses shadcn + Tailwind. Some numbers in it are samples (see the comment at its top). |
| This plan | The order of work, the files, the API types, and when each phase is done. |
| `docs/financial-intelligence-notes.md` | The history of decisions. Read only when something here is not clear. |

When you must decide something that none of these sources decides, stop and ask the user. Do not invent a rule or a number.

## How we work

1. Work in a sibling git worktree, one branch for each phase. Another session also works in this repo.
2. Test new work on ports 3002/5174 (`PORT`, `API_PORT`). Do not stop the servers on 3001/5173.
3. Engine code first, test first: write the failing test, then the code. Run `npm test`.
4. GUI changes: check in the browser pane, in a separate tab, with YNAB writes blocked.
5. Every YNAB write comes only from a user click. Confirm with the user before any write during tests.
6. Commit only when the user asks. Never commit the spec.
7. After each phase: update the handoff and the notes log.

## Traps

Read these before you write code. Each one has caused a wrong number or a wrong idea before.

1. **Milliunits.** YNAB amounts are milliunits: ₪1 = 1000. Outflows are negative in YNAB. `SpendItem.amount` is positive for spending. Keep milliunits in the engine and the API. Convert only for display.
2. **`chargeDate` has 2 formats** in the transaction memo: `dd/mm/yyyy` (old) and `yyyy-mm-dd` (new). Always parse it with the phase 0 helper.
3. **Installments:** the memo has `installment: "n/total"`. Payment 1 is a new purchase. Payment 2 or later is an older purchase. The next payment of a plan is usually already in the card balance. Do not count it again.
4. **Card cycles:** on this user's cards, each charge pays for all purchases since the previous charge (checked 20 Oct 2026). There is no "charged to the payment after" amount. Do not add one.
5. **Hebrew text.** Payee names are often Hebrew. Put `dir="auto"` on every element that shows a payee or a memo text.
6. **Generic payee names.** A payee can be generic, for example "הוראת קבע" or "משכורת". The real counterparty can be in the bank text in the memo (`parseBankText()` in `safe-spending.ts`).
7. **Transfers.** A transfer between budget accounts has `transfer_account_id` and no category. It is not spending and not income. A card payment from the bank is a transfer.
8. **Data date.** Pace uses the newest imported transaction (`dataAsOf()`), not today. Old bank data otherwise makes everything look under pace.
9. **Duplicate schedules.** Some YNAB schedules are duplicates (found 20 Oct on Leumi Cards). Do not hide this in code. It is the user's data.
10. **YNAB writes.** Categorize, schedule creation, and the Undo of both write to YNAB. Only from a user click. Never in a test against the real budget.
11. **The other session.** Another session works on the scraper (Leumi). Do not change `src/scraper*.ts` or the fork in this work.
12. **Old settings files.** `safe-spending.json` already exists on the user's machine. New keys need defaults. Removed keys must not cause an error.

## What exists today (read in the code)

| Area | File | What it does now |
|---|---|---|
| All Home data | `src/engine/safe-spending-service.ts` → `getSpending()` | Loads accounts, current month, schedules, and transactions (local cache). Builds one `SpendingData` object. |
| Spent vs income | `src/engine/monthly-flow.ts` | `expenses`, `income` (with the last 7 days of the previous month), `planActivity` |
| Spending list | `src/engine/baseline.ts` → `spendItems()` | One item for each category part. Leaves out transfers without a category and Ready to Assign. Refunds are negative items. |
| Pace and normal | `baseline.ts` → `baseline()`, `pace()`, `expectedRest()`, `isFixed()` | Median of N months, for **every** category |
| Available until payday | `safe-spending.ts` → `leftCashflow()` | Cash + card balances − schedules to the period end − expected spending − buffer |
| Schedules | `safe-spending.ts` → `scheduledOutflows()`, `suggestScheduled()` | |
| Installments | `safe-spending.ts` → `installmentPlans()` | From memo `installment: "n/total"` and `chargeDate` |
| Credit | `safe-spending.ts` → `creditExposure()` | Groups from `settings.creditLimits`, plus an overdraft group |
| Unusual flags | `src/engine/anomalies.ts` → `detectAnomalies()` | Unusual charge, new payee, duplicate, category spike, price increase |
| Settings | `safe-spending.json` → `Settings` | `periodEnd`, `buffer`, `flexibleCategoryIds`, `creditLimits`, `overdraft`, `baselineMonths`, `subtractExpected`, dismissed and ignored lists |
| Reports | `src/engine/reports.ts`, `reports-service.ts` | Weekly, month-start, month-end. A daily Windows task runs them. |
| Scrape | `gui/src/pages/ScrapePage.tsx`, `ScrapeRunProvider.tsx`, `routes/scrape.ts` (SSE) | Settings form → progress → results. Events: `progress`, `account-done`, `done`, `error`. |
| Past runs | `src/history.ts`, `HistoryPage.tsx` | `RunSummary` with `accounts[].success`, `error`, `transactionCount` |
| Shell | `gui/src/App.tsx` | Tabs Home / Scrape / Review / Reports / Setup |

## Phase 0: data fixes before anything else

1. **User, in YNAB:** delete the scheduled transactions on Leumi Cards, and the duplicate ₪30 איחוד הצלה of 20 Oct on Leumi Cards.
2. **`chargeDate` helper.** Add `parseChargeDate(memo): string | null` that returns ISO for both formats. Use it in `installmentPlans()` and everywhere else that reads `chargeDate`.
3. **Income at month end (decided 20 Oct):** income received in the last 7 days of a month counts toward the next month only. `monthlyFlowFor()` already adds the last 7 days of the previous month; also leave the last 7 days of this month out of this month.

**Done when:**
- A test passes for `parseChargeDate()` with `"10/06/2025"`, `"2026-11-02"`, a missing value, and a bad value.
- A test passes for `installmentPlans()` with an old-format memo.
- A test shows that one income transaction on the 28th counts in the next month and not in its own month.
- `npm test` passes.

## Phase 1: engine, spent vs income

Goal: the Home main number follows the spec rules.

1. Test each rule in the spec's "Spending and income rules" against `spendItems()`:
   - card payments and transfers between own accounts: already left out (transfer with no category)
   - refunds reduce spending: already true (negative item)
   - installments count as each charge: already true (each charge is one transaction)
2. New: **transfers to savings**, as their own line. Transfers this month from a checking or cash account to a savings account. Return them in `savedThisMonth`.
3. New: **drill-down lists.** Return the income transactions and the spending transactions behind each total (`TxRef`).
4. **One-time income (decided 20 Oct: from history).** Use the thresholds in the spec. The mark is only a label in the drill-down. It does not change the totals. Test it with made-up transactions, including a generic payee name (trap 6). The user checks the labels later in the app.
5. Keep `planActivity` in the data for Reports. Do not show it on Home.

**Done when:**
- Tests pass for each rule in step 1, for savings transfers, and for one-time income (a regular salary, a gift from a new payer, a bonus from the regular payer).
- For 19 Oct 2026 on the real data, spent is ₪19,796 and income counted is ₪18,096, or the difference is explained to the user.

## Phase 2: engine, available until payday

1. **Settings changes** (trap 12):
   - `essentialCategoryIds: string[]` (default `[]`). A new, separate key. Do not migrate `flexibleCategoryIds` into it: that key stays unchanged for the hidden YNAB-categories mode, and today it holds Clothing/Shoes and Groceries, which is not the essentials list (decided 20 Oct). The user chooses the essentials in Settings.
   - `essentialsOverride: { period: string; amounts: Record<string, number> } | null`. `period` is the period end date. An edit applies to that period only; a new period ignores it. A category that is not in `amounts` uses its calculated amount, not 0 (decided 20 Oct).
   - `cardWarningLevel: number` (default `1_000_000` milliunits = ₪1,000).
   - Ignore `overdraft` and `subtractExpected` if present; do not write them again.
   - **Payday replaces the period end (decided 20 Oct).** New key `payday: "month-start" | number` (a day of the month, 1–31). The period ends the day before payday. Migrate the old `periodEnd` once: `"month-end"` → `payday: "month-start"` (the period still ends on the last day of the month); a number N → `payday: N + 1`; N = 31 → `"month-start"`; N = 28–30 → N + 1, clamped to the last day in short months (payday 30 in February is 28 Feb). Keep `periodEndDate()` returning the inclusive last day, now computed from `payday`. The user has `periodEnd: "month-end"` today.
2. `leftCashflow()` lines, in this order and with these keys: `cash`, `cards`, `bills`, `essentials`, `buffer`.
   - `essentials`: for each essential category, YNAB assigned − spent this month (minimum 0) if assigned > 0; else `expectedRest()` for that category only. Use the override if its `period` is this period end.
   - No essentials chosen: the line is 0, and `essentialsNotChosen` is true.
   - `bills` (decided 20 Oct): count a scheduled outflow only when all 3 are true:
     1. It is not a transfer. Add `transfer_account_id` to the `ScheduledTransaction` type (YNAB returns it) and skip every schedule that has one. A scheduled card payment from the bank only moves money between own accounts, and the card balance is already subtracted.
     2. Its date is from today to the period end (as today).
     3. It is not already in an account balance: skip it when the same account has a transaction with a similar payee (`similarPayee()`), an amount within 25%, and a date within 5 days of the schedule date. Reuse the matcher behind `predictItems()` in `baseline.ts`. This covers a bill that the card company charged and the scraper imported before the schedule date.
   - Schedules on card accounts stay in `bills` when the 3 rules pass: they are card charges that are not in the card balance yet.
3. Each line returns its items (`AvailableItem[]`).
4. `creditExposure()`: remove the overdraft group.

**Done when:**
- Tests pass for: no essentials chosen; an assigned category; an unassigned category (falls back to the normal); an override for this period; an override for an old period (ignored); an old settings file with `overdraft`.
- The total equals the sum of the line amounts in every test.

## Phase 3: engine, category comparisons

1. Category type, in this order: `fixed` (spec threshold "Fixed category"), `essential` (in the setting), `occasional` (all others).
2. Essential: `pace()` as today.
3. Occasional: this month's total vs the average per month over the last 12 full months. New function `monthAverage(items, categoryId, today, 12)`.
4. Fixed: "paid / due" as today, and this month vs the normal month.
5. `reasons`: the categories with a meaningful difference (spec thresholds), largest shekel difference first, at most 5, each with its transactions.

**Done when:** tests pass for each type, for the "at most 5" rule, and for a category that is both scheduled and in the essentials list (it is `fixed`).

## Phase 4: engine, cards

For each card group in `settings.creditLimits`:

1. `headroom = limit − card balance − future installments` (as in `creditExposure()`).
2. `state`: `over` if headroom < 0, `low` if headroom < `cardWarningLevel`, `ok` otherwise, `no-limit` if the group has no limit.
3. **Next payment** = the card balance, split into `olderInstallments` (payment 2 or later) and `newPurchases` (the rest). Next charge date: the newest `chargeDate` in the balance.
4. **Future installments by month**: from `installmentPlans()`, one entry per month with the plans in it and the payments left.

**Done when:** tests pass with real-shaped memos for Isracard and Cal (both formats of `chargeDate`), and `newPurchases + olderInstallments = card balance` in every test.

## Phase 5: API

1. Add the fields below to the object that `getSpending()` returns, and the same types to `gui/src/api/client.ts`. Keep the existing fields: the old GUI must still work until phase 7.
2. Settings route (`routes/spending.ts`): validate the new keys. Reject a negative amount, an unknown category id, and an override with no `period`.
3. Endpoints for Inbox Undo:
   - `POST /api/spending/anomalies/:id/restore`: remove the id from `dismissedAnomalies`
   - `POST /api/spending/suggestions/:id/restore`: remove the id from `ignoredSuggestions`
   - `DELETE /api/spending/scheduled/:id`: delete a scheduled transaction that the app created (YNAB write). The server saves the id of each schedule that it creates in `settings.createdScheduleIds`, and refuses to delete any other id. This keeps a schedule that the user made in YNAB safe.
   - Categorize undo: the client calls the existing accept endpoint with the previous category id (YNAB write).
4. **Undo scope (decided 20 Oct):** the Undo list is in the browser memory of the open Inbox only. It holds every action since the Inbox opened, newest first. A page reload or an app restart clears it. No server-side session.

### API types

All amounts are milliunits. "Positive" means a positive number for money out (spending) or money in (income), as noted.

```ts
/** One transaction behind a figure. */
interface TxRef {
  id: string;
  date: string;          // yyyy-mm-dd
  payee: string;         // show with dir="auto"
  account: string;
  category: string | null;
  amount: number;        // signed, as in YNAB
}

type CategoryType = "essential" | "occasional" | "fixed";

interface CategoryComparison {
  categoryId: string;
  name: string;
  type: CategoryType;
  thisMonth: number;     // positive
  compareTo: number;     // positive
  compareLabel: "normal by this day" | "12-month average" | "normal month";
  difference: number;    // thisMonth − compareTo
  items: TxRef[];
}

interface SpentVsIncome {
  month: string;         // yyyy-mm
  spent: number;         // positive
  income: number;        // positive, income counted
  difference: number;    // income − spent; negative = spent more than earned
  daysLeft: number;      // days left in the month
  incomeParts: Array<{
    label: string;       // "Salary, 24–30 Sept (counts toward October)" or "Received in October"
    amount: number;
    items: Array<TxRef & { oneTime: boolean }>;
  }>;
  savedThisMonth: { amount: number; items: TxRef[] };
  reasons: CategoryComparison[];          // at most 5
  uncategorized: { amount: number; count: number };
}

interface AvailableItem {
  label: string;
  amount: number;        // signed: negative lowers the total
  date?: string;
  txId?: string;
  categoryId?: string;
  assigned?: number;     // essentials only
  normal?: number;       // essentials only
}

interface AvailableUntilPayday {
  periodEnd: string;     // yyyy-mm-dd
  total: number;         // signed
  lines: Array<{
    key: "cash" | "cards" | "bills" | "essentials" | "buffer";
    label: string;
    amount: number;      // signed
    items: AvailableItem[];
  }>;
  essentialsNotChosen: boolean;
  essentialsOverridden: boolean;
}

interface CardGroup {
  name: string;
  limit: number | null;
  balance: number;              // positive, owed now
  futureInstallments: number;   // positive
  headroom: number | null;      // limit − balance − futureInstallments
  state: "ok" | "low" | "over" | "no-limit";
  nextPayment: {
    date: string | null;        // newest chargeDate in the balance
    total: number;              // = balance
    newPurchases: { amount: number; items: TxRef[] };
    olderInstallments: { amount: number; items: Array<TxRef & { payment: string }> }; // "7 of 12"
  };
  futureByMonth: Array<{
    month: string;              // yyyy-mm
    amount: number;
    plans: Array<{ payee: string; account: string; payment: number; paymentsLeft: number }>;
  }>;
}

interface WatchItem {
  kind: "card-low" | "card-over" | "essential-over-pace";
  label: string;                // "Cal 8400: ₪107 over the limit"
  target: { tab: "cards"; group: string } | { tab: "home"; categoryId: string };
}

/** New fields on SpendingData. */
interface SpendingDataAdditions {
  spentVsIncome: SpentVsIncome;
  available: AvailableUntilPayday;
  cards: CardGroup[];
  watch: WatchItem[];
}

/** New fields on Settings. */
interface SettingsAdditions {
  payday: "month-start" | number;  // replaces periodEnd; the period ends the day before
  essentialCategoryIds: string[];
  essentialsOverride: { period: string; amounts: Record<string, number> } | null;
  cardWarningLevel: number;
  createdScheduleIds: string[];   // schedules the app created; only these can be deleted by Undo
}
```

**Done when:** `GET /api/spending` returns the new fields on the real data, the old Home page still loads, and route tests cover the validation and the 3 new endpoints (with the YNAB call mocked).

## Phase 6: GUI shell

1. Check first that `ScrapeRunProvider` can start a run from outside the Scrape page with the saved options. If not, move the start logic into the provider.
2. `App.tsx`: tabs **Home · Inbox · Cards · Scrape**, and a gear icon for Settings. Remove Review, Reports, and Setup as tabs. Their pages stay reachable (Inbox, Settings, and the report link).
3. **Update chip** at the top right, as in the mockup: time since `lastScrapedAt`; orange at 3+ days; tap starts a scrape with the saved options; "Updating 2 of 5" while it runs; then "Updated just now" or "Max failed" (tap opens Scrape).

**Done when:** each tab opens; the chip starts a run and shows its progress, as in the mockup (with the scrape request blocked in the test tab).

## Phase 7: Home

1. Spent vs income card: numbers, bar (grey up to income, red past it), "₪X more/less than you earned · N days left", drill-down (income parts, then "What pushed you over", then "Not categorized yet" with a link to Inbox), and a link to last month's report.
2. Available until payday card: total and its 5 lines; each line opens its items; essentials editable in place (saves `essentialsOverride`); buffer editable in place (saves the setting); "Choose your everyday essentials" when none are chosen.
3. Things to watch: shown only when `watch` has items.
4. Hide the YNAB-categories mode: keep `leftYnab()` and its data, remove only the switch from the UI. Remove the pace badge, the monthly actuals card, the summaries, and the footnotes.
5. Show the last saved numbers at once, then refresh (today the page waits about 10 s).

**Done when:** Home matches the mockup's Home screen at 680 px and at 375 px wide, in light mode and dark mode; every row with an arrow opens; the browser console has no errors.

## Phase 8: Inbox

1. One queue in this order: unusual, categorize, schedules. Reuse the data from `anomalies`, `getCategorizeList()`, and `suggestions`.
2. One card at a time, 2 buttons, progress bar, Undo (phase 5 endpoints), and "All caught up".
3. Keep the Categorize evidence text ("You used Groceries for this payee 38 times").
4. "Choose another" opens the category list from the current Categorize page.

**Done when:** each item type works, Undo restores the last item, and the tab label shows the number left, as in the mockup. Test YNAB writes only with the user's OK.

## Phase 9: Cards

1. One row for each card group: headroom bar (grey, orange, red) and "₪X left of ₪Y".
2. Tap a group: next payment (new purchases, older installments), future installments by month, each with its transactions.
3. Coming months: bills and installments for each month, with the items.

**Done when:** Cards matches the mockup's Cards screen; the colors change at the warning level and at 0.

## Phase 10: Scrape tab

1. Account rows first: checkbox, name, type, last update from history, last failure.
2. "From" date: last successful update for the selected accounts − 3 days. Convert to `daysBack` for the existing request. "Change" lets the user pick a date.
3. One "Update N accounts" button. Options folded and saved (the existing `ScrapeSettings` fields).
4. Live steps on each row from the SSE events. Retry one account = a new run with only that account.
5. Result: one summary line and 3 actions (Categorize N new → Inbox, See transactions, Log and CSV).
6. Past updates under it, from `getRuns()`, one OK/failed mark per account.

**Done when:** the Scrape screen matches the mockup; `ScrapePage.test.tsx` passes (updated to the new layout); every option from the old form still exists under "Options".

## Phase 11: Settings

1. One page behind the gear, with the labels and help lines from the spec's Settings table.
2. Links: bank accounts and logins (`AccountsPage`), YNAB import (`YnabPage`), Reconcile (`ReconcilePage`).

**Done when:** each setting saves and reloads; changing the payday, the buffer, or the warning level changes Home and Cards at once.

## Phase 12: Monthly report

1. One report at the start of the month: income vs spending, a 6-month chart, the count of months within income, income − fixed, last month by category, this month's calculation and gaps.
2. Remove the weekly and month-end reports. Change the daily Windows task: it makes only the monthly report.
3. Old saved reports stay readable.
4. Reports open from a link on Home, under the main card. There is no Reports tab.

**Done when:** `npm run report:spending` makes the monthly report; an old saved report still opens; the Home link opens the newest report.

## Phase 13: Treat as refund

Goal: an uncategorized positive transaction that counts as income can become a refund, by the user's click only.

1. On Home, in the spent-vs-income drill-down, each uncategorized positive income item has a small "Treat as refund" action.
2. The action opens a list of recent purchases (outflows in the last 90 days, newest first, with a search box). The user picks one purchase.
3. On confirm: set the positive transaction's YNAB category to the category of the picked purchase (YNAB write, only on this click). Then store `{ refundTxId, purchaseTxId }` in local settings (`refundLinks`). A purchase with a split or no category cannot be picked.
4. After the write, the transaction is a refund: it is a negative spending item, not income (existing rules).
5. The drill-down shows the link: "Refund of <payee>, <date>".

**Done when:** an engine/route test (YNAB call mocked) proves the category update and the saved link; the income total drops and spent drops by the amount in a test; the action is visible in the drill-down in the browser with YNAB writes blocked. Live write only with the user's OK.

## Order and dependencies

```
Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 9 → 11
                              ↘ 8 (needs 5)
                              ↘ 10 (needs 6)
                                  12 → 13
```

Phases 1–4 are engine only and can be tested without the GUI. Phase 7 (Home) is the first visible result.

## Decisions from the user

Answered 20 Oct: one-time income comes from history (phase 1, step 4); month-end income counts toward the next month only (phase 0, step 3); YNAB-categories mode stays in the code but is hidden (phase 7); reports open from a link on Home (phase 12); Things to watch has no memory: an item shows while it is true.

Answered later (20 Oct):
- Income in the drill-down is grouped by payer. Each transaction shows its date and its one-time label.
- The spent-vs-income drill-down includes the full list of spending transactions.
- Transfers to savings count from any source account.
- An uncategorized positive transaction counts as income. "Treat as refund" (phase 13) can turn it into a refund.
- Bills still to come: skip scheduled transfers (`transfer_account_id`), keep only dates from today to the period end, and skip a schedule already matched by a transaction on the same account (similar payee, amount within 25%, date within 5 days).
- Inbox Undo lives in browser memory only. The server deletes only schedule ids that it saved in `settings.createdScheduleIds`.
- Essentials override: a category missing from the override uses its calculated amount.
- `essentialCategoryIds` starts empty. `flexibleCategoryIds` is not migrated and stays for the hidden YNAB-categories mode.
- `payday` replaces `periodEnd`. The period ends the day before payday. Migration: `"month-end"` → `"month-start"`; N → N + 1; N = 31 → `"month-start"`; N = 28–30 → N + 1, clamped in short months.
- Duplicate schedules: one posted transaction clears only one schedule. The duplicate stays visible.

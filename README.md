# Israeli Bank YNAB Transformer

Scrape Israeli bank and credit card transactions and export clean, YNAB-ready CSVs via a GUI or CLI.  
Includes reconciliation tools, detailed audit logs, and Hebrew transaction support.

## What This Does

- Scrapes supported Israeli banks/credit cards (via `israeli-bank-scrapers`)
- Transforms transactions into YNAB CSV format
- Preserves metadata in the memo field as JSON
- Handles Hebrew column headers and formats
- Provides GUI workflow for scrape → review → export
- Reconciles bank CSVs against scraper output
- Previews YNAB category availability reports for selected categories
- Sends test and scheduled category-availability emails

## Supported Banks/Cards

Defined in `src/banks.ts`:

- Leumi
- Hapoalim
- Discount
- Mizrahi
- Max
- Visa Cal
- Isracard
- Amex
- Otsar Hahayal
- Mercantile

## Prerequisites

- Node.js `>= 22.12.0`
- Local clone of `israeli-bank-scrapers` with timezone modifications (see below)

## Setup

1. Clone and build the modified scrapers:

   ```bash
   cd ~/Dev
   git clone https://github.com/eshaham/israeli-bank-scrapers.git
   cd israeli-bank-scrapers

   # Apply timezone fixes (see "Timezone Modification" below)

   npm install
   npm run build
   ```

2. Clone this repo and install deps:

   ```bash
   cd ~/Dev
   git clone <this-repo-url> israeli-bank-ynab-transformer
   cd israeli-bank-ynab-transformer
   npm install
   ```

3. Configure credentials:

   ```bash
   mkdir -p ~/.config/israeli-bank-ynab-transformer
   cp .env.example ~/.config/israeli-bank-ynab-transformer/.env
   # Edit ~/.config/israeli-bank-ynab-transformer/.env for non-secret settings (OUTPUT_DIR, YNAB_*).
   ```

   On Windows, bank credentials saved from the GUI are stored in Windows Credential Manager.

## Configuration

Only configure the banks you use. Others can remain empty.
On Windows, bank credentials can be managed in the GUI and are stored in Windows Credential Manager.

```env
# Leumi Bank
LEUMI_USERNAME=
LEUMI_PASSWORD=

# Hapoalim Bank
HAPOALIM_USERCODE=
HAPOALIM_PASSWORD=

# Discount Bank
DISCOUNT_ID=
DISCOUNT_PASSWORD=
DISCOUNT_NUM=

# Mizrahi Bank
MIZRAHI_USERNAME=
MIZRAHI_PASSWORD=

# Max (Leumi Card)
MAX_USERNAME=
MAX_PASSWORD=

# Visa Cal
VISACAL_USERNAME=
VISACAL_PASSWORD=

# Isracard
ISRACARD_ID=
ISRACARD_CARD6DIGITS=
ISRACARD_PASSWORD=

# Amex
AMEX_ID=
AMEX_CARD6DIGITS=
AMEX_PASSWORD=

# Otsar Hahayal
OTSARHAHAYAL_USERNAME=
OTSARHAHAYAL_PASSWORD=

# Mercantile
MERCANTILE_ID=
MERCANTILE_PASSWORD=
MERCANTILE_NUM=

# Output directory (optional, defaults to ./output)
OUTPUT_DIR=

# YNAB report preview (required for Report tab)
YNAB_API_TOKEN=
# Optional override (default: ~/.config/israeli-bank-ynab-transformer/category-report.json)
YNAB_CATEGORY_REPORT_CONFIG=
YNAB_REPORT_RECIPIENT_EMAIL=
GMAIL_SMTP_USER=
GMAIL_SMTP_APP_PASSWORD=
YNAB_REPORT_TIMEZONE=Asia/Jerusalem
YNAB_REPORT_SEND_HOUR=7
```

Accounts are enabled automatically when all required credentials are present (from Windows Credential Manager on Windows, or environment variables).

For category report preview:

1. Set `YNAB_API_TOKEN` in `~/.config/israeli-bank-ynab-transformer/.env`.
2. Copy and edit report config at `~/.config/israeli-bank-ynab-transformer/category-report.json`.
3. Optional: keep using repo-local `config/category-report.json` by setting `YNAB_CATEGORY_REPORT_CONFIG`.
4. Set `YNAB_REPORT_RECIPIENT_EMAIL`, `GMAIL_SMTP_USER`, and `GMAIL_SMTP_APP_PASSWORD`.

## Quick Start (GUI)

```bash
npm run dev:all
```

This starts:

- API server: `http://localhost:3001`
- GUI: `http://localhost:5173` (Vite default)

GUI features:

- Configure credentials per bank
- Select accounts to scrape
- Set days back, split output, show browser
- Enable detailed logging with limit
- Cancel scrape
- Review transactions and skipped items
- Export CSV + open output folder
- Reconcile CSVs in the UI
- Preview category availability report in the UI
- Send test category-availability email from the Report tab

## CLI Usage

Entry point: `src/index.ts`  
Binary name: `israeli-bank-ynab`

### Scrape

```bash
npm run scrape -- --days-back 60 --output ./output --split --show-browser
```

Options:

- `--days-back <n>` (default 60)
- `--output <dir>` (default `./output`)
- `--split` (one CSV per account)
- `--show-browser`
- `--dry-run` (no files written)

### List Accounts

```bash
npm run dev -- list-accounts
```

### Reconcile

```bash
npm run dev -- reconcile <source.csv> <target.csv>
```

Exit code is non-zero if discrepancies exist.

## Category Email Automation

Run once immediately:

```bash
npm run report:send-now
```

Run with schedule gate (sends only when local hour matches `YNAB_REPORT_SEND_HOUR`):

```bash
npm run report:send-daily
```

GitHub Actions workflow:

- File: `.github/workflows/daily-ynab-category-email.yml`
- Cron: hourly at minute 5 UTC
- Script gate enforces `7:00` in `Asia/Jerusalem`
- Add repository secrets:
  - `YNAB_API_TOKEN`
  - `YNAB_REPORT_RECIPIENT_EMAIL`
  - `GMAIL_SMTP_USER`
  - `GMAIL_SMTP_APP_PASSWORD`

## Output Format

CSV headers:

```
Date,Payee,Memo,Outflow,Inflow
```

Example:

```csv
Date,Payee,Memo,Outflow,Inflow
2024-03-15,סופר פארם,"{""chargeDate"":""2024-03-15"",""source"":""Max - 1234""}",150.00,
```

### Memo JSON Fields (Actual)

- `transactionDate`
- `chargeDate`
- `installment` (e.g., `"2/12"`)
- `originalAmount`
- `originalCurrency`
- `source` (account name + number)
- `type`
- `category`
- `bankMemo`

If no metadata exists, memo is empty.

## Reconciliation

Compares two CSVs and reports:

- exact matches
- matches with date offsets (±2 days)
- missing from target
- extra in target

Available via CLI or GUI.

## Timezone Modification (Required)

1. Set default timezone in scrapers:

```ts
import moment from "moment-timezone";
moment.tz.setDefault("Asia/Jerusalem");
```

2. Replace `.toISOString()` with `.toISOString(true)` in scraper files to preserve timezone offset.

Example:

```ts
// Before
date: moment(txn.eventDate, DATE_FORMAT).toISOString(),

// After
date: moment(txn.eventDate, DATE_FORMAT).toISOString(true),
```

## Development

```bash
npm run dev:all          # GUI + API server
npm run build            # TS build
npm test                 # tests
npm run typecheck        # tsc --noEmit
```

If working on scrapers in parallel:

```bash
npm run dev:all:with-scrapers
```

## Project Structure

```
israeli-bank-ynab-transformer/
├── gui/                           # React GUI (Vite)
├── config/
│   └── category-report.json       # Selected categories for report preview
├── src/
│   ├── server/                    # Express API
│   ├── ynab/                      # YNAB report service + config loader
│   ├── config.ts                  # Env config
│   ├── scraper.ts                 # Scraper wrapper
│   ├── transformer.ts             # YNAB transform logic
│   ├── csv-writer.ts              # CSV output
│   ├── reconcile.ts               # CSV comparison
│   ├── column-standardization.ts  # Hebrew/English column mapping
│   ├── audit-logger.ts            # Audit logs
│   └── *.test.ts
├── logs/                          # Audit logs
├── output/                        # CSV output
└── README.md
```

## License

MIT

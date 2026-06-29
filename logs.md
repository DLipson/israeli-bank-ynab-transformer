## 2026-02-07 - Remove redundant raw transaction logging
- **Bug**: Audit logs in `./logs` included a redundant "Raw Scraper Results" section that repeated every scraped transaction before the transformation mapping.
- **Root Cause**: The audit logger stored and formatted `rawScraperResults` whenever detailed logging was enabled, so the log printed the full raw transaction list and then printed transformation details again.
- **Fix**: Removed raw scraper result recording and stripped the "Raw Scraper Results" section from `formatAuditLog`, leaving only transformation mappings in detailed logs.
- **Verification**: Added a regression test in `src/audit-logger.test.ts` to assert raw results are omitted; ran `npm test -- src/audit-logger.test.ts`. Full suite `npm test` failed due to missing `dotenv/config` in the test environment.

## 2026-04-15 - Preserve Windows credentials during env reload
- **Bug**: Accounts with credentials stored in Windows Credential Manager appeared unconfigured in the UI even though the secrets still existed in Windows.
- **Root Cause**: `loadAppEnv({ override: true })` reloaded the app config `.env` after hydrating credentials from Windows Credential Manager, and blank credential entries in that file overwrote the non-empty in-memory values.
- **Fix**: Changed `loadAppEnv` to parse the app config file manually and skip overriding an existing non-empty environment variable with an empty string from `.env`.
- **Verification**: Added a regression test in `src/env.test.ts` covering the empty-string override case; ran `npm test -- src/env.test.ts` and then `npm test`.

## 2026-06-29 - Defer scraper dependency loading during startup
- **Bug**: Starting the GUI/API felt slow because the server loaded the bank scraper package before any scrape was requested.
- **Root Cause**: Static bank metadata imported `CompanyTypes` from `israeli-bank-scrapers`, and `src/scraper.ts` imported `createScraper` at module load. Importing the API scrape route therefore pulled the scraper/Puppeteer stack into the server startup path.
- **Fix**: Replaced static bank company IDs with local string IDs and changed `src/scraper.ts` to import `israeli-bank-scrapers` dynamically inside `scrapeAccount`.
- **Verification**: Confirmed `src/banks.ts` and `src/scraper.ts` imports cache zero `israeli-bank-scrapers` modules; warmed scrape-route import measured about 159 ms versus about 1411 ms before; ran `npm test -- src/config.test.ts src/env.test.ts` and `npm test`.

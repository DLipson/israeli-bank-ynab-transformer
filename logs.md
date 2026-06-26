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

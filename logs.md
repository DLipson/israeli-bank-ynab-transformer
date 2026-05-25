## 2026-02-07 - Remove redundant raw transaction logging

- **Bug**: Audit logs in `./logs` included a redundant "Raw Scraper Results" section that repeated every scraped transaction before the transformation mapping.
- **Root Cause**: The audit logger stored and formatted `rawScraperResults` whenever detailed logging was enabled, so the log printed the full raw transaction list and then printed transformation details again.
- **Fix**: Removed raw scraper result recording and stripped the "Raw Scraper Results" section from `formatAuditLog`, leaving only transformation mappings in detailed logs.
- **Verification**: Added a regression test in `src/audit-logger.test.ts` to assert raw results are omitted; ran `npm test -- src/audit-logger.test.ts`. Full suite `npm test` failed due to missing `dotenv/config` in the test environment.

## 2026-05-25 - Allow partial credential updates

- **Bug**: Updating only one saved login credential, such as a password, failed unless every credential field for that account was entered again.
- **Root Cause**: `PUT /api/accounts/:name/credentials` treated blank or omitted fields as missing required input without checking whether those fields already had saved values.
- **Fix**: The credentials route now reloads the current credential source and preserves existing values when a submitted field is blank or omitted, while still rejecting incomplete credentials that have no saved value.
- **Verification**: Added `src/server/routes/accounts.test.ts` to cover password-only updates with an existing username; confirmed the test failed before the fix, then passed after the fix. Ran `npm test` with 127 passing tests.

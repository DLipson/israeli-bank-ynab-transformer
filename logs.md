## 2026-02-07 - Remove redundant raw transaction logging
- **Bug**: Audit logs in `./logs` included a redundant "Raw Scraper Results" section that repeated every scraped transaction before the transformation mapping.
- **Root Cause**: The audit logger stored and formatted `rawScraperResults` whenever detailed logging was enabled, so the log printed the full raw transaction list and then printed transformation details again.
- **Fix**: Removed raw scraper result recording and stripped the "Raw Scraper Results" section from `formatAuditLog`, leaving only transformation mappings in detailed logs.
- **Verification**: Added a regression test in `src/audit-logger.test.ts` to assert raw results are omitted; ran `npm test -- src/audit-logger.test.ts`. Full suite `npm test` failed due to missing `dotenv/config` in the test environment.

## 2026-06-29 - Fix scraper transaction type imports
- **Bug**: `npm run build` failed because `EnrichedTransaction` no longer exposed scraper transaction fields such as `date`, `processedDate`, `description`, `chargedAmount`, `type`, and `status`; `audit-logger.ts` also referenced `ScrapeResult` without importing it.
- **Root Cause**: The project uses `module`/`moduleResolution` `NodeNext`, but `transformer.ts` imported scraper transaction types from the extensionless deep path `israeli-bank-scrapers/lib/transactions`. TypeScript could not resolve that path, so `EnrichedTransaction extends Transaction` lost the scraper fields. `audit-logger.ts` also depended on `ScrapeResult` without a local type import.
- **Fix**: Updated the transaction type import to `israeli-bank-scrapers/lib/transactions.js`, added the missing `ScrapeResult` type import, and added a compile-time regression test that asserts `EnrichedTransaction` preserves the scraper `Transaction` fields while adding account metadata.
- **Verification**: Confirmed the red build failure with `npm run build`; after the fix, ran `npm run build` and `npm test` successfully.

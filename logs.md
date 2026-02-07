## 2026-02-07 - Remove redundant raw transaction logging
- **Bug**: Audit logs in `./logs` included a redundant "Raw Scraper Results" section that repeated every scraped transaction before the transformation mapping.
- **Root Cause**: The audit logger stored and formatted `rawScraperResults` whenever detailed logging was enabled, so the log printed the full raw transaction list and then printed transformation details again.
- **Fix**: Removed raw scraper result recording and stripped the "Raw Scraper Results" section from `formatAuditLog`, leaving only transformation mappings in detailed logs.
- **Verification**: Added a regression test in `src/audit-logger.test.ts` to assert raw results are omitted; ran `npm test -- src/audit-logger.test.ts`. Full suite `npm test` failed due to missing `dotenv/config` in the test environment.

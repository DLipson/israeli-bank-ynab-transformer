// Daily scheduled run (Windows Task Scheduler, 10:00): makes the reports that are due and saves
// them for the Reports tab. Read-only towards YNAB.
// Usage: npm run report:spending
import { loadAppEnv } from "../env.js";
import { getYnabToken } from "../ynab/import-service.js";
import { runDueReports } from "./reports-service.js";

loadAppEnv();
const made = await runDueReports(getYnabToken());
console.log(made.length ? made.map((r) => `Saved: ${r.title}`).join("\n") : "No report is due today.");

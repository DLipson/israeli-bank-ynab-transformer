import { appendFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { format, stripVTControlCharacters } from "node:util";
import { getAppConfigDir } from "./paths.js";

interface DebugLib {
  enable(namespaces: string): void;
  disable(): string;
  log: (...args: unknown[]) => void;
}

/** Banks whose scraper debug lines are saved to a trace file. */
const TRACED_NAMESPACES: Record<string, string> = {
  leumi: "israeli-bank-scrapers:leumi,israeli-bank-scrapers:base-scraper-with-browser",
};

/** israeli-bank-scrapers loads its own copy of "debug"; only that copy controls its log lines. */
function scrapersDebug(): DebugLib {
  const scrapersEntry = createRequire(import.meta.url).resolve("israeli-bank-scrapers");
  return createRequire(scrapersEntry)("debug") as DebugLib;
}

/**
 * Turns on the scraper's step-by-step debug lines for one bank and saves them to
 * ~/.config/israeli-bank-ynab-transformer/scraper-traces/<bank>-<time>.log (each line starts with
 * debug's own timestamp). Returns a function that turns them off again. Banks without a trace do
 * nothing.
 * ponytail: "debug" output is process-wide, so lines from another bank scraping at the same time
 * (base-scraper-with-browser) can appear in this trace too.
 */
export function startScraperTrace(companyId: string): () => void {
  const namespaces = TRACED_NAMESPACES[companyId];
  if (!namespaces) return () => {};

  const debug = scrapersDebug();
  const dir = join(getAppConfigDir(), "scraper-traces");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${companyId}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

  const previousLog = debug.log;
  debug.log = (...args: unknown[]) => {
    appendFileSync(file, `${stripVTControlCharacters(format(...args)).trim()}\n`);
  };
  debug.enable(namespaces);

  return () => {
    debug.disable();
    debug.log = previousLog;
  };
}

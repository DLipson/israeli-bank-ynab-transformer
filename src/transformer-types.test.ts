import { describe, expectTypeOf, it } from "vitest";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions.js";
import type { EnrichedTransaction } from "./transformer.js";

describe("EnrichedTransaction", () => {
  it("preserves scraper transaction fields with account metadata", () => {
    expectTypeOf<EnrichedTransaction>().toMatchTypeOf<Transaction>();
    expectTypeOf<EnrichedTransaction>().toHaveProperty("accountName").toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<EnrichedTransaction>().toHaveProperty("accountNumber").toEqualTypeOf<
      string | undefined
    >();
  });
});

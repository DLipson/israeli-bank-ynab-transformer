import { describe, it, expect } from "vitest";
import { validateDaysBack, calculateStartDate, getSupportedBanks, loadConfig } from "./config.js";

describe("validateDaysBack", () => {
  it("returns default for undefined", () => {
    expect(validateDaysBack(undefined)).toBe(60);
  });

  it("returns default for null", () => {
    expect(validateDaysBack(null)).toBe(60);
  });

  it("parses string numbers", () => {
    expect(validateDaysBack("30")).toBe(30);
    expect(validateDaysBack("90")).toBe(90);
  });

  it("accepts number input", () => {
    expect(validateDaysBack(45)).toBe(45);
  });

  it("throws for invalid string", () => {
    expect(() => validateDaysBack("abc")).toThrow("Invalid daysBack");
  });

  it("throws for zero", () => {
    expect(() => validateDaysBack(0)).toThrow("Invalid daysBack");
  });

  it("throws for negative numbers", () => {
    expect(() => validateDaysBack(-5)).toThrow("Invalid daysBack");
  });

  it("warns for very large values but still returns them", () => {
    const result = validateDaysBack(400);
    expect(result).toBe(400);
    const config = loadConfig({ daysBack: 400 });
    expect(config.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("very large")])
    );
  });
});

describe("calculateStartDate", () => {
  it("returns date N days in the past", () => {
    const result = calculateStartDate(30);

    const expected = new Date();
    expected.setDate(expected.getDate() - 30);
    expected.setHours(0, 0, 0, 0);

    expect(result.getFullYear()).toBe(expected.getFullYear());
    expect(result.getMonth()).toBe(expected.getMonth());
    expect(result.getDate()).toBe(expected.getDate());
  });

  it("sets time to start of day", () => {
    const result = calculateStartDate(30);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

describe("getSupportedBanks", () => {
  it("returns array of bank names", () => {
    const banks = getSupportedBanks();
    expect(Array.isArray(banks)).toBe(true);
    expect(banks.length).toBeGreaterThan(0);
  });

  it("includes common Israeli banks", () => {
    const banks = getSupportedBanks();
    expect(banks).toContain("Leumi");
    expect(banks).toContain("Hapoalim");
    expect(banks).toContain("Max");
  });
});

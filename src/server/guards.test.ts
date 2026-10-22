import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { isLocalHost, isUncPath, localOnly } from "./guards.js";

function run(headers: Record<string, string>) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const next = vi.fn();
  localOnly({ headers } as unknown as Request, { status } as unknown as Response, next);
  return { json, status, next };
}

describe("isLocalHost", () => {
  it("accepts loopback names only", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "[::1]"]) expect(isLocalHost(h)).toBe(true);
    expect(isLocalHost("evil.example")).toBe(false);
  });
});

describe("isUncPath", () => {
  it("detects UNC paths", () => {
    expect(isUncPath("\\\\server\\share")).toBe(true);
    expect(isUncPath("//server/share")).toBe(true);
    expect(isUncPath("C:\\temp")).toBe(false);
  });
});

describe("localOnly", () => {
  it("allows localhost without Origin", () => {
    expect(run({ host: "localhost:3001" }).next).toHaveBeenCalled();
  });
  it("allows 127.0.0.1", () => {
    expect(run({ host: "127.0.0.1:3001" }).next).toHaveBeenCalled();
  });
  it("rejects a foreign Host", () => {
    const r = run({ host: "evil.example:3001" });
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith({ error: "Forbidden host" });
    expect(r.next).not.toHaveBeenCalled();
  });
  it("rejects a foreign Origin", () => {
    const r = run({ host: "localhost:3001", origin: "http://evil.example" });
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith({ error: "Forbidden origin" });
  });
  it("allows a local Origin", () => {
    expect(run({ host: "localhost:3001", origin: "http://localhost:5173" }).next).toHaveBeenCalled();
  });
  it("rejects a missing Host", () => {
    expect(run({}).status).toHaveBeenCalledWith(403);
  });
});

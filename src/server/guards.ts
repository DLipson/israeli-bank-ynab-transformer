import type { NextFunction, Request, Response } from "express";

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function hostnameOf(value: string, withScheme: boolean): string | null {
  try {
    return new URL(withScheme ? "http://" + value : value).hostname;
  } catch {
    return null;
  }
}

// Blocks DNS rebinding and cross-site calls to the localhost API.
export function localOnly(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host;
  const hostname = host ? hostnameOf(host, true) : null;
  if (!hostname || !isLocalHost(hostname)) {
    res.status(403).json({ error: "Forbidden host" });
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const originHost = hostnameOf(origin, false);
    if (!originHost || !isLocalHost(originHost)) {
      res.status(403).json({ error: "Forbidden origin" });
      return;
    }
  }
  next();
}

export function isUncPath(p: string): boolean {
  return p.startsWith("\\\\") || p.startsWith("//");
}

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import dotenv from "dotenv";

/**
 * Write/update specific keys in a .env file, preserving comments and structure.
 * Only the keys in `updates` are changed; everything else stays the same.
 */
export function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? dotenv.parse(readFileSync(path, "utf-8")) : {};
}
/** Preserve comments and structure while updating selected keys. */
export function writeEnvFile(path: string, updates: Record<string, string>): void {
  let lines: string[] = [];

  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8");
    lines = content.split(/\r?\n/);
  }

  const remaining = { ...updates };

  // Update existing lines
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (key in remaining) {
      lines[i] = `${key}=${remaining[key]}`;
      delete remaining[key];
    }
  }

  // Append any new keys not found in existing file
  for (const [key, value] of Object.entries(remaining)) {
    lines.push(`${key}=${value}`);
  }

  writeFileSync(path, lines.join("\n"), "utf-8");
}

/**
 * Clear specific keys in a .env file (set them to empty string).
 */
export function clearEnvVars(path: string, keys: string[]): void {
  writeEnvFile(path, Object.fromEntries(keys.map((key) => [key, ""])));
}



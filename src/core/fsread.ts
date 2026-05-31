import { existsSync, readFileSync } from "node:fs";

/** File contents as utf8, or "" when the path does not exist. */
export function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** File contents as utf8, or null when the path does not exist. */
export function readIfExistsOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function freshHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "consort-test-"));
  process.env.CONSORT_HOME = home;
  return { home, cleanup: () => { delete process.env.CONSORT_HOME; rmSync(home, { recursive: true, force: true }); } };
}

import { writeFileSync, renameSync, appendFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";

export function atomicWrite(dest: string, content: string | Buffer): void {
  if (!dest) throw new Error("atomicWrite: missing dest path");
  const tmp = `${dest}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, dest); // atomic within same directory
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
}

export function appendJsonl(path: string, obj: unknown): void {
  appendFileSync(path, JSON.stringify(obj) + "\n");
}

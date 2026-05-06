import { writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import * as logger from "./logger";

export function writeFileAtomic(filePath: string, data: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmpPath, data, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    logger.warn(`[fs] Atomic rename failed for ${filePath}, falling back to direct write`);
    try {
      writeFileSync(filePath, data, "utf-8");
    } catch (writeErr) {
      logger.error(`[fs] Direct write also failed for ${filePath}`, writeErr);
      throw writeErr;
    }
  }
}

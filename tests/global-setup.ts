import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export const TEST_DB_DIR = path.resolve(__dirname, "../.tmp/test-db");
export const TEMPLATE_DB = path.join(TEST_DB_DIR, "template.db");

/** Migrates one template database; each test file copies it (tests/setup.ts). */
export default function globalSetup() {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DB_DIR, { recursive: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: `file:${TEMPLATE_DB}` },
    stdio: "pipe",
  });
  return () => rmSync(TEST_DB_DIR, { recursive: true, force: true });
}

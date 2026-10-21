import { randomUUID } from "node:crypto";
import { copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll } from "vitest";

// Each test file gets its own fresh, migrated SQLite file.
const dir = path.resolve(__dirname, "../.tmp/test-db");
const file = path.join(dir, `${randomUUID()}.db`);
copyFileSync(path.join(dir, "template.db"), file);
process.env.DATABASE_URL = `file:${file}?connection_limit=1`;
process.env.SESSION_SECRET = "test-session-secret-0123456789";
const uploads = path.join(path.resolve(__dirname, "../.tmp/test-uploads"), randomUUID());
process.env.UPLOAD_DIR = uploads;

afterAll(async () => {
  const { prisma } = await import("@/server/db");
  await prisma.$disconnect();
  rmSync(file, { force: true });
  rmSync(uploads, { recursive: true, force: true });
});

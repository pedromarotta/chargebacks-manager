-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "representments" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_ImportBatch" ("actor_id", "created_at", "duplicates", "filename", "id", "imported", "rejected") SELECT "actor_id", "created_at", "duplicates", "filename", "id", "imported", "rejected" FROM "ImportBatch";
DROP TABLE "ImportBatch";
ALTER TABLE "new_ImportBatch" RENAME TO "ImportBatch";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

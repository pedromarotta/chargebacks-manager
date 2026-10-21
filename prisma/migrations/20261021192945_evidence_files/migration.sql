-- CreateTable
CREATE TABLE "EvidenceFile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "evidence_item_id" INTEGER NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" DATETIME NOT NULL,
    CONSTRAINT "EvidenceFile_evidence_item_id_fkey" FOREIGN KEY ("evidence_item_id") REFERENCES "EvidenceItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceFile_storage_key_key" ON "EvidenceFile"("storage_key");

-- CreateIndex
CREATE INDEX "EvidenceFile_dispute_id_idx" ON "EvidenceFile"("dispute_id");

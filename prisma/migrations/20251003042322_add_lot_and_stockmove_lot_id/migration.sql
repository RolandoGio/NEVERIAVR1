-- CreateTable
CREATE TABLE "Lot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "receiptItemId" INTEGER NOT NULL,
    "qtyTotal" INTEGER NOT NULL,
    "qtyUsed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lot_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "ReceiptItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockMove" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "userCode" TEXT,
    "note" TEXT,
    "receiptItemId" INTEGER,
    "lotId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMove_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMove_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "ReceiptItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMove_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMove_userCode_fkey" FOREIGN KEY ("userCode") REFERENCES "User" ("code") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockMove" ("createdAt", "id", "kind", "note", "productId", "qty", "receiptItemId", "userCode") SELECT "createdAt", "id", "kind", "note", "productId", "qty", "receiptItemId", "userCode" FROM "StockMove";
DROP TABLE "StockMove";
ALTER TABLE "new_StockMove" RENAME TO "StockMove";
CREATE INDEX "StockMove_productId_createdAt_idx" ON "StockMove"("productId", "createdAt");
CREATE INDEX "StockMove_lotId_idx" ON "StockMove"("lotId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Lot_code_key" ON "Lot"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_receiptItemId_key" ON "Lot"("receiptItemId");

-- CreateIndex
CREATE INDEX "Lot_productId_idx" ON "Lot"("productId");

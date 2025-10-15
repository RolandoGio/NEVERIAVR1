-- CreateTable
CREATE TABLE "TechOpen" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "presentationId" INTEGER,
    "lotId" INTEGER,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedBy" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commentOpen" TEXT,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "closedBy" TEXT,
    "closedAt" DATETIME,
    "commentClose" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TechOpen_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TechOpen_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TechOpen_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechCounterLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "techOpenId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "userCode" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TechCounterLog_techOpenId_fkey" FOREIGN KEY ("techOpenId") REFERENCES "TechOpen" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userCode" TEXT NOT NULL,
    "totalGross" INTEGER NOT NULL DEFAULT 0,
    "totalDiscount" INTEGER NOT NULL DEFAULT 0,
    "totalNet" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    CONSTRAINT "Sale_userCode_fkey" FOREIGN KEY ("userCode") REFERENCES "User" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "saleId" INTEGER NOT NULL,
    "productId" INTEGER,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL DEFAULT 0,
    "isGift" BOOLEAN NOT NULL DEFAULT false,
    "tagsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalePromo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "saleId" INTEGER NOT NULL,
    "ruleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalePromo_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "categoryId" INTEGER NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "controlType" TEXT NOT NULL,
    "unitName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSellable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "conversionFactor" INTEGER,
    "conversionTargetSku" TEXT,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("categoryId", "controlType", "createdAt", "id", "isActive", "name", "supplierCode", "unitName", "updatedAt") SELECT "categoryId", "controlType", "createdAt", "id", "isActive", "name", "supplierCode", "unitName", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_supplierCode_key" ON "Product"("supplierCode");
CREATE INDEX "Product_controlType_idx" ON "Product"("controlType");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TechOpen_productId_status_kind_idx" ON "TechOpen"("productId", "status", "kind");

-- CreateIndex
CREATE INDEX "TechOpen_lotId_idx" ON "TechOpen"("lotId");

-- CreateIndex
CREATE INDEX "TechCounterLog_techOpenId_createdAt_idx" ON "TechCounterLog"("techOpenId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_code_key" ON "Sale"("code");

-- CreateIndex
CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt");

-- CreateIndex
CREATE INDEX "Sale_userCode_createdAt_idx" ON "Sale"("userCode", "createdAt");

-- CreateIndex
CREATE INDEX "SaleLine_saleId_idx" ON "SaleLine"("saleId");

-- CreateIndex
CREATE INDEX "SalePromo_saleId_idx" ON "SalePromo"("saleId");

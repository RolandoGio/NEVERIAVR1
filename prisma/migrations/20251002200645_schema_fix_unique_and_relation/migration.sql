/*
  Warnings:

  - A unique constraint covering the columns `[supplierCode]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Product_supplierCode_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Product_supplierCode_key" ON "Product"("supplierCode");

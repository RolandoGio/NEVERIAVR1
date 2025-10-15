import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

async function main() {
  const userCode = "SU0001"
  const editableUntil = new Date(Date.now() + 24*60*60*1000) // +24h

  const fromSku = "CN-360"
  const fromProd = await prisma.product.findUnique({ where: { supplierCode: fromSku } })
  if (!fromProd) throw new Error("No existe producto " + fromSku + " en catálogo")

  // presentación (si existe); si no, tomamos factor de producto o default=360
  const pres = await prisma.presentation.findFirst({ where: { productId: fromProd.id, isActive: true } })
  const unitsPerPack = Number(fromProd.conversionFactor || pres?.unitsPerPack || 360)

  const receipt = await prisma.receipt.create({
    data: {
      code: `RX-SMOKE-${Date.now()}`,
      userCode,
      status: "OPEN",
      editableUntil,
      comment: "smoke from-receipt"
    }
  })

  const item = await prisma.receiptItem.create({
    data: {
      receiptId: receipt.id,
      productId: fromProd.id,
      presentationId: pres?.id || null,
      packs: 1,
      unitsPerPack,
      unitsTotal: unitsPerPack
    }
  })

  const lot = await prisma.lot.create({
    data: {
      code: `LOT-${fromSku}-${Date.now()}`,
      productId: fromProd.id,
      receiptItemId: item.id,
      qtyTotal: unitsPerPack
    }
  })

  console.log(JSON.stringify({ receiptId: receipt.id, receiptItemId: item.id, lotId: lot.id }))
}

main().catch(e => {
  console.error("mk-receipt-item error:", e?.message || e)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())

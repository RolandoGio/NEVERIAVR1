import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const userCode = 'SU0001'
  const editableUntil = new Date(Date.now() + 24*60*60*1000) // +24h

  // Asegura que existen los SKUs (CN-360 está en packs, CONO existe como target)
  const fromSku = 'CN-360'
  const fromProd = await prisma.product.findUnique({ where: { supplierCode: fromSku } })
  if (!fromProd) throw new Error(`No existe producto ${fromSku} en catálogo`)
  const pres = await prisma.presentation.findFirst({ where: { productId: fromProd.id, isActive: true } })

  const unitsPerPack = Number(fromProd.conversionFactor || pres?.unitsPerPack || 360)

  // 1) Receipt
  const receipt = await prisma.receipt.create({
    data: {
      code: `RX-SMOKE-${Date.now()}`,
      userCode,
      status: 'OPEN',
      editableUntil,
      comment: 'smoke from-receipt'
    }
  })

  // 2) ReceiptItem (1 pack)
  const item = await prisma.receiptItem.create({
    data: {
      receiptId: receipt.id,
      productId: fromProd.id,
      presentationId: pres?.id || null,
      packs: 1,
      unitsPerPack: unitsPerPack,
      unitsTotal: unitsPerPack
    }
  })

  // 3) Lot (1:1 con ReceiptItem)
  const lot = await prisma.lot.create({
    data: {
      code: `LOT-${fromSku}-${Date.now()}`,
      productId: fromProd.id,
      receiptItemId: item.id,
      qtyTotal: unitsPerPack
    }
  })

  console.log(JSON.stringify({ receiptId: receipt.id, receiptItemId: item.id, lotId: lot.id }, null, 2))
}

main().finally(() => prisma.$disconnect())

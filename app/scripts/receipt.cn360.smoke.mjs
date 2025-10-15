// app/scripts/receipt.cn360.smoke.mjs
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const userCode = 'SU0001'
  const fromSku = 'CN-360'

  // 1) Producto pack (origen)
  const fromProd = await prisma.product.findUnique({ where: { supplierCode: fromSku } })
  if (!fromProd) throw new Error(`No existe producto ${fromSku} en catálogo`)
  const unitsPerPack = Number(fromProd.conversionFactor || 360)
  const targetSku = String(fromProd.conversionTargetSku || 'CONO')

  // 2) Producto destino (unidades)
  const toProd = await prisma.product.findUnique({ where: { supplierCode: targetSku } })
  if (!toProd) throw new Error(`No existe SKU destino ${targetSku}`)

  // 3) Crear recepción + item + lote (1:1 con item)
  const receipt = await prisma.receipt.create({
    data: {
      code: `RX-CN360-${Date.now()}`,
      userCode,
      status: 'LOCKED',                        // la dejamos cerrada
      editableUntil: new Date(Date.now() + 24*60*60*1000),
      comment: 'smoke: CN-360 → CONO (explode)'
    }
  })

  const item = await prisma.receiptItem.create({
    data: {
      receiptId: receipt.id,
      productId: fromProd.id,
      presentationId: null,
      packs: 1,
      unitsPerPack: unitsPerPack,
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

  // 4) Explosión pack→unidades: sumamos stock al SKU destino
  await prisma.stockMove.create({
    data: {
      productId: toProd.id,
      kind: 'RECEIPT',
      qty: unitsPerPack,
      userCode,
      note: `RX ${receipt.code} explode ${fromSku}→${targetSku}`
    }
  })

  console.log('✅ Recepción creada y explotada a unidades:')
  console.log(JSON.stringify({
    receiptId: receipt.id,
    receiptCode: receipt.code,
    lotId: lot.id,
    addedTo: targetSku,
    qty: unitsPerPack
  }, null, 2))
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })

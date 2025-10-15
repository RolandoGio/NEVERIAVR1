// app/scripts/stock.summary.bySku.mjs
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function stockBySku(sku) {
  const p = await prisma.product.findUnique({ where: { supplierCode: sku } })
  if (!p) return { sku, exists: false, stock: 0 }
  const moves = await prisma.stockMove.findMany({ where: { productId: p.id } })
  const stock = moves.reduce((acc, m) => acc + Number(m.qty || 0), 0)
  return { sku, exists: true, stock, moves: moves.length }
}

async function main() {
  const SKUS = ['CONO', 'PALETA_CHOCO', 'PALETA_LIMON']
  const rows = []
  for (const sku of SKUS) rows.push(await stockBySku(sku))
  console.table(rows)
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })

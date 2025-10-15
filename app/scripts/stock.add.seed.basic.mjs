// app/scripts/stock.add.seed.basic.mjs
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const SEED_LINES = [
  { sku: 'PALETA_CHOCO', qty: 50, note: 'SEED paleta choco' },
  { sku: 'PALETA_LIMON', qty: 50, note: 'SEED paleta limón' },
  { sku: 'CONO',         qty: 80, note: 'SEED conos sueltos' }
]

async function addStock({ sku, qty, note }) {
  const p = await prisma.product.findUnique({ where: { supplierCode: sku } })
  if (!p) { console.warn(`⚠️ SKU ${sku} no existe — omitido`); return { sku, ok: false, reason: 'missing' } }
  if (['tecnico_helado','tecnico_topping'].includes(p.controlType)) {
    console.warn(`ℹ️ SKU ${sku} es técnico — omitido`)
    return { sku, ok: false, reason: 'technical' }
  }
  await prisma.stockMove.create({
    data: { productId: p.id, kind: 'ADJUST', qty: Math.abs(Number(qty||0)), userCode: 'SU0001', note }
  })
  return { sku, ok: true }
}

async function main() {
  const results = []
  for (const line of SEED_LINES) results.push(await addStock(line))
  console.table(results)
}

main().then(() => console.log('✅ Ajuste de inventario creado.'))
  .catch(e => { console.error('❌ Error:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })

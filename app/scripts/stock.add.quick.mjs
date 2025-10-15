// app/scripts/stock.add.quick.mjs
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// Ajusta aquí lo que quieras ingresar al inventario (cantidades POSITIVAS)
const SEED_LINES = [
  { sku: 'PALETA_CHOCO', qty: 50, note: 'SEED CHOCO' },
  { sku: 'PALETA_LIMON', qty: 50, note: 'SEED LIMON' },
  { sku: 'CONO',         qty: 80, note: 'SEED CONO'   },
]

async function addStock({ sku, qty, note }) {
  const product = await prisma.product.findUnique({ where: { supplierCode: sku } })
  if (!product) {
    console.warn(`⚠️ SKU ${sku} no existe en catálogo — omitido`)
    return { sku, ok: false, reason: 'missing' }
  }
  // No aplicamos a técnico aquí
  if (['tecnico_helado','tecnico_topping'].includes(product.controlType)) {
    console.warn(`ℹ️ SKU ${sku} es técnico — omitido`)
    return { sku, ok: false, reason: 'technical' }
  }
  await prisma.stockMove.create({
    data: {
      productId: product.id,
      kind: 'ADJUST',
      qty: Math.abs(Number(qty || 0)),
      userCode: 'SU0001',  // opcional: cambia si quieres
      note: note || `SEED ${sku}`,
    }
  })
  return { sku, ok: true }
}

async function main() {
  const results = []
  for (const line of SEED_LINES) {
    results.push(await addStock(line))
  }
  console.table(results)
}

main()
  .then(() => console.log('✅ Ajuste de inventario completado.'))
  .catch((e) => { console.error('❌ Error:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })

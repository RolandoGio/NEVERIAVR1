// app/scripts/seed.catalog.min.mjs
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function upsertCategory(code, name) {
  return prisma.category.upsert({
    where: { code },
    update: { name, isActive: true },
    create: { code, name, isActive: true }
  })
}

async function upsertProduct(categoryId, supplierCode, name, controlType, unitName = 'pz') {
  return prisma.product.upsert({
    where: { supplierCode },
    update: { name, categoryId, controlType, unitName, isActive: true },
    create: { categoryId, supplierCode, name, controlType, unitName, isActive: true }
  })
}

async function main() {
  // Categorías
  const catVenta   = await upsertCategory('VENTA',   'Venta directa')
  const catTecnico = await upsertCategory('TECNICO', 'Técnico')

  // Venta directa (se descuentan en inventario al vender)
  await upsertProduct(catVenta.id, 'PALETA_CHOCO', 'Paleta Choco', 'venta_directa', 'pz')
  await upsertProduct(catVenta.id, 'PALETA_LIMON', 'Paleta Limón', 'venta_directa', 'pz')
  await upsertProduct(catVenta.id, 'CONO',         'Cono',         'venta_directa', 'pz')

  // Técnico (contador de bolitas; no descarga inventario directo)
  await upsertProduct(catTecnico.id, 'BOLITA', 'Bolita', 'tecnico_helado', 'serv')
}

main()
  .then(() => console.log('✅ Catálogo mínimo sembrado.'))
  .catch((e) => { console.error('Seed error:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })

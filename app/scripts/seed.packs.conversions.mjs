import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function upsertCategory(code, name) {
  return prisma.category.upsert({
    where: { code },
    update: { name, isActive: true },
    create: { code, name, isActive: true }
  })
}

async function upsertProduct({ categoryId, supplierCode, name, controlType, unitName, extra = {} }) {
  return prisma.product.upsert({
    where: { supplierCode },
    update: { name, categoryId, controlType, unitName, isActive: true, ...extra },
    create: { categoryId, supplierCode, name, controlType, unitName, isActive: true, ...extra }
  })
}

async function main() {
  // Categorías mínimas
  const catVenta    = await upsertCategory('VENTA',    'Venta directa')
  const catUnitario = await upsertCategory('UNITARIO', 'Insumos unitarios')

  // Asegurar CONO (unidad)
  await upsertProduct({
    categoryId: catVenta.id,
    supplierCode: 'CONO',
    name: 'Cono',
    controlType: 'venta_directa',
    unitName: 'pz'
  })

  // Asegurar CN-360 (pack) con conversión persistente → CONO
  await upsertProduct({
    categoryId: catUnitario.id,
    supplierCode: 'CN-360',
    name: 'Conos (caja 360 u)',
    controlType: 'unitario',
    unitName: 'caja',
    extra: {
      conversionFactor: 360,
      conversionTargetSku: 'CONO'
    }
  })

  console.log('✅ Packs→unidades formalizado: CN-360 →(360)→ CONO')
}

main()
  .catch((e) => { console.error('Seed error:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })

// app/scripts/catalog.upsert.paletas-cono.mjs
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function upsertCategory(code, name) {
  return prisma.category.upsert({
    where: { code },
    update: { name, isActive: true },
    create: { code, name, isActive: true }
  })
}

async function upsertProduct({ categoryId, supplierCode, name, controlType, unitName = 'pz', extra = {}, presentations = [] }) {
  return prisma.product.upsert({
    where: { supplierCode },
    update: { categoryId, name, controlType, unitName, isActive: true, ...extra },
    create: {
      categoryId, supplierCode, name, controlType, unitName, isActive: true, ...extra,
      presentations: presentations.length ? { create: presentations } : undefined
    }
  })
}

async function main() {
  const catVenta = await upsertCategory('VENTA', 'Venta directa')
  const catUnit  = await upsertCategory('UNITARIO', 'Insumos unitarios')

  await upsertProduct({
    categoryId: catVenta.id,
    supplierCode: 'PALETA_CHOCO',
    name: 'Paleta Choco',
    controlType: 'venta_directa',
    unitName: 'pz',
    presentations: [{ name: 'default', isDefault: true, isActive: true }]
  })

  await upsertProduct({
    categoryId: catVenta.id,
    supplierCode: 'PALETA_LIMON',
    name: 'Paleta Limón',
    controlType: 'venta_directa',
    unitName: 'pz',
    presentations: [{ name: 'default', isDefault: true, isActive: true }]
  })

  await upsertProduct({
    categoryId: catVenta.id,
    supplierCode: 'CONO',
    name: 'Cono',
    controlType: 'venta_directa',
    unitName: 'pz',
    presentations: [{ name: 'default', isDefault: true, isActive: true }]
  })

  // Opcional pero recomendado: pack de conos → unidades
  await upsertProduct({
    categoryId: catUnit.id,
    supplierCode: 'CN-360',
    name: 'Conos (caja 360 u)',
    controlType: 'unitario',
    unitName: 'caja',
    extra: { conversionFactor: 360, conversionTargetSku: 'CONO' },
    presentations: [{ name: 'caja', unitsPerPack: 360, isDefault: true, isActive: true }]
  })

  console.log('✅ Catálogo listo: PALETA_CHOCO, PALETA_LIMON, CONO, CN-360')
}

main().catch(e => { console.error('Seed error:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })

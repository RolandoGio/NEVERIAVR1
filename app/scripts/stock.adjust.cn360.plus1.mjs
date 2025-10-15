// Agrega +1 pack de CN-360 (kind: ADJUST)
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
try {
  const p = await prisma.product.findUnique({ where: { supplierCode: 'CN-360' } })
  if (!p) throw new Error('CN-360 no existe en catálogo')
  await prisma.stockMove.create({
    data: { productId: p.id, kind: 'ADJUST', qty: 1, userCode: 'SU0001', note: 'SEED +1 pack CN-360' }
  })
  console.log('✅ OK: +1 pack CN-360')
} catch (e) {
  console.error('❌', e?.message || e)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}

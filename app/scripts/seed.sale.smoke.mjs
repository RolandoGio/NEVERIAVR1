// app/scripts/seed.sale.smoke.mjs
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// helper centavos
const c = (mxn) => Math.round(Number(mxn) * 100)

async function main() {
  // usaremos el usuario SU0001 que ya existe por tus seeds
  const userCode = 'SU0001'
  const code = `SAL-${Date.now()}`

  // Precios ejemplo (no vienen del catálogo aún):
  const pricePaleta = c(25)   // $25.00
  const priceCono   = c(5)    // $5.00 (el regalo irá a $0)

  // Líneas: paleta choco + paleta limón + (regalo) 1 cono
  const lines = [
    { sku: 'PALETA_CHOCO', name: 'Paleta Choco', qty: 1, unitPrice: pricePaleta, isGift: false },
    { sku: 'PALETA_LIMON', name: 'Paleta Limón', qty: 1, unitPrice: pricePaleta, isGift: false },
    { sku: 'CONO',         name: 'Cono (regalo)', qty: 1, unitPrice: 0,           isGift: true  },
  ]

  const totalGross    = pricePaleta * 2 + priceCono      // lo “teórico” sin promo
  const totalDiscount = priceCono                         // el regalo compensa el cono
  const totalNet      = totalGross - totalDiscount       // lo que realmente se cobra

  const sale = await prisma.sale.create({
    data: {
      code,
      userCode,
      currency: 'MXN',
      totalGross,
      totalDiscount,
      totalNet,
      lines: {
        create: lines.map(l => ({
          sku: l.sku,
          name: l.name,
          qty: l.qty,
          unitPrice: l.unitPrice,
          isGift: l.isGift,
          tagsJson: JSON.stringify({ demo: true }) // string JSON (SQLite)
        })),
      },
      promos: {
        create: [{
          ruleId: 'PR-COMBO-PALETAS-CONITO',
          name:   'Combo paletas → cono gratis',
          amount: 0, // solo regalo
          metaJson: JSON.stringify({ giftSku: 'CONO', giftQty: 1 })
        }]
      }
    }
  })

  console.log('✅ Sale smoke creada:', sale.code)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })

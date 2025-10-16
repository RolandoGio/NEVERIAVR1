import path from 'path'
import { PrismaClient } from '@prisma/client'
import { generateSimplePdf } from './pdf.js'

const prisma = new PrismaClient()

async function formatCurrency(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`
}

async function buildSalesLines({ since, until }) {
  const sales = await prisma.sale.findMany({
    where: {
      createdAt: {
        gte: since,
        lt: until,
      },
    },
    orderBy: { createdAt: 'asc' },
    include: { promos: true },
  })
  const lines = [`Ventas entre ${since.toISOString()} y ${until.toISOString()}`]
  let total = 0
  for (const sale of sales) {
    total += Number(sale.totalNet || 0)
    lines.push(`${sale.code} · ${await formatCurrency(sale.totalNet)} · usuario ${sale.userCode}`)
    if (sale.promos.length) {
      for (const promo of sale.promos) {
        lines.push(`  Promo ${promo.ruleId}: -${await formatCurrency(promo.amount)}`)
      }
    }
  }
  lines.push(`Total neto: ${await formatCurrency(total)}`)
  return lines
}

async function buildInventoryLines({ since, until }) {
  const moves = await prisma.stockMove.findMany({
    where: {
      createdAt: {
        gte: since,
        lt: until,
      },
    },
    orderBy: { createdAt: 'asc' },
    include: { product: true },
  })
  const lines = [`Movimientos de inventario ${since.toISOString()} - ${until.toISOString()}`]
  for (const move of moves) {
    const sku = move.product?.supplierCode || move.productId
    lines.push(`${move.createdAt.toISOString()} · ${move.kind} · ${sku} · qty ${move.qty}`)
  }
  return lines
}

async function buildAuditLines({ since, until }) {
  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: {
        gte: since,
        lt: until,
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  const lines = [`Bitácora ${since.toISOString()} - ${until.toISOString()}`]
  for (const log of logs) {
    lines.push(`${log.createdAt.toISOString()} · ${log.userCode ?? 'n/a'} · ${log.module}.${log.action}`)
  }
  return lines
}

export async function generateDailyReports({ date = new Date(), outputDir }) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const baseDir = outputDir || path.resolve(process.cwd(), 'reports')
  const dayCode = start.toISOString().slice(0, 10)
  const reportDir = path.join(baseDir, dayCode)

  const salesLines = await buildSalesLines({ since: start, until: end })
  const inventoryLines = await buildInventoryLines({ since: start, until: end })
  const auditLines = await buildAuditLines({ since: start, until: end })

  const salesPath = await generateSimplePdf({
    title: `Ventas ${dayCode}`,
    lines: salesLines,
    outputDir: reportDir,
    filename: 'ventas.pdf',
  })
  const inventoryPath = await generateSimplePdf({
    title: `Inventario ${dayCode}`,
    lines: inventoryLines,
    outputDir: reportDir,
    filename: 'inventario.pdf',
  })
  const auditPath = await generateSimplePdf({
    title: `Bitácora ${dayCode}`,
    lines: auditLines,
    outputDir: reportDir,
    filename: 'bitacora.pdf',
  })

  return { reportDir, files: { salesPath, inventoryPath, auditPath } }
}

export default generateDailyReports

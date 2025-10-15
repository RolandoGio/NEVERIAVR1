// app/server/routes/sales.router.mjs
import { Router } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const router = Router()

const toInt = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error('Valor numérico inválido')
  return Math.trunc(n)
}

function nowCode(prefix = 'SAL') {
  return `${prefix}-${Date.now()}`
}

/**
 * POST /api/sales
 * Body:
 * {
 *   items: [{ sku, name, qty, unitPrice, isGift?, tagsJson? }],
 *   promos?: [{ ruleId, name, amount, metaJson? }],
 *   pricing?: { totalGross, totalDiscount, totalNet },  // opcional
 *   code?: "SAL-..."                                    // opcional
 * }
 *
 * Reglas:
 * - totalNet SIEMPRE = sum(items.qty * items.unitPrice).
 * - Si viene "pricing", validamos que totalGross - totalDiscount = totalNet.
 * - Si NO viene "pricing", inferimos: totalGross = totalNet + sum(promos.amount||0), totalDiscount = esa suma.
 * - userCode se toma de req.user.code (auth middleware), fallback body.userCode o 'SU0001' para pruebas.
 */
router.post('/sales', async (req, res) => {
  try {
    const userCode = req.user?.code || req.body.userCode || 'SU0001'
    const items = Array.isArray(req.body.items) ? req.body.items : []
    const promos = Array.isArray(req.body.promos) ? req.body.promos : []
    const pricing = req.body.pricing || null

    if (items.length === 0) {
      return res.status(400).json({ error: 'Debes enviar al menos 1 ítem' })
    }

    // net = suma post-descuento (regalos con unitPrice 0)
    const net = items.reduce((acc, it) => {
      const qty = toInt(it.qty ?? 1)
      const unitPrice = toInt(it.unitPrice ?? 0)
      if (qty <= 0 || unitPrice < 0) throw new Error('Ítem con qty/unitPrice inválidos')
      return acc + qty * unitPrice
    }, 0)

    // descuento explícito por promos (p. ej. % / monto). Regalos pueden venir con amount = 0.
    const promoAmount = promos.reduce((acc, p) => acc + toInt(p.amount ?? 0), 0)

    let totalGross = net + promoAmount
    let totalDiscount = promoAmount
    let totalNet = net

    if (pricing) {
      const pg = toInt(pricing.totalGross)
      const pd = toInt(pricing.totalDiscount)
      const pn = toInt(pricing.totalNet)
      if (pn !== net) {
        return res.status(400).json({
          error: 'pricing.totalNet no coincide con la suma de las líneas',
          details: { provided: pn, computedFromLines: net }
        })
      }
      if (pg - pd !== pn) {
        return res.status(400).json({
          error: 'totalGross - totalDiscount debe ser igual a totalNet',
          details: { totalGross: pg, totalDiscount: pd, totalNet: pn }
        })
      }
      totalGross = pg
      totalDiscount = pd
      totalNet = pn
    }

    const code = req.body.code || nowCode('SAL')

    const sale = await prisma.sale.create({
      data: {
        code,
        userCode,
        currency: 'MXN',
        totalGross,
        totalDiscount,
        totalNet,
        lines: {
          create: items.map(it => ({
            sku: String(it.sku),
            name: String(it.name ?? it.sku),
            qty: toInt(it.qty ?? 1),
            unitPrice: toInt(it.unitPrice ?? 0),
            isGift: Boolean(it.isGift ?? false),
            tagsJson: it.tagsJson ? String(it.tagsJson) : null,
          }))
        },
        promos: {
          create: promos.map(p => ({
            ruleId: String(p.ruleId),
            name: String(p.name ?? p.ruleId),
            amount: toInt(p.amount ?? 0),
            metaJson: p.metaJson ? String(p.metaJson) : null,
          }))
        }
      },
      include: { lines: true, promos: true }
    })

    // TODO (siguientes pasos del sprint):
    // - Empujar movimientos a inventario/tech según BOM
    // - Auditoría (AuditLog) con before/after

    res.json({ ok: true, sale })
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al crear la venta' })
  }
})

/**
 * GET /api/sales/:idOrCode
 * - Si :idOrCode es numérico → busca por id
 * - Si no → busca por code
 */
router.get('/sales/:idOrCode', async (req, res) => {
  const { idOrCode } = req.params
  try {
    const where = /^\d+$/.test(idOrCode)
      ? { id: Number(idOrCode) }
      : { code: String(idOrCode) }

    const sale = await prisma.sale.findUnique({
      where,
      include: { lines: true, promos: true }
    })

    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' })
    res.json(sale)
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al consultar la venta' })
  }
})

/**
 * GET /api/sales?limit=20
 * Listado simple ordenado por fecha desc
 */
router.get('/sales', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit ?? '20', 10), 1), 200)
  try {
    const sales = await prisma.sale.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { lines: true, promos: true }
    })
    res.json(sales)
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al listar ventas' })
  }
})

export default router

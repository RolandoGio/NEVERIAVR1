// app/electron/api.inventory.js
// Inventario: packs→unidades con DB-first + packs.yaml (fallback) + log + reversión
// Extras: resolve (debug), from-receipt, link a receiptItem/lot en StockMove
// Nuevo: guard anti–doble revert (idempotencia) + endpoints de stock/kardex/summary

import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import yaml from 'js-yaml'
import { PrismaClient } from '@prisma/client'

export const inventoryRouter = express.Router()
const prisma = new PrismaClient()

// ===== Auth / Roles =====
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  next()
}
const isAdmin   = (u) => u?.role === 'ADMIN'
const isSuperSU = (u) => u?.role === 'SUPERSU'
const assertAdminLike = (u) => (isAdmin(u) || isSuperSU(u))
const canViewInventory = (u) => !!u // (CJ/AD/SU)

// ===== packs.yaml (candidatos) =====
const PACKS_CANDIDATES = [
  path.resolve(process.cwd(), 'config', 'packs.yaml'),
  path.resolve(process.cwd(), 'app', 'config', 'packs.yaml'),
]

async function loadPacks() {
  for (const file of PACKS_CANDIDATES) {
    try {
      const raw = await fs.readFile(file, 'utf8')
      const doc = yaml.load(raw) || {}
      const arr = Array.isArray(doc.packs) ? doc.packs : []
      const packs = arr
        .map(p => ([
          String(p.from ?? p.de ?? '').trim(),
          String(p.to ?? p.a ?? '').trim(),
          Number(p.factor ?? p.unidades ?? 0)
        ]))
        .filter(([from, to, factor]) => from && to && factor > 0)
        .map(([from, to, factor]) => ({ from, to, factor }))
      return { source: file, packs }
    } catch { /* intenta siguiente */ }
  }
  return { source: null, packs: [] }
}

async function getStock(productId) {
  const agg = await prisma.stockMove.aggregate({
    where: { productId },
    _sum: { qty: true }
  })
  return Number(agg._sum.qty || 0)
}

// ===== Resolver conversión: DB → packs.yaml → body =====
async function resolveConversion({ fromSku, bodyToSku, bodyFactor }) {
  // 1) Catálogo (persistente en Product)
  const fromProd = await prisma.product.findUnique({ where: { supplierCode: String(fromSku) } })
  if (fromProd && fromProd.conversionTargetSku && Number(fromProd.conversionFactor) > 0) {
    return {
      source: 'db',
      toSku: fromProd.conversionTargetSku,
      factor: Number(fromProd.conversionFactor),
      rule: { from: fromSku, to: fromProd.conversionTargetSku, factor: Number(fromProd.conversionFactor) }
    }
  }

  // 2) packs.yaml (fallback)
  const cfg = await loadPacks()
  const rule = cfg.packs.find(p => p.from === String(fromSku))
  if (rule) {
    return { source: 'packs.yaml', toSku: rule.to, factor: Number(rule.factor), rule }
  }

  // 3) body explícito (si viene completo y válido)
  if (bodyToSku && Number(bodyFactor) > 0) {
    return {
      source: 'body',
      toSku: String(bodyToSku),
      factor: Number(bodyFactor),
      rule: { from: fromSku, to: String(bodyToSku), factor: Number(bodyFactor) }
    }
  }

  return null
}

/** Ejecuta la conversión (usada por /convert y /from-receipt) */
async function doConvert({
  fromSku, toSku, qty, factor,
  userCode, comment, allowNegative = false,
  receiptItemId = null, lotId = null,
  resolvedMeta = null, // { source, rule }
  prisma
}) {
  // Productos
  const [fromProd, toProd] = await Promise.all([
    prisma.product.findUnique({ where: { supplierCode: String(fromSku) } }),
    prisma.product.findUnique({ where: { supplierCode: String(toSku) } })
  ])
  if (!fromProd) return { status: 400, error: `fromSku ${fromSku} no existe en catálogo` }
  if (!toProd)   return { status: 400, error: `toSku ${toSku} no existe en catálogo` }

  // Stock previo (packs)
  const fromBefore = await getStock(fromProd.id)
  if (!allowNegative && fromBefore < qty) {
    return { status: 400, error: `Stock insuficiente de ${fromSku}. Actual: ${fromBefore}, requerido: ${qty}` }
  }
  const toBefore = await getStock(toProd.id)

  const note = `CONVERT ${fromSku}→${toSku} x${qty} (factor ${factor})` +
               (receiptItemId ? ` [receiptItemId=${receiptItemId}${lotId ? `, lotId=${lotId}` : ''}]` : '')

  await prisma.$transaction(async (tx) => {
    await tx.stockMove.create({
      data: {
        productId: fromProd.id,
        kind: 'CONVERT_OUT',
        qty: -qty,
        userCode,
        note,
        ...(receiptItemId ? { receiptItemId } : {}),
        ...(lotId ? { lotId } : {})
      }
    })
    await tx.stockMove.create({
      data: {
        productId: toProd.id,
        kind: 'CONVERT_IN',
        qty: qty * factor,
        userCode,
        note,
        ...(receiptItemId ? { receiptItemId } : {}),
        ...(lotId ? { lotId } : {})
      }
    })
    await tx.auditLog.create({
      data: {
        userCode,
        module: 'inventory',
        action: 'convert',
        before: JSON.stringify({
          fromSku, toSku, qty, factor,
          source: resolvedMeta?.source ?? null,
          rule: resolvedMeta?.rule ?? null,
          receiptItemId: receiptItemId ?? null,
          lotId: lotId ?? null
        }),
        after: JSON.stringify({ fromDelta: -qty, toDelta: qty * factor }),
        comment: comment ? String(comment) : null
      }
    })
  })

  return {
    ok: true,
    from: { sku: fromSku, delta: -qty, stockBefore: fromBefore, stockAfter: fromBefore - qty },
    to:   { sku: toSku,   delta:  qty * factor, stockBefore: toBefore,  stockAfter: toBefore + (qty * factor) }
  }
}

// ====== ENDPOINTS ======

inventoryRouter.get('/api/inventory/version', (_req, res) => {
  res.json({ version: 'auto_convert_v5_db_first+resolve+from_receipt+revert_guard+stock_kardex' })
})

// Ver reglas de packs (y origen)
inventoryRouter.get('/api/inventory/packs', requireAuth, async (_req, res) => {
  const cfg = await loadPacks()
  res.json(cfg)
})

/** STOCK por SKU + breakdown + últimos movimientos */
inventoryRouter.get('/api/inventory/stock/:sku', requireAuth, async (req, res) => {
  if (!canViewInventory(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const sku = String(req.params.sku || '').trim()
  if (!sku) return res.status(400).json({ error: 'SKU requerido' })

  const p = await prisma.product.findUnique({ where: { supplierCode: sku } })
  if (!p) return res.status(404).json({ error: 'SKU no existe', sku })

  const agg = await prisma.stockMove.aggregate({ where: { productId: p.id }, _sum: { qty: true } })
  const byKind = await prisma.stockMove.groupBy({
    by: ['kind'],
    where: { productId: p.id },
    _sum: { qty: true }
  })
  const breakdown = Object.fromEntries(byKind.map(k => [k.kind, Number(k._sum.qty || 0)]))
  const stock = Number(agg._sum.qty || 0)

  const recent = await prisma.stockMove.findMany({
    where: { productId: p.id },
    orderBy: { id: 'desc' },
    take: Math.min(50, Number(req.query.limit || 20))
  })

  res.json({
    sku: p.supplierCode,
    productId: p.id,
    name: p.name,
    controlType: p.controlType,
    stock,
    breakdown,
    moves: recent
  })
})

/** Resumen (todos los productos con existencias calculadas) */
inventoryRouter.get('/api/inventory/summary', requireAuth, async (req, res) => {
  if (!assertAdminLike(req.user)) return res.status(403).json({ error: 'Solo ADMIN/SUPERSU' })
  const skuFilter = String(req.query.sku || '').trim() || null

  const groups = await prisma.stockMove.groupBy({ by: ['productId'], _sum: { qty: true } })
  if (!groups.length) return res.json({ items: [] })

  const prods = await prisma.product.findMany({
    where: { id: { in: groups.map(g => g.productId) } },
    select: { id: true, supplierCode: true, name: true, controlType: true }
  })
  const pMap = new Map(prods.map(p => [p.id, p]))

  let items = groups.map(g => {
    const p = pMap.get(g.productId)
    return {
      sku: p?.supplierCode || null,
      name: p?.name || null,
      controlType: p?.controlType || null,
      stock: Number(g._sum.qty || 0)
    }
  })

  if (skuFilter) items = items.filter(it => it.sku === skuFilter)
  items.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''))
  res.json({ items })
})

/** Kardex por SKU (orden cronológico) */
inventoryRouter.get('/api/inventory/kardex/:sku', requireAuth, async (req, res) => {
  if (!canViewInventory(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const sku = String(req.params.sku || '').trim()
  if (!sku) return res.status(400).json({ error: 'SKU requerido' })

  const p = await prisma.product.findUnique({ where: { supplierCode: sku } })
  if (!p) return res.status(404).json({ error: 'SKU no existe', sku })

  const items = await prisma.stockMove.findMany({
    where: { productId: p.id },
    orderBy: { createdAt: 'asc' }
  })
  res.json({ sku: p.supplierCode, name: p.name, items })
})

/** DEBUG: Resolver conversión sin ejecutar */
inventoryRouter.get('/api/inventory/convert/resolve', requireAuth, async (req, res) => {
  if (!assertAdminLike(req.user)) return res.status(403).json({ error: 'Solo ADMIN/SUPERSU' })
  const fromSku = String(req.query.fromSku || '').trim()
  if (!fromSku) return res.status(400).json({ error: 'fromSku requerido' })
  const bodyToSku   = req.query.toSku ? String(req.query.toSku) : null
  const bodyFactor  = req.query.factor ? Number(req.query.factor) : null
  const resolved = await resolveConversion({ fromSku, bodyToSku, bodyFactor })
  if (!resolved) return res.status(404).json({ error: `No hay conversión definida para ${fromSku}` })
  res.json({ ok: true, ruleUsed: resolved })
})

/** CONVERSIÓN PACKS → UNIDADES */
inventoryRouter.post('/api/inventory/convert', requireAuth, async (req, res) => {
  if (!assertAdminLike(req.user)) return res.status(403).json({ error: 'Solo ADMIN/SUPERSU' })

  const {
    fromSku, toSku: bodyToSku, qty: bodyQty, factor: bodyFactor,
    comment, allowNegative = false, receiptItemId = null, lotId = null
  } = req.body || {}
  const qty = Math.floor(Number(bodyQty || 0))
  if (!fromSku || qty <= 0) return res.status(400).json({ error: 'fromSku y qty > 0 requeridos' })

  const resolved = await resolveConversion({ fromSku, bodyToSku, bodyFactor })
  if (!resolved) {
    return res.status(400).json({ error: `No hay conversión definida para ${fromSku}. Define en Catálogo o packs.yaml, o envía toSku/factor.` })
  }

  try {
    const result = await doConvert({
      fromSku,
      toSku: resolved.toSku,
      qty,
      factor: Number(resolved.factor),
      userCode: req.user.code,
      comment,
      allowNegative,
      receiptItemId: receiptItemId ? Number(receiptItemId) : null,
      lotId: lotId ? Number(lotId) : null,
      resolvedMeta: { source: resolved.source, rule: resolved.rule },
      prisma
    })
    if (result?.error) return res.status(result.status || 400).json({ error: result.error })
    res.json({ ok: true, ruleUsed: { source: resolved.source, rule: resolved.rule }, ...result })
  } catch (e) {
    res.status(500).json({ error: 'Error en conversión', detail: String(e?.message || e) })
  }
})

/** AUTO-CONVERTIR DESDE UNA RECEPCIÓN */
inventoryRouter.post('/api/inventory/convert/from-receipt', requireAuth, async (req, res) => {
  if (!assertAdminLike(req.user)) return res.status(403).json({ error: 'Solo ADMIN/SUPERSU' })

  try {
    const { receiptItemId, qty: bodyQty, comment, allowNegative = false, toSku, factor } = req.body || {}
    const id = Number(receiptItemId || 0)
    const qty = Math.floor(Number(bodyQty || 0))
    if (!id || qty <= 0) return res.status(400).json({ error: 'receiptItemId y qty > 0 requeridos' })

    const item = await prisma.receiptItem.findUnique({
      where: { id },
      include: { product: true, lot: true }
    })
    if (!item || !item.product) return res.status(404).json({ error: 'ReceiptItem no existe o no tiene producto' })

    const fromSku = item.product.supplierCode
    const resolved = await resolveConversion({
      fromSku,
      bodyToSku: toSku || null,
      bodyFactor: factor || null
    })
    if (!resolved) return res.status(400).json({ error: `No hay conversión para ${fromSku}` })

    const result = await doConvert({
      fromSku,
      toSku: resolved.toSku,
      qty,
      factor: Number(resolved.factor),
      userCode: req.user.code,
      comment: comment ?? `Auto-convert from receiptItem ${id}`,
      allowNegative,
      receiptItemId: id,
      lotId: item.lot?.id ?? null,
      resolvedMeta: { source: resolved.source, rule: resolved.rule },
      prisma
    })
    if (result?.error) return res.status(result.status || 400).json({ error: result.error })

    res.json({
      ok: true,
      ruleUsed: { source: resolved.source, rule: resolved.rule },
      receiptItemId: id,
      lotId: item.lot?.id ?? null,
      ...result
    })
  } catch (e) {
    res.status(500).json({ error: 'Error en from-receipt', detail: String(e?.message || e) })
  }
})

/** LOG de conversiones */
inventoryRouter.get('/api/inventory/convert/log', requireAuth, async (req, res) => {
  if (!assertAdminLike(req.user)) return res.status(403).json({ error: 'Solo ADMIN/SUPERSU' })

  const limit = Math.min(200, Number(req.query.limit || 50))
  const skuFilter = String(req.query.sku || '').trim() || null

  const rows = await prisma.auditLog.findMany({
    where: { module: 'inventory', action: 'convert' },
    orderBy: { id: 'desc' },
    take: limit
  })

  const safeParse = (s) => { try { return JSON.parse(s || '{}') } catch { return {} } }

  let items = rows.map(r => {
    const before = safeParse(r.before)
    const after  = safeParse(r.after)
    return {
      id: r.id,
      createdAt: r.createdAt,
      userCode: r.userCode,
      fromSku: before.fromSku,
      toSku: before.toSku,
      qty: before.qty,
      factor: before.factor,
      source: before.source,
      receiptItemId: before.receiptItemId ?? null,
      lotId: before.lotId ?? null,
      fromDelta: after.fromDelta,
      toDelta: after.toDelta,
      comment: r.comment
    }
  })

  if (skuFilter) items = items.filter(it => it.fromSku === skuFilter || it.toSku === skuFilter)

  res.json({ items })
})

/** REVERTIR una conversión (con guard anti–doble revert) */
inventoryRouter.post('/api/inventory/convert/revert', requireAuth, async (req, res) => {
  if (!assertAdminLike(req.user)) return res.status(403).json({ error: 'Solo ADMIN/SUPERSU' })

  const { auditId, comment, allowNegative = false } = req.body || {}
  const id = Number(auditId || 0)
  if (!id) return res.status(400).json({ error: 'auditId requerido' })

  const log = await prisma.auditLog.findUnique({ where: { id } })
  if (!log || log.module !== 'inventory' || log.action !== 'convert') {
    return res.status(404).json({ error: 'Registro no es una conversión válida' })
  }

  // 🛡️ anti doble revert (idempotencia)
  const alreadyReverted = await prisma.auditLog.findFirst({
    where: {
      module: 'inventory',
      action: 'convert_revert',
      before: { contains: `"auditId":${id}` }
    }
  })
  if (alreadyReverted) {
    return res.status(409).json({
      error: 'Esta conversión ya fue revertida',
      revertAuditId: alreadyReverted.id
    })
  }

  const before = (() => { try { return JSON.parse(log.before || '{}') } catch { return {} } })()
  const fromSku = String(before.fromSku || '')
  const toSku   = String(before.toSku   || '')
  const qty     = Math.floor(Number(before.qty || 0))
  const factor  = Math.floor(Number(before.factor || 0))

  if (!fromSku || !toSku || qty <= 0 || factor <= 0) {
    return res.status(400).json({ error: 'El registro no contiene datos suficientes para revertir' })
    }

  const [fromProd, toProd] = await Promise.all([
    prisma.product.findUnique({ where: { supplierCode: fromSku } }),
    prisma.product.findUnique({ where: { supplierCode: toSku } })
  ])
  if (!fromProd || !toProd) {
    return res.status(404).json({ error: 'Productos de la conversión original ya no existen' })
  }

  const units = qty * factor
  const toStock = await getStock(toProd.id)
  if (!allowNegative && toStock < units) {
    return res.status(400).json({ error: `Stock insuficiente de ${toSku} para revertir. Actual: ${toStock}, requerido: ${units}` })
  }

  const note = `REVERT CONVERT ${fromSku}→${toSku} x${qty} (factor ${factor}) [auditId=${id}]`
  try {
    await prisma.$transaction(async (tx) => {
      await tx.stockMove.create({
        data: { productId: fromProd.id, kind: 'CONVERT_REVERT_IN', qty: qty, userCode: req.user.code, note }
      })
      await tx.stockMove.create({
        data: { productId: toProd.id, kind: 'CONVERT_REVERT_OUT', qty: -units, userCode: req.user.code, note }
      })
      await tx.auditLog.create({
        data: {
          userCode: req.user.code,
          module: 'inventory',
          action: 'convert_revert',
          before: JSON.stringify({ auditId: id, fromSku, toSku, qty, factor }),
          after: JSON.stringify({ fromDelta: qty, toDelta: -units }),
          comment: comment ? String(comment) : '(sin comentario)'
        }
      })
    })
  } catch (e) {
    return res.status(500).json({ error: 'Error revirtiendo conversión', detail: String(e?.message || e) })
  }

  res.json({ ok: true })
})

export default inventoryRouter

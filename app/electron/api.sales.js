// app/electron/api.sales.js
// Ventas: quote/commit + listado + detalle + moves
// Centavos + bloqueo isSellable=false + persistencia SalePromo(metaJson) y SaleLine(tagsJson)

import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import yaml from 'js-yaml'
import { PrismaClient } from '@prisma/client'

export const salesRouter = express.Router()
export default salesRouter

const prisma = new PrismaClient()

// ======== Auth / permisos ========
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  next()
}
const isCashier = (u) => u?.role === 'CAJERO'
const isAdmin   = (u) => u?.role === 'ADMIN'
const isSuperSU = (u) => u?.role === 'SUPERSU'
const canMakeSale = (u) => isCashier(u) || isAdmin(u) || isSuperSU(u)

// ======== Util ========
const nowCode = (prefix = 'SAL') => `${prefix}-${Date.now()}`
const toInt = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error('Valor numérico inválido')
  // si viene float (por error), lo redondeamos al entero más cercano
  return Math.round(n)
}

// ======== Promos (config/promos.yaml) ========
const CFG_DIR = path.resolve(process.cwd(), 'config')
const PROMOS_FILE = path.join(CFG_DIR, 'promos.yaml')

async function ensurePromosFile() {
  await fs.mkdir(CFG_DIR, { recursive: true })
  try { await fs.access(PROMOS_FILE) }
  catch {
    const seed = yaml.dump({ promos: [] }, { noRefs: true })
    await fs.writeFile(PROMOS_FILE, seed, 'utf8')
  }
}
const toDateOrNull = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}
function normalizePromo(p) {
  const mapType = (t) => {
    const x = String(t || '').toLowerCase()
    if (x === 'cantidad_regalo') return 'bogo'
    if (x === 'combo_regalo')    return 'combo_gift'
    if (x === 'porcentaje' || x === 'percent') return 'percent'
    if (x === 'monto' || x === 'amount')       return 'amount'
    return t
  }
  const id         = p.id
  const name       = p.name ?? p.nombre
  const type       = mapType(p.type ?? p.tipo)
  const enabled    = (p.enabled ?? p.habilitado ?? true) !== false
  const priority   = Number(p.priority ?? p.prioridad ?? 100)
  const combinable = Boolean(p.combinable ?? p.acumulable ?? true)

  const v = p.vigencia || {}
  const validFrom = toDateOrNull(p.validFrom ?? v.desde)
  const validTo   = toDateOrNull(p.validTo   ?? v.hasta)

  const uniquePerTicket = Boolean(p.uniquePerTicket ?? false)
  const maxPerTicket    = (p.maxPerTicket == null) ? null : Number(p.maxPerTicket)

  const condiciones = p.conditions ?? p.condiciones ?? {}
  const beneficio   = p.benefit    ?? p.beneficio   ?? {}

  const out = { id, name, type, enabled, priority, combinable, validFrom, validTo, uniquePerTicket, maxPerTicket }

  if (type === 'bogo') {
    out.matchTag = p.matchTag ?? condiciones.categoria
    out.buyQty   = Number(p.buyQty ?? condiciones.compra_min ?? 0)
    out.getQty   = Number(p.getQty ?? beneficio.gratis ?? 0)
  }
  if (type === 'combo_gift') {
    const items = Array.isArray(condiciones.items) ? condiciones.items : []
    out.requires = Array.isArray(p.requires) ? p.requires : items.map(it => ({ sku: it.sku, qty: Number(it.qty ?? 1) }))
    const gift = p.gift ?? (beneficio.item ? { sku: beneficio.item, name: beneficio.nombre, qty: beneficio.gratis } : {})
    out.gift = { sku: gift.sku, name: gift.name ?? gift.nombre ?? gift.sku, qty: Number(gift.qty ?? beneficio.gratis ?? 0) }
  }
  if (type === 'percent') {
    out.matchTag = p.matchTag ?? condiciones.categoria
    out.percent  = Number(p.percent ?? beneficio.porcentaje ?? 0)
  }
  if (type === 'amount') {
    out.matchTag = p.matchTag ?? condiciones.categoria
    // amount en **centavos**
    out.amount   = Number(p.amount ?? beneficio.monto ?? 0)
  }
  return out
}
function byPriority(a, b) { return (a.priority ?? 100) - (b.priority ?? 100) }
function inValidity(p, now = new Date()) {
  if (p.validFrom && now < p.validFrom) return false
  if (p.validTo && now > new Date(p.validTo.getTime())) return false
  return true
}
async function loadPromos() {
  await ensurePromosFile()
  const raw = await fs.readFile(PROMOS_FILE, 'utf8')
  const parsed = yaml.load(raw) || {}
  const list = Array.isArray(parsed.promos) ? parsed.promos : []
  const normalized = list.map(normalizePromo).filter(p => p.enabled)
  normalized.sort(byPriority)
  const now = new Date()
  return normalized.filter(p => inValidity(p, now))
}

// ======== Motor de promos (centavos) ========
function applyPromotions(cart, promos, ctx = {}) {
  const result = JSON.parse(JSON.stringify(cart || { lines: [] }))
  const applied = []
  const usedCount = new Map()
  let lockedByNonCombinable = false

  const findLinesByTag = (tag) => result.lines.filter(l => Array.isArray(l.tags) && l.tags.includes(tag))
  const countByTag = (tag) => findLinesByTag(tag).reduce((acc, l) => acc + toInt(l.qty || 0), 0)

  const addFreeLine = (sku, name, qty) => {
    if (!qty || qty <= 0) return
    let line = result.lines.find(l => l.sku === sku && toInt(l.unitPrice) === 0)
    if (!line) {
      line = { sku, name, qty: 0, unitPrice: 0, tags: ['promo:gift'] }
      result.lines.push(line)
    }
    line.qty = toInt(line.qty || 0) + toInt(qty)
  }
  const addDiscountLine = (name, amount) => {
    if (!amount || amount <= 0) return
    result.lines.push({
      sku: `DISC-${Math.random().toString(36).slice(2,8)}`,
      name, qty: 1, unitPrice: -Math.abs(toInt(amount)), tags: ['promo:discount']
    })
  }
  const findLineBySku = (sku) => result.lines.find(l => l.sku === sku)
  const getQty = (sku) => toInt(findLineBySku(sku)?.qty || 0)

  const capTimes = (promo, theoreticalTimes) => {
    let remaining = theoreticalTimes
    const used = usedCount.get(promo.id) || 0
    if (promo.uniquePerTicket) remaining = Math.min(remaining, 1 - used)
    if (promo.maxPerTicket != null) remaining = Math.min(remaining, promo.maxPerTicket - used)
    return Math.max(0, Math.floor(remaining))
  }

  for (const raw of promos) {
    if (lockedByNonCombinable) break
    const promo = normalizePromo(raw)
    if (!inValidity(promo, ctx.now || new Date())) continue

    if (promo.type === 'bogo') {
      const total = countByTag(promo.matchTag)
      const theoreticalBundles = Math.floor(total / (promo.buyQty + promo.getQty))
      const bundles = capTimes(promo, theoreticalBundles)
      if (bundles > 0) {
        const cheapest = findLinesByTag(promo.matchTag)
          .filter(l => toInt(l.qty) > 0)
          .sort((a, b) => toInt(a.unitPrice) - toInt(b.unitPrice))[0]
        if (cheapest) {
          const discount = toInt(cheapest.unitPrice) * toInt(promo.getQty) * bundles
          addDiscountLine(promo.name, discount)
          applied.push({ id: promo.id, name: promo.name, type: promo.type, amount: discount })
          usedCount.set(promo.id, (usedCount.get(promo.id) || 0) + bundles)
          if (!promo.combinable) lockedByNonCombinable = true
        }
      }
      continue
    }

    if (promo.type === 'combo_gift') {
      const theoreticalCombos = Math.min(...promo.requires.map(r =>
        Math.floor(getQty(r.sku) / toInt(r.qty || 1))
      ))
      const combos = capTimes(promo, theoreticalCombos)
      if (combos > 0) {
        addFreeLine(promo.gift.sku, promo.gift.name || promo.gift.sku, toInt(promo.gift.qty) * combos)
        applied.push({
          id: promo.id, name: promo.name, type: promo.type,
          gift: { sku: promo.gift.sku, qty: toInt(promo.gift.qty) * combos }
        })
        usedCount.set(promo.id, (usedCount.get(promo.id) || 0) + combos)
        if (!promo.combinable) lockedByNonCombinable = true
      }
      continue
    }

    if (promo.type === 'percent') {
      const lines = findLinesByTag(promo.matchTag)
      const base = lines.reduce((acc, l) => acc + (toInt(l.unitPrice) * toInt(l.qty)), 0)
      if (base > 0) {
        const times = capTimes(promo, 1)
        if (times > 0) {
          const disc = Math.round((base * Number(promo.percent || 0)) / 100)
          addDiscountLine(promo.name, disc)
          applied.push({ id: promo.id, name: promo.name, type: promo.type, amount: disc })
          usedCount.set(promo.id, (usedCount.get(promo.id) || 0) + times)
          if (!promo.combinable) lockedByNonCombinable = true
        }
      }
      continue
    }

    if (promo.type === 'amount') {
      const qty = countByTag(promo.matchTag)
      if (qty > 0) {
        const times = capTimes(promo, 1)
        if (times > 0) {
          addDiscountLine(promo.name, promo.amount)
          applied.push({ id: promo.id, name: promo.name, type: promo.type, amount: toInt(promo.amount) })
          usedCount.set(promo.id, (usedCount.get(promo.id) || 0) + times)
          if (!promo.combinable) lockedByNonCombinable = true
        }
      }
      continue
    }
  }

  return { cart: result, applied }
}

function calcTotals(cart) {
  const lines = Array.isArray(cart?.lines) ? cart.lines : []
  const gross = lines.filter(l => toInt(l.unitPrice) > 0)
                     .reduce((acc, l) => acc + (toInt(l.unitPrice) * toInt(l.qty)), 0)
  const disc  = lines.filter(l => toInt(l.unitPrice) < 0)
                     .reduce((acc, l) => acc + (toInt(l.unitPrice) * toInt(l.qty)), 0)
  const total = lines.reduce((acc, l) => acc + (toInt(l.unitPrice) * toInt(l.qty)), 0)
  return {
    totalGross: gross,
    totalDiscount: Math.abs(disc),
    totalNet: total,
    linesCount: lines.length
  }
}

// ======== Helpers ========

// Bloqueo: ningún SKU con isSellable=false puede estar en el carrito
async function assertNoNonSellable(lines) {
  const skus = [...new Set(
    (lines || []).map(l => String(l.sku || '').trim()).filter(Boolean)
  )]
  if (!skus.length) return

  const prods = await prisma.product.findMany({
    where: { supplierCode: { in: skus } },
    select: { supplierCode: true, name: true, isSellable: true }
  })
  const map = new Map(prods.map(p => [p.supplierCode, p]))

  const bad = []
  for (const l of lines) {
    const sku = String(l.sku || '').trim()
    if (!sku) continue
    const p = map.get(sku)
    if (p && p.isSellable === false) bad.push({ sku, name: p.name })
  }
  if (bad.length) {
    const err = new Error('SKU no vendible en POS')
    err.status = 400
    err.payload = { error: 'SKU no vendible en POS', items: bad }
    throw err
  }
}

// Descarga básica de inventario (venta_directa / unitarios)
// Los regalos $0 SÍ descuentan inventario.
async function applyInventoryBasic({ sale, lines, userCode, prisma }) {
  const summary = { made: 0, skipped: 0, warnings: [] }
  for (const l of lines) {
    if ((toInt(l.unitPrice) ?? 0) < 0) { summary.skipped++; continue } // línea de descuento
    const sku = String(l.sku || '').trim()
    const qty = toInt(l.qty || 0)
    if (!sku || qty <= 0) { summary.skipped++; continue }

    const product = await prisma.product.findUnique({ where: { supplierCode: sku } })
    if (!product) { summary.warnings.push(`SKU ${l.sku} no existe en catálogo`); summary.skipped++; continue }
    if (product.controlType === 'tecnico_helado' || product.controlType === 'tecnico_topping') {
      summary.skipped++; continue
    }
    await prisma.stockMove.create({
      data: { productId: product.id, kind: 'SALE', qty: -qty, userCode, note: `SALE ${sale.id} ${sku}` }
    })
    summary.made++
  }
  return summary
}

// ======== Rutas ========

// Presupuesto (quote)
salesRouter.post('/api/sales/quote', requireAuth, async (req, res) => {
  const { cart } = req.body || {}
  if (!canMakeSale(req.user)) return res.status(403).json({ error: 'Sin permiso para ventas' })
  if (!cart || !Array.isArray(cart.lines)) return res.status(400).json({ error: 'Body.cart.lines requerido' })

  try {
    await assertNoNonSellable(cart.lines)
    const promos  = await loadPromos()
    const applied = applyPromotions(cart, promos, { now: new Date() })

    // Revalidar por si alguna promo agregara algo inválido
    await assertNoNonSellable(applied.cart.lines)

    const totals = calcTotals(applied.cart) // en centavos
    res.json({ cart: applied.cart, applied: applied.applied, totals, currency: 'MXN' })
  } catch (e) {
    if (e?.status) return res.status(e.status).json(e.payload || { error: e.message })
    res.status(500).json({ error: 'Error en quote', detail: String(e?.message || e) })
  }
})

// Guardar venta (commit) + Kardex
salesRouter.post('/api/sales/commit', requireAuth, async (req, res) => {
  const { cart, comment } = req.body || {}
  if (!canMakeSale(req.user)) return res.status(403).json({ error: 'Sin permiso para ventas' })
  if (!cart || !Array.isArray(cart.lines)) return res.status(400).json({ error: 'Body.cart.lines requerido' })

  try {
    // 1) Validación de vendibles
    await assertNoNonSellable(cart.lines)

    // 2) Promos
    const promos  = await loadPromos()
    const applied = applyPromotions(cart, promos, { now: new Date() })

    // 3) Revalidar (regalos/mixes)
    await assertNoNonSellable(applied.cart.lines)

    // 4) Totales en centavos
    const totals = calcTotals(applied.cart)

    // 5) Crear Sale + líneas + promos en una transacción
    const sale = await prisma.$transaction(async (tx) => {
      const code = nowCode('SAL')
      const created = await tx.sale.create({
        data: {
          code,
          userCode: req.user.code,
          currency: 'MXN',
          totalGross: totals.totalGross,
          totalDiscount: totals.totalDiscount,
          totalNet: totals.totalNet,
          lines: {
            create: applied.cart.lines.map(l => ({
              sku: String(l.sku),
              name: String(l.name ?? l.sku),
              qty: toInt(l.qty || 0),
              unitPrice: toInt(l.unitPrice || 0),         // centavos
              isGift: Array.isArray(l.tags) && l.tags.includes('promo:gift'),
              tagsJson: JSON.stringify(l.tags || [])
            }))
          },
          promos: {
            create: (applied.applied || []).map(p => ({
              ruleId: String(p.id || ''),
              name: String(p.name || ''),
              amount: toInt(p.amount || 0),               // centavos
              metaJson: JSON.stringify(p.gift ? { giftSku: p.gift.sku, giftQty: p.gift.qty } : {})
            }))
          }
        },
        include: { lines: true, promos: true }
      })
      return created
    })

    // 6) Inventario (unitarios / venta_directa + regalos $0)
    let inventory = { made: 0, skipped: 0, warnings: [] }
    try {
      inventory = await applyInventoryBasic({ sale, lines: sale.lines, userCode: req.user.code, prisma })
    } catch (e) {
      inventory.warnings.push('applyInventoryBasic error: ' + (e?.message || e))
    }

    // 7) Bitácora
    try {
      await prisma.auditLog.create({
        data: {
          userCode: req.user.code, module: 'sales', action: 'commit',
          before: JSON.stringify({ cart }),
          after:  JSON.stringify({ saleId: sale.id, code: sale.code, applied: sale.promos, totals, inventory }),
          comment: comment ? String(comment) : null
        }
      })
    } catch {}

    res.json({ ok: true, saleId: sale.id, code: sale.code, totals, applied: sale.promos, inventory, currency: 'MXN' })
  } catch (e) {
    if (e?.status) return res.status(e.status).json(e.payload || { error: e.message })
    res.status(500).json({ error: 'Error al guardar venta', detail: String(e?.message || e) })
  }
})

// Listado simple
salesRouter.get('/api/sales', requireAuth, async (req, res) => {
  if (!canMakeSale(req.user)) return res.status(403).json({ error: 'Sin permiso para ventas' })
  const limit = Math.min(100, Number(req.query.limit || 20))
  const rows = await prisma.sale.findMany({ orderBy: { id: 'desc' }, take: limit })
  res.json({ items: rows })
})

// Detalle con líneas y promos
salesRouter.get('/api/sales/:id', requireAuth, async (req, res) => {
  if (!canMakeSale(req.user)) return res.status(403).json({ error: 'Sin permiso para ventas' })
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' })

  const sale = await prisma.sale.findUnique({ where: { id } })
  if (!sale) return res.status(404).json({ error: 'No existe' })

  const [lines, promos] = await Promise.all([
    prisma.saleLine.findMany({ where: { saleId: id }, orderBy: { id: 'asc' } }),
    prisma.salePromo.findMany({ where: { saleId: id }, orderBy: { id: 'asc' } })
  ])
  res.json({ sale, lines, promos })
})

// Movimientos de inventario por venta
salesRouter.get('/api/sales/:id/moves', requireAuth, async (req, res) => {
  if (!canMakeSale(req.user)) return res.status(403).json({ error: 'Sin permiso para ventas' })
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' })
  const items = await prisma.stockMove.findMany({
    where: { note: { contains: `SALE ${id}` } },
    orderBy: { id: 'asc' }
  })
  res.json({ items })
})

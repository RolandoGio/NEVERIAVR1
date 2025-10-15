// app/electron/api.promos.js
import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import yaml from 'js-yaml'

export const promosRouter = express.Router()

// ------ Auth (usa req.user del inyector global) ------
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  next()
}
const isAdmin    = (u) => u?.role === 'ADMIN'
const isSuperSU  = (u) => u?.role === 'SUPERSU'
const isAdminOrSU = (u) => isAdmin(u) || isSuperSU(u)

// ------ Ruta de archivo de configuración ------
const CFG_DIR = path.resolve(process.cwd(), 'config')
const PROMOS_FILE = path.join(CFG_DIR, 'promos.yaml')

// ---------- helpers ----------
async function ensureConfigFile() {
  try {
    await fs.mkdir(CFG_DIR, { recursive: true })
    await fs.access(PROMOS_FILE)
  } catch {
    const seed = yaml.dump({ promos: [] }, { noRefs: true })
    await fs.writeFile(PROMOS_FILE, seed, 'utf8')
  }
}
const toDateOrNull = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

// Normaliza claves ES/EN y mapea tipos
function normalizePromo(p) {
  const mapType = (t) => {
    const x = String(t || '').toLowerCase()
    if (x === 'cantidad_regalo') return 'bogo'
    if (x === 'combo_regalo') return 'combo_gift'
    if (x === 'porcentaje' || x === 'percent') return 'percent'
    if (x === 'monto' || x === 'amount') return 'amount'
    return t
  }
  const id = p.id
  const name = p.name ?? p.nombre
  const type = mapType(p.type ?? p.tipo)
  const enabled = (p.enabled ?? p.habilitado ?? true) !== false
  const priority = Number(p.priority ?? p.prioridad ?? 100)
  const combinable = Boolean(p.combinable ?? p.acumulable ?? true)

  // vigencia
  const v = p.vigencia || {}
  const validFrom = toDateOrNull(p.validFrom ?? v.desde)
  const validTo = toDateOrNull(p.validTo ?? v.hasta)

  // límites por ticket
  const uniquePerTicket = Boolean(p.uniquePerTicket ?? p.unicaPorTicket ?? false)
  const maxPerTicket = Number.isFinite(Number(p.maxPerTicket ?? p.maxPorTicket))
    ? Number(p.maxPerTicket ?? p.maxPorTicket)
    : null

  const condiciones = p.conditions ?? p.condiciones ?? {}
  const beneficio = p.benefit ?? p.beneficio ?? {}

  // Campos comunes mapeados por tipo
  const out = { id, name, type, enabled, priority, combinable, validFrom, validTo, uniquePerTicket, maxPerTicket }

  if (type === 'bogo') {
    out.matchTag = p.matchTag ?? condiciones.categoria
    out.buyQty = Number(p.buyQty ?? condiciones.compra_min ?? 0)
    out.getQty = Number(p.getQty ?? beneficio.gratis ?? 0)
  }

  if (type === 'combo_gift') {
    const items = Array.isArray(condiciones.items) ? condiciones.items : []
    out.requires = Array.isArray(p.requires) ? p.requires : items.map(it => ({
      sku: it.sku,
      qty: Number(it.qty ?? 1)
    }))
    const gift = p.gift ?? (beneficio.item ? { sku: beneficio.item, name: beneficio.nombre, qty: beneficio.gratis } : {})
    out.gift = {
      sku: gift.sku,
      name: gift.name ?? gift.nombre ?? gift.sku,
      qty: Number(gift.qty ?? beneficio.gratis ?? 0)
    }
  }

  if (type === 'percent') {
    out.matchTag = p.matchTag ?? condiciones.categoria
    out.percent = Number(p.percent ?? beneficio.porcentaje ?? 0)
  }

  if (type === 'amount') {
    out.matchTag = p.matchTag ?? condiciones.categoria
    out.amount = Number(p.amount ?? beneficio.monto ?? 0)
  }

  return out
}

function inValidity(p, now = new Date()) {
  if (p.validFrom && now < p.validFrom) return false
  if (p.validTo && now > new Date(p.validTo.getTime())) return false
  return true
}

function byPriority(a, b) {
  return (a.priority ?? 100) - (b.priority ?? 100)
}

async function loadPromos() {
  await ensureConfigFile()
  const raw = await fs.readFile(PROMOS_FILE, 'utf8')
  const parsed = yaml.load(raw) || {}
  const list = Array.isArray(parsed.promos) ? parsed.promos : []
  const normalized = list.map(normalizePromo).filter(p => p.enabled)
  normalized.sort(byPriority)
  const now = new Date()
  return normalized.filter(p => inValidity(p, now))
}

async function savePromos(newPromos) {
  await ensureConfigFile()
  const y = yaml.dump({ promos: newPromos }, { noRefs: true, lineWidth: 120 })
  await fs.writeFile(PROMOS_FILE, y, 'utf8')
}

// Validación
function validatePromos(promos) {
  const ids = new Set()
  for (const raw of promos) {
    const p = normalizePromo(raw)
    if (!p.id || typeof p.id !== 'string') throw new Error('Cada promo requiere id:string')
    if (ids.has(p.id)) throw new Error(`Promo duplicada id=${p.id}`)
    ids.add(p.id)
    if (!p.type) throw new Error(`Promo ${p.id} sin tipo`)
    if (!p.name) throw new Error(`Promo ${p.id} sin nombre/name`)

    if (p.type === 'bogo') {
      if (!p.matchTag) throw new Error(`Promo ${p.id}: falta matchTag/categoria`)
      if (!(p.buyQty > 0 && p.getQty > 0)) throw new Error(`Promo ${p.id}: buyQty/compra_min y getQty/gratis deben ser > 0`)
    }
    if (p.type === 'combo_gift') {
      if (!Array.isArray(p.requires) || p.requires.length === 0) throw new Error(`Promo ${p.id}: requires/items vacío`)
      if (!p.gift?.sku || !(p.gift?.qty > 0)) throw new Error(`Promo ${p.id}: gift.sku y gift.qty requeridos`)
    }
    if (p.type === 'percent') {
      if (!p.matchTag || !(p.percent > 0)) throw new Error(`Promo ${p.id}: percent y matchTag requeridos`)
    }
    if (p.type === 'amount') {
      if (!p.matchTag || !(p.amount > 0)) throw new Error(`Promo ${p.id}: amount y matchTag requeridos`)
    }
  }
}

// ------ Motor de aplicación ------
function applyPromotions(cart, promos, ctx = {}) {
  const result = JSON.parse(JSON.stringify(cart || { lines: [] }))
  const applied = []
  let lockedByNonCombinable = false

  // control de usos por ticket
  const usedByPromo = new Map()
  const getRemaining = (p) => {
    const max = p.uniquePerTicket ? 1 : (Number.isFinite(p.maxPerTicket) ? p.maxPerTicket : Infinity)
    const used = usedByPromo.get(p.id) || 0
    return Math.max(0, max - used)
  }
  const addUses = (p, n) => {
    const used = usedByPromo.get(p.id) || 0
    usedByPromo.set(p.id, used + n)
  }

  const findLinesByTag = (tag) =>
    result.lines.filter(l => Array.isArray(l.tags) && l.tags.includes(tag))

  const countByTag = (tag) =>
    findLinesByTag(tag).reduce((acc, l) => acc + (l.qty || 0), 0)

  const addFreeLine = (sku, name, qty) => {
    if (!qty || qty <= 0) return
    let line = result.lines.find(l => l.sku === sku && l.unitPrice === 0)
    if (!line) {
      line = { sku, name, qty: 0, unitPrice: 0, tags: ['promo:gift'] }
      result.lines.push(line)
    }
    line.qty += qty
  }

  const addDiscountLine = (name, amount) => {
    if (!amount || amount <= 0) return
    result.lines.push({
      sku: `DISC-${Math.random().toString(36).slice(2, 8)}`,
      name,
      qty: 1,
      unitPrice: -Math.abs(amount),
      tags: ['promo:discount']
    })
  }

  const findLineBySku = (sku) => result.lines.find(l => l.sku === sku)
  const getQty = (sku) => (findLineBySku(sku)?.qty || 0)

  for (const raw of promos) {
    if (lockedByNonCombinable) break
    const promo = normalizePromo(raw)
    if (!inValidity(promo, ctx.now || new Date())) continue

    // ---- BOGO ----
    if (promo.type === 'bogo') {
      const total = countByTag(promo.matchTag)
      let bundles = Math.floor(total / (promo.buyQty + promo.getQty))
      if (bundles <= 0) continue
      // limitar por ticket
      bundles = Math.min(bundles, getRemaining(promo))
      if (bundles <= 0) continue

      const candidates = findLinesByTag(promo.matchTag)
        .filter(l => l.qty > 0)
        .sort((a, b) => a.unitPrice - b.unitPrice)
      if (!candidates.length) continue
      const cheapest = candidates[0]
      const discount = cheapest.unitPrice * promo.getQty * bundles
      addDiscountLine(promo.name, discount)
      applied.push({ id: promo.id, name: promo.name, type: promo.type, amount: discount })
      addUses(promo, bundles)
      if (!promo.combinable) lockedByNonCombinable = true
      continue
    }

    // ---- Combo regalo ----
    if (promo.type === 'combo_gift') {
      let combos = Math.min(
        ...promo.requires.map(r => Math.floor(getQty(r.sku) / (Number(r.qty || 1))))
      )
      if (combos <= 0) continue
      combos = Math.min(combos, getRemaining(promo))
      if (combos <= 0) continue

      addFreeLine(promo.gift.sku, promo.gift.name || promo.gift.sku, promo.gift.qty * combos)
      applied.push({ id: promo.id, name: promo.name, type: promo.type, gift: { sku: promo.gift.sku, qty: promo.gift.qty * combos } })
      addUses(promo, combos)
      if (!promo.combinable) lockedByNonCombinable = true
      continue
    }

    // ---- % por tag ----
    if (promo.type === 'percent') {
      if (getRemaining(promo) <= 0) continue
      const lines = findLinesByTag(promo.matchTag)
      const base = lines.reduce((acc, l) => acc + (l.unitPrice * l.qty), 0)
      if (base > 0) {
        const disc = (base * promo.percent) / 100
        addDiscountLine(promo.name, disc)
        applied.push({ id: promo.id, name: promo.name, type: promo.type, amount: disc })
        addUses(promo, 1)
        if (!promo.combinable) lockedByNonCombinable = true
      }
      continue
    }

    // ---- monto fijo por tag ----
    if (promo.type === 'amount') {
      if (getRemaining(promo) <= 0) continue
      const qty = countByTag(promo.matchTag)
      if (qty > 0) {
        addDiscountLine(promo.name, promo.amount)
        applied.push({ id: promo.id, name: promo.name, type: promo.type, amount: promo.amount })
        addUses(promo, 1)
        if (!promo.combinable) lockedByNonCombinable = true
      }
      continue
    }
  }

  return { cart: result, applied }
}

// ----------------- Rutas -----------------
promosRouter.get('/api/promos', requireAuth, async (_req, res) => {
  const promos = await loadPromos()
  res.json({ promos })
})

promosRouter.post('/api/promos', requireAuth, async (req, res) => {
  const user = req.user
  if (!isAdminOrSU(user)) return res.status(403).json({ error: 'Solo ADMIN/SUPERSU pueden editar promos' })
  const { promos } = req.body || {}
  if (!Array.isArray(promos)) return res.status(400).json({ error: 'Body.promos debe ser array' })
  try {
    validatePromos(promos)
    await savePromos(promos)
    res.json({ ok: true, count: promos.length })
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) })
  }
})

// sandbox: probar aplicación contra un carrito in-memory
promosRouter.post('/api/promos/apply', requireAuth, async (req, res) => {
  const { cart } = req.body || {}
  if (!cart || !Array.isArray(cart.lines)) return res.status(400).json({ error: 'Body.cart.lines requerido' })
  const promos = await loadPromos()
  const out = applyPromotions(cart, promos, { now: new Date() })
  res.json(out)
})

// ---- EXPORTS para que otros módulos (ventas) usen el motor ----
export { loadPromos, applyPromotions }

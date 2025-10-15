// app/electron/api.tech.js
import express from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
export const techRouter = express.Router()

// --- Auth (usa req.user del inyector global) ---
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  next()
}
const isAdminOrSU = (u) => u?.role === 'ADMIN' || u?.role === 'SUPERSU'
const isSuperSU   = (u) => u?.role === 'SUPERSU'
const isCashier   = (u) => u?.role === 'CAJERO'

// --- Helpers config ---
async function getConfigNumber(key, fallback) {
  try {
    const kv = await prisma.configKV.findUnique({ where: { key } })
    const n = parseInt(kv?.value ?? '')
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function assertKindMatchesProduct(product, kind) {
  if (kind === 'ICECREAM' && product.controlType !== 'tecnico_helado') {
    throw new Error('Producto no es de tipo tecnico_helado')
  }
  if (kind === 'TOPPING' && product.controlType !== 'tecnico_topping') {
    throw new Error('Producto no es de tipo tecnico_topping')
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const daysBetween = (from, to = Date.now()) =>
  (to - new Date(from).getTime()) / MS_PER_DAY

// Audit helper (permite pasar tx opcional)
async function logTechAction({ client = prisma, userCode, action, techOpenId, before, after, comment }) {
  const wrap = (obj) => (obj == null ? null : JSON.stringify({ ref: { techOpenId }, data: obj }))
  return client.auditLog.create({
    data: {
      userCode,
      module: 'inventory.tech',
      action,
      before: wrap(before),
      after: wrap(after),
      comment: comment ?? null,
    },
  })
}

// ====== Presets (para UI) ======
const PRESET_CLOSE = [
  'Cierre fin de día',
  'Envase agotado',
  'Avería / derrame',
  'Reemplazo de producto',
  'Cierre por cambio de turno',
]
const PRESET_REOPEN = [
  'Cierre por error',
  'Conteo mal registrado',
  'Se detectó apertura activa duplicada',
  'Ajuste por auditoría',
]
const PRESET_DELETE = [
  'Apertura duplicada',
  'Producto equivocado',
  'Registro de prueba/erróneo',
  'No debió abrirse (cancelado)',
]

techRouter.get('/api/tech/_presets', requireAuth, async (_req, res) => {
  res.json({ close: PRESET_CLOSE, reopen: PRESET_REOPEN, remove: PRESET_DELETE })
})

// ===============================
// Listar aperturas (filtros)
// ===============================
techRouter.get('/api/tech', requireAuth, async (req, res) => {
  const { status, kind, productId, limit } = req.query
  const where = {
    ...(status ? { status: String(status).toUpperCase() } : {}),
    ...(kind ? { kind: String(kind).toUpperCase() } : {}),
    ...(productId ? { productId: Number(productId) } : {}),
  }
  const take = Math.min(100, Number(limit || 30))
  const items = await prisma.techOpen.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: { product: true, presentation: true, lot: true },
  })
  res.json(items)
})

// ===============================
// Listar sólo abiertas
// ===============================
techRouter.get('/api/tech/active', requireAuth, async (req, res) => {
  const { kind, productId } = req.query
  const where = {
    status: 'OPEN',
    ...(kind ? { kind: String(kind).toUpperCase() } : {}),
    ...(productId ? { productId: Number(productId) } : {}),
  }
  const items = await prisma.techOpen.findMany({
    where,
    orderBy: { openedAt: 'desc' },
    include: { product: true, presentation: true, lot: true },
  })
  res.json(items)
})

// ===============================
// Detalle de una apertura
// ===============================
techRouter.get('/api/tech/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const item = await prisma.techOpen.findUnique({
    where: { id },
    include: {
      product: true,
      presentation: true,
      lot: true,
      counterLogs: { orderBy: { createdAt: 'desc' }, take: 100 },
    },
  })
  if (!item) return res.status(404).json({ error: 'No existe' })
  res.json(item)
})

// ===============================
// Logs de contador
// ===============================
techRouter.get('/api/tech/:id/logs', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const t = await prisma.techOpen.findUnique({ where: { id } })
  if (!t) return res.status(404).json({ error: 'No existe' })
  const logs = await prisma.techCounterLog.findMany({
    where: { techOpenId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json({ techOpen: { id: t.id, productId: t.productId, kind: t.kind, status: t.status }, logs })
})

// ===============================
// Historial de acciones (audit)
// ===============================
techRouter.get('/api/tech/:id/actions', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const exists = await prisma.techOpen.findFirst({ where: { id } })
  if (!exists) return res.status(404).json({ error: 'No existe' })
  const needle = `"techOpenId":${id}`
  const rows = await prisma.auditLog.findMany({
    where: { module: 'inventory.tech', OR: [{ before: { contains: needle } }, { after: { contains: needle } }] },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const parsed = rows.map(r => {
    const tryParse = (s) => { try { return s ? JSON.parse(s) : null } catch { return null } }
    return { id: r.id, action: r.action, userCode: r.userCode, comment: r.comment, createdAt: r.createdAt, before: tryParse(r.before), after: tryParse(r.after) }
  })
  res.json({ actions: parsed })
})

// ===============================
// Política de cierre (para doble aviso en UI)
// GET /api/tech/:id/close-policy
// ===============================
techRouter.get('/api/tech/:id/close-policy', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const t = await prisma.techOpen.findUnique({ where: { id } })
  if (!t) return res.status(404).json({ error: 'No existe' })

  if (t.kind !== 'ICECREAM') {
    return res.json({ minDays: null, daysOpen: null, early: false })
  }
  const minDays = await getConfigNumber('tech.ice.minDays', 30)
  const daysOpen = daysBetween(t.openedAt)
  const early = daysOpen < (minDays - 1e-9)
  res.json({ minDays, daysOpen, early })
})

// ===============================
// Abrir (helado o topping)
//  - impide duplicados por (productId, kind) con status OPEN (409)
// ===============================
techRouter.post('/api/tech/open', requireAuth, async (req, res) => {
  const user = req.user
  const { productId, presentationId, lotId, kind, comment } = req.body || {}
  if (!productId || !kind) return res.status(400).json({ error: 'productId y kind son requeridos' })
  const K = String(kind).toUpperCase()
  if (K !== 'ICECREAM' && K !== 'TOPPING') return res.status(400).json({ error: 'kind inválido (ICECREAM|TOPPING)' })

  try {
    const product = await prisma.product.findUnique({ where: { id: Number(productId) } })
    if (!product) return res.status(400).json({ error: 'Producto no encontrado' })
    assertKindMatchesProduct(product, K)

    // 1 sola apertura abierta por producto+tipo
    const already = await prisma.techOpen.findFirst({
      where: { productId: product.id, kind: K, status: 'OPEN' },
      include: { presentation: true }
    })
    if (already) {
      res.setHeader('X-Open-Conflict', String(already.id))
      return res.status(409).json({
        error: 'Ya existe una apertura abierta para este producto/tipo. Cierre la actual antes de abrir otra.',
        open: {
          id: already.id,
          openedAt: already.openedAt,
          openedBy: already.openedBy,
          presentationName: already.presentation?.name || 'default',
          counter: already.counter
        }
      })
    }

    let pres = null
    if (presentationId) {
      pres = await prisma.presentation.findUnique({ where: { id: Number(presentationId) } })
      if (!pres || pres.productId !== product.id) {
        return res.status(400).json({ error: 'Presentación no corresponde al producto' })
      }
    }

    let lot = null
    if (lotId) {
      lot = await prisma.lot.findUnique({ where: { id: Number(lotId) } })
      if (!lot || lot.productId !== product.id) {
        return res.status(400).json({ error: 'Lote no corresponde al producto' })
      }
    }

    const opened = await prisma.techOpen.create({
      data: {
        productId: product.id,
        presentationId: pres ? pres.id : null,
        lotId: lot ? lot.id : null,
        kind: K,
        status: 'OPEN',
        openedBy: user.code,
        openedAt: new Date(),
        commentOpen: comment ? String(comment) : null,
        counter: 0,
      },
    })

    await logTechAction({ userCode: user.code, action: 'open', techOpenId: opened.id, before: null, after: opened, comment: comment ? String(comment) : null })

    res.json(opened)
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) })
  }
})

// ===============================
// Ajuste de contador (solo ADMIN/SUPERSU)
// ===============================
techRouter.patch('/api/tech/:id/count', requireAuth, async (req, res) => {
  const user = req.user
  if (!isAdminOrSU(user)) {
    return res.status(403).json({ error: 'Solo ADMIN/SUPERSU pueden ajustar el contador' })
  }

  const id = Number(req.params.id)
  let { delta, comment } = req.body || {}
  delta = Number(delta)

  if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'delta debe ser un entero distinto de 0' })

  const t = await prisma.techOpen.findUnique({ where: { id }, include: { presentation: true } })
  if (!t) return res.status(404).json({ error: 'Apertura no existe' })
  if (t.status !== 'OPEN') return res.status(400).json({ error: 'La apertura está cerrada' })

  const beforeCounter = t.counter
  let updated
  try {
    updated = await prisma.$transaction(async (tx) => {
      const u = await tx.techOpen.update({
        where: { id },
        data: { counter: { increment: delta } },
      })
      await tx.techCounterLog.create({
        data: { techOpenId: id, delta, userCode: user.code, comment: comment ? String(comment) : null },
      })
      return u
    }, { timeout: 10000 })
  } catch (e) {
    return res.status(408).json({ error: 'Tiempo de transacción excedido. Intenta de nuevo.', code: 'TX_TIMEOUT' })
  }

  // Advertencia suave si TOPPING excede tope
  if (t.kind === 'TOPPING') {
    const maxUses = t.presentation?.toppingMaxUses
    if (typeof maxUses === 'number' && updated.counter > maxUses) {
      res.setHeader('X-Warning', `Usos (${updated.counter}) superan el tope (${maxUses}) para este envase.`)
    }
  }

  try {
    await logTechAction({
      userCode: user.code,
      action: 'count',
      techOpenId: id,
      before: { counter: beforeCounter },
      after: { counter: updated.counter, delta },
      comment: comment ? String(comment) : null,
    })
  } catch {}

  res.json(updated)
})

// ===============================
// Cerrar apertura
// - helado < minDays: cajero debe comentar (admin/SU autocomenta)
// - helado ≥ minDays: comentario opcional
// - SUPERSU puede simular madurez con ?simulateMature=1 (no altera fechas)
// ===============================
techRouter.patch('/api/tech/:id/close', requireAuth, async (req, res) => {
  const user = req.user
  const id = Number(req.params.id)
  let { comment } = req.body || {}
  const t = await prisma.techOpen.findUnique({ where: { id } })
  if (!t) return res.status(404).json({ error: 'Apertura no existe' })
  if (t.status !== 'OPEN') return res.status(400).json({ error: 'Ya estaba cerrada' })

  const simulateMature = isSuperSU(user) && (String(req.query.simulateMature || '') === '1')
  let autoComment = null

  if (t.kind === 'ICECREAM') {
    const minDays = await getConfigNumber('tech.ice.minDays', 30)
    const daysOpen = daysBetween(t.openedAt)
    const matured = simulateMature ? true : (daysOpen >= (minDays - 1e-9))
    const early   = !matured

    if (early) {
      if (isCashier(user) && !String(comment || '').trim()) {
        return res.status(400).json({ error: `Cierre anticipado (< ${minDays} días). Comentario obligatorio para cajero.` })
      }
      if (isAdminOrSU(user) && !String(comment || '').trim()) {
        autoComment = `Cierre anticipado por ${user.role}`
      }
    } else if (simulateMature) {
      // anotar simulación
      autoComment = String(comment || '').trim() || `[SIMULATE_MATURE] Cierre tratado como ≥ ${minDays} días por SUPERSU`
    }
  }

  const updated = await prisma.techOpen.update({
    where: { id },
    data: {
      status: 'CLOSED',
      closedBy: user.code,
      closedAt: new Date(),
      commentClose: String(comment || autoComment || '').trim() || null,
    },
  })

  await logTechAction({
    userCode: user.code,
    action: 'close',
    techOpenId: id,
    before: { status: 'OPEN' },
    after: { status: 'CLOSED' },
    comment: String(comment || autoComment || '').trim() || null,
  })

  res.json(updated)
})

// ===============================
// Reabrir apertura
//  - Cajero: comentario obligatorio
//  - Admin/SUPERSU: comentario opcional
//  - BLOQUEA si ya hay otra apertura OPEN del mismo producto/tipo (409)
// ===============================
techRouter.patch('/api/tech/:id/reopen', requireAuth, async (req, res) => {
  const user = req.user
  const id = Number(req.params.id)
  let { comment } = req.body || {}

  if (isCashier(user) && !String(comment || '').trim()) {
    return res.status(400).json({ error: 'Comentario obligatorio para reabrir (cajero).' })
  }
  let autoComment = null
  if (isAdminOrSU(user) && !String(comment || '').trim()) {
    autoComment = `Reabierto por ${user.role}`
  }

  const t = await prisma.techOpen.findUnique({ where: { id } })
  if (!t) return res.status(404).json({ error: 'Apertura no existe' })
  if (t.status !== 'CLOSED') return res.status(400).json({ error: 'La apertura no está cerrada' })

  // ¿Ya hay una OPEN para el mismo producto+tipo?
  const conflict = await prisma.techOpen.findFirst({
    where: {
      productId: t.productId,
      kind: t.kind,
      status: 'OPEN',
      id: { not: id },
    },
    include: { presentation: true }
  })
  if (conflict) {
    res.setHeader('X-Open-Conflict', String(conflict.id))
    return res.status(409).json({
      error: 'No se puede reabrir porque ya existe una apertura abierta para este producto/tipo. Debe cerrar o eliminar la otra.',
      open: {
        id: conflict.id,
        openedAt: conflict.openedAt,
        openedBy: conflict.openedBy,
        presentationName: conflict.presentation?.name || 'default',
        counter: conflict.counter
      }
    })
  }

  const updated = await prisma.techOpen.update({
    where: { id },
    data: {
      status: 'OPEN',
      closedBy: null,
      closedAt: null,
      commentClose: null,
      updatedAt: new Date(),
    },
  })

  await logTechAction({
    userCode: user.code,
    action: 'reopen',
    techOpenId: id,
    before: { status: 'CLOSED' },
    after: { status: 'OPEN' },
    comment: String(comment || autoComment || '').trim() || null
  })

  res.json(updated)
})

// ===============================
// Eliminar apertura
// - Cajero: comentario obligatorio y solo si OPEN + counter=0
//           y (para helado) solo si daysOpen < minDays (p.e. 30)
// - Admin/SUPERSU: puede borrar siempre; si no hay comentario, se autogenera
// ===============================
techRouter.delete('/api/tech/:id', requireAuth, async (req, res) => {
  const user = req.user
  const id = Number(req.params.id)
  let { comment } = req.body || {}

  const t = await prisma.techOpen.findUnique({ where: { id } })
  if (!t) return res.status(404).json({ error: 'Apertura no existe' })

  if (isCashier(user)) {
    if (!String(comment || '').trim()) {
      return res.status(400).json({ error: 'Comentario obligatorio para eliminar (cajero).' })
    }
    if (!(t.status === 'OPEN' && t.counter === 0)) {
      return res.status(403).json({ error: 'Cajero solo puede eliminar aperturas OPEN con contador 0.' })
    }
    if (t.kind === 'ICECREAM') {
      const minDays = await getConfigNumber('tech.ice.minDays', 30)
      const dOpen = daysBetween(t.openedAt)
      if (dOpen >= (minDays - 1e-9)) {
        return res.status(403).json({ error: `Cajero no puede eliminar helado con ≥ ${minDays} días. Debe cerrarlo (comentario opcional).` })
      }
    }
  }

  if (isAdminOrSU(user) && !String(comment || '').trim()) {
    comment = `Eliminado por ${user.role}`
  }

  await logTechAction({
    userCode: user.code,
    action: 'delete',
    techOpenId: id,
    before: { snapshot: t },
    after: { deleted: true },
    comment: String(comment || '').trim() || null
  })

  await prisma.techOpen.delete({ where: { id } })
  res.json({ ok: true, id })
})

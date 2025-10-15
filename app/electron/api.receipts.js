// app/electron/api.receipts.js
import express from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
export const receiptsRouter = express.Router()

// ───────── Presets (servidos por API) ─────────
const PRESET_UNLOCK = [
  'Corrección de conteo',
  'Agregar producto omitido',
  'Eliminar ítem duplicado',
  'Ajuste por devolución',
  'Error de digitación',
]
const PRESET_ADD_ITEM = [
  'Faltaba en guía',
  'Reposición adicional',
  'Corrección posterior',
  'Ingreso no registrado',
]
const PRESET_DELETE_ITEM = [
  'Ítem duplicado',
  'Ingreso por error',
  'Producto dañado',
  'Ajuste por diferencia',
]
const PRESET_DELETE_RECEIPT = [
  'Creada por error',
  'Recepción duplicada',
  'Guía anulada',
  'Se rehará con datos correctos',
]

// ───────── Utils ─────────
function pad(n) { return String(n).padStart(2, '0') }
function genReceiptCode(userCode) {
  const d = new Date()
  return `RC-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${userCode}`
}
function genLotCode({ product, receipt, seq }) {
  const sku = (product?.supplierCode || `P${product?.id || ''}`)
  return `LOT-${receipt.code}-${sku}-#${seq}`
}
const isAdminOrSU = (user) => user?.role === 'ADMIN' || user?.role === 'SUPERSU'

// Permisos (sin “dueño”): ADMIN/SUPERSU siempre; Cajero solo si OPEN
function canEditReceipt(user, receipt) {
  if (isAdminOrSU(user)) return true
  return receipt?.status === 'OPEN'
}
function canLockReceipt(user, receipt) {
  if (isAdminOrSU(user)) return true
  return receipt?.status === 'OPEN'
}
function canDeleteReceipt(user, receipt) {
  if (isAdminOrSU(user)) return true
  return receipt?.status === 'OPEN'
}

async function touchReceipt(tx, receiptId, userCode, comment) {
  await tx.receipt.update({
    where: { id: receiptId },
    data: {
      lastEditedBy: userCode,
      lastEditComment: comment || null,
      updatedAt: new Date(),
    },
  })
}

// Auth: asume que req.user viene seteado por un middleware ascendente
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// Resuelve unitsPerPack según presentación o factor del producto
function resolveUnitsPerPack({ product, presentation }) {
  if (presentation && Number.isFinite(presentation.unitsPerPack)) {
    return Number(presentation.unitsPerPack) || 1
  }
  if (Number.isFinite(product?.conversionFactor) && Number(product.conversionFactor) > 0) {
    return Number(product.conversionFactor)
  }
  return 1
}

// ───────── PRESETS ─────────
receiptsRouter.get('/api/receipts/_presets', requireAuth, async (_req, res) => {
  res.json({
    unlock: PRESET_UNLOCK,
    add_item: PRESET_ADD_ITEM,
    delete_item: PRESET_DELETE_ITEM,
    delete_receipt: PRESET_DELETE_RECEIPT,
  })
})
receiptsRouter.get('/api/receipts/_unlock_presets', requireAuth, async (_req, res) => {
  res.json({ presets: PRESET_UNLOCK })
})

// ───────── LISTAR ─────────
receiptsRouter.get('/api/receipts', requireAuth, async (req, res) => {
  const { status, limit } = req.query
  const where = status ? { status } : {}
  const take = Math.min(100, Number(limit || 30))
  const receipts = await prisma.receipt.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      items: { include: { product: true, presentation: true, lot: true } },
    },
  })
  // Compat con UI: { value, Count }
  res.json({ value: receipts, Count: receipts.length })
})

// ───────── DETALLE POR ID ─────────
receiptsRouter.get('/api/receipts/:id', requireAuth, async (req, res) => {
  const recId = Number(req.params.id || 0)
  if (!recId) return res.status(400).json({ error: 'id inválido' })

  const r = await prisma.receipt.findUnique({
    where: { id: recId },
    include: {
      items: {
        include: {
          product: true,
          presentation: true,
          lot: true,
        },
      },
    },
  })
  if (!r) return res.status(404).json({ error: 'Not Found' })
  res.json(r)
})

// ───────── AUDIT POR RECEPCIÓN ─────────
receiptsRouter.get('/api/receipts/:id/audit', requireAuth, async (req, res) => {
  const recId = Number(req.params.id)
  const receipt = await prisma.receipt.findUnique({ where: { id: recId } })
  if (!receipt) return res.status(404).json({ error: 'Recepción no existe' })

  const logs = await prisma.auditLog.findMany({
    where: { module: 'inventory.receipts', receiptId: recId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json({ receipt: { id: receipt.id, code: receipt.code }, logs })
})

// ───────── CREAR (LOCKED) ─────────
receiptsRouter.post('/api/receipts', requireAuth, async (req, res) => {
  const user = req.user
  const { items = [], comment } = req.body || {}
  const code = genReceiptCode(user.code)

  const result = await prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.create({
      data: {
        code,
        userCode: user.code,
        status: 'LOCKED',
        comment: comment || null,
        editableUntil: new Date(), // compat esquema
        lastEditedBy: user.code,
        lastEditComment: comment || null,
      },
    })

    const createdItems = []
    let seq = 1

    for (const it of items) {
      const product = await tx.product.findUnique({ where: { id: Number(it.productId) } })
      if (!product) throw new Error('Producto no encontrado')

      let presentation = null
      if (it.presentationId) {
        presentation = await tx.presentation.findUnique({ where: { id: Number(it.presentationId) } })
        if (!presentation) throw new Error('Presentación no encontrada')
      }

      const packs = Number(it.packs || 1)
      if (!Number.isFinite(packs) || packs < 0) throw new Error('packs inválido')

      const unitsPerPack = resolveUnitsPerPack({ product, presentation })
      const unitsTotal = packs * unitsPerPack

      const recItem = await tx.receiptItem.create({
        data: {
          receiptId: receipt.id,
          productId: product.id,
          presentationId: presentation ? presentation.id : null,
          packs,
          unitsPerPack,
          unitsTotal,
        },
        include: { product: true, presentation: true },
      })
      createdItems.push(recItem)

      const lot = await tx.lot.create({
        data: {
          code: genLotCode({ product, receipt, seq }),
          productId: product.id,
          receiptItemId: recItem.id,
          qtyTotal: unitsTotal,
          qtyUsed: 0,
          status: 'OPEN',
        },
      })
      seq++

      await tx.stockMove.create({
        data: {
          productId: product.id,
          kind: 'RECEIPT',
          qty: unitsTotal,
          userCode: user.code,
          note: `RC ${receipt.code}`,
          receiptItemId: recItem.id,
          lotId: lot.id,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        userCode: user.code,
        module: 'inventory.receipts',
        action: 'create',
        before: null,
        after: JSON.stringify({
          code,
          items: createdItems.map(i => ({ id: i.id, productId: i.productId, unitsTotal: i.unitsTotal })),
        }),
        comment: comment || null,
        receiptId: receipt.id,
      },
    })

    return await tx.receipt.findUnique({
      where: { id: receipt.id },
      include: { items: { include: { product: true, presentation: true, lot: true } } },
    })
  })

  res.json(result)
})

// ───────── DESBLOQUEAR (OPEN) ─────────
receiptsRouter.patch('/api/receipts/:id/unlock', requireAuth, async (req, res) => {
  const user = req.user
  const recId = Number(req.params.id)
  let { comment } = req.body || {}
  const isAdmin = isAdminOrSU(user)

  if (isAdmin) {
    comment = `Desbloqueado por ${user.role}`
  } else {
    if (!comment || !String(comment).trim()) {
      return res.status(400).json({ error: 'Comentario obligatorio para desbloquear' })
    }
    comment = String(comment).trim()
  }

  const receipt = await prisma.receipt.findUnique({ where: { id: recId } })
  if (!receipt) return res.status(404).json({ error: 'Recepción no existe' })

  const prev = { status: receipt.status }
  const r = await prisma.receipt.update({
    where: { id: recId },
    data: { status: 'OPEN', lastEditedBy: user.code, lastEditComment: comment },
  })

  await prisma.auditLog.create({
    data: {
      userCode: user.code,
      module: 'inventory.receipts',
      action: 'unlock',
      before: JSON.stringify(prev),
      after: JSON.stringify({ status: r.status }),
      comment,
      receiptId: recId,
    },
  })

  res.json(r)
})

// ───────── BLOQUEAR (LOCK) ─────────
receiptsRouter.patch('/api/receipts/:id/lock', requireAuth, async (req, res) => {
  const user = req.user
  const recId = Number(req.params.id)
  const receipt = await prisma.receipt.findUnique({ where: { id: recId } })
  if (!receipt) return res.status(404).json({ error: 'Recepción no existe' })

  if (!canLockReceipt(user, receipt)) {
    return res.status(403).json({ error: 'No autorizado' })
  }

  const autoComment = isAdminOrSU(user) ? `Cerrado por ${user.role}` : null

  const r = await prisma.receipt.update({
    where: { id: recId },
    data: { status: 'LOCKED', lastEditedBy: user.code, lastEditComment: autoComment },
  })

  await prisma.auditLog.create({
    data: {
      userCode: user.code,
      module: 'inventory.receipts',
      action: 'lock',
      before: JSON.stringify({ status: receipt.status }),
      after: JSON.stringify({ status: r.status }),
      comment: autoComment,
      receiptId: recId,
    },
  })

  res.json(r)
})

// ───────── AGREGAR ÍTEM ─────────
receiptsRouter.post('/api/receipts/:id/items', requireAuth, async (req, res) => {
  const user = req.user
  const recId = Number(req.params.id)
  const { productId, presentationId, packs, comment } = req.body || {}

  const receipt = await prisma.receipt.findUnique({ where: { id: recId } })
  if (!receipt) return res.status(404).json({ error: 'Recepción no existe' })
  if (!canEditReceipt(user, receipt)) return res.status(403).json({ error: 'No autorizado' })

  const product = await prisma.product.findUnique({ where: { id: Number(productId) } })
  if (!product) return res.status(400).json({ error: 'Producto no encontrado' })

  let presentation = null
  if (presentationId) {
    presentation = await prisma.presentation.findUnique({ where: { id: Number(presentationId) } })
    if (!presentation) return res.status(400).json({ error: 'Presentación no encontrada' })
  }

  const packsNum = Number(packs || 1)
  if (!Number.isFinite(packsNum) || packsNum < 0) return res.status(400).json({ error: 'packs inválido' })

  const unitsPerPack = resolveUnitsPerPack({ product, presentation })
  const unitsTotal = packsNum * unitsPerPack

  const item = await prisma.$transaction(async (tx) => {
    const recItem = await tx.receiptItem.create({
      data: {
        receiptId: recId,
        productId: Number(productId),
        presentationId: presentation ? Number(presentation.id) : null,
        packs: packsNum,
        unitsPerPack,
        unitsTotal,
      },
      include: { product: true, presentation: true },
    })

    const lot = await tx.lot.create({
      data: {
        code: genLotCode({ product, receipt, seq: Date.now() % 1000 }),
        productId: Number(productId),
        receiptItemId: recItem.id,
        qtyTotal: unitsTotal,
        qtyUsed: 0,
        status: 'OPEN',
      },
    })

    await tx.stockMove.create({
      data: {
        productId: Number(productId),
        kind: 'RECEIPT',
        qty: unitsTotal,
        userCode: user.code,
        note: `RC ${receipt.code}`,
        receiptItemId: recItem.id,
        lotId: lot.id,
      },
    })

    await tx.auditLog.create({
      data: {
        userCode: user.code,
        module: 'inventory.receipts',
        action: 'add_item',
        before: null,
        after: JSON.stringify({ recId, itemId: recItem.id, unitsTotal }),
        comment: comment ? String(comment).trim() : null,
        receiptId: recId,
      },
    })

    await touchReceipt(tx, recId, user.code, comment || 'agregar ítem')
    return recItem
  })

  res.json(item)
})

// ───────── EDITAR ÍTEM ─────────
receiptsRouter.patch('/api/receipts/:id/items/:itemId', requireAuth, async (req, res) => {
  const user = req.user
  const recId = Number(req.params.id)
  const itemId = Number(req.params.itemId)
  const { packs, comment } = req.body || {}

  const receipt = await prisma.receipt.findUnique({ where: { id: recId } })
  if (!receipt) return res.status(404).json({ error: 'Recepción no existe' })
  if (!canEditReceipt(user, receipt)) return res.status(403).json({ error: 'No autorizado' })

  const item = await prisma.receiptItem.findUnique({ where: { id: itemId } })
  if (!item || item.receiptId !== recId) return res.status(404).json({ error: 'Ítem no existe' })

  const packsNew = Number(packs)
  if (!Number.isFinite(packsNew) || packsNew < 0) return res.status(400).json({ error: 'packs inválido' })

  const unitsTotalNew = packsNew * item.unitsPerPack
  const delta = unitsTotalNew - item.unitsTotal

  const updated = await prisma.$transaction(async (tx) => {
    const lot = await tx.lot.findUnique({ where: { receiptItemId: itemId } })
    if (lot && unitsTotalNew < lot.qtyUsed) {
      throw new Error(`No puedes bajar a ${unitsTotalNew} unidades; ya se usaron ${lot.qtyUsed}.`)
    }

    const it = await tx.receiptItem.update({
      where: { id: itemId },
      data: { packs: packsNew, unitsTotal: unitsTotalNew },
    })

    if (delta !== 0) {
      await tx.stockMove.create({
        data: {
          productId: it.productId,
          kind: 'RECEIPT_EDIT_ADJUST',
          qty: delta,
          userCode: user.code,
          note: `Adjust RC ${receipt.code}`,
          receiptItemId: it.id,
          lotId: lot?.id || null,
        },
      })
    }

    if (lot) {
      await tx.lot.update({ where: { id: lot.id }, data: { qtyTotal: unitsTotalNew } })
    }

    await tx.auditLog.create({
      data: {
        userCode: user.code,
        module: 'inventory.receipts',
        action: 'edit_item',
        before: JSON.stringify({ itemId, packs: item.packs, unitsTotal: item.unitsTotal }),
        after: JSON.stringify({ itemId, packs: packsNew, unitsTotal: unitsTotalNew }),
        comment: comment ? String(comment).trim() : null,
        receiptId: recId,
      },
    })

    await touchReceipt(tx, recId, user.code, comment || 'editar ítem')
    return it
  })

  res.json(updated)
})

// ───────── EDITAR RECEPCIÓN (MASIVO) ─────────
receiptsRouter.put('/api/receipts/:id', requireAuth, async (req, res) => {
  const user = req.user
  const recId = Number(req.params.id)
  const { items = [], comment } = req.body || {}
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items vacío' })
  }

  const result = await prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.findUnique({
      where: { id: recId },
      include: { items: true },
    })
    if (!receipt) return res.status(404).json({ error: 'Recepción no existe' })
    if (!canEditReceipt(user, receipt)) return res.status(403).json({ error: 'No autorizado' })

    const before = []
    const after = []
    const dbById = new Map(receipt.items.map(it => [it.id, it]))

    for (const it of items) {
      const id = Number(it.id)
      const current = dbById.get(id)
      if (!current || current.receiptId !== recId) {
        throw new Error(`Ítem ${id} no pertenece a la recepción`)
      }

      let unitsPerPack = current.unitsPerPack
      let newPresentationId = current.presentationId

      // ✅ soporta cambiar a "sin presentación" (null) con fallback a conversionFactor del producto
      if (it.presentationId == null && current.presentationId != null) {
        const product = await tx.product.findUnique({ where: { id: current.productId } })
        const cf = Number(product?.conversionFactor || 0)
        unitsPerPack = cf > 0 ? cf : 1
        newPresentationId = null
      } else if (it.presentationId && Number(it.presentationId) !== current.presentationId) {
        const pres = await tx.presentation.findUnique({ where: { id: Number(it.presentationId) } })
        if (!pres) throw new Error('Presentación no encontrada')
        unitsPerPack = pres.unitsPerPack ?? 1
        newPresentationId = pres.id
      }

      const packsNew = Number(it.packs)
      if (!Number.isFinite(packsNew) || packsNew < 0) throw new Error(`packs inválido para item ${id}`)

      const unitsTotalNew = packsNew * (unitsPerPack ?? 1)
      const delta = unitsTotalNew - current.unitsTotal

      before.push({ itemId: id, packs: current.packs, unitsTotal: current.unitsTotal })
      after.push({ itemId: id, packs: packsNew, unitsTotal: unitsTotalNew })

      const lot = await tx.lot.findUnique({ where: { receiptItemId: id } })
      if (lot && unitsTotalNew < lot.qtyUsed) {
        throw new Error(`Item ${id}: no puedes bajar a ${unitsTotalNew}; ya se usaron ${lot.qtyUsed}.`)
      }

      await tx.receiptItem.update({
        where: { id },
        data: {
          packs: packsNew,
          unitsPerPack,
          unitsTotal: unitsTotalNew,
          presentationId: newPresentationId,
        },
      })

      if (delta !== 0) {
        await tx.stockMove.create({
          data: {
            productId: current.productId,
            kind: 'RECEIPT_EDIT_ADJUST',
            qty: delta,
            userCode: user.code,
            note: `Adjust RC ${receipt.code}`,
            receiptItemId: id,
            lotId: lot?.id || null,
          },
        })
      }

      if (lot) {
        await tx.lot.update({ where: { id: lot.id }, data: { qtyTotal: unitsTotalNew } })
      }
    }

    await tx.auditLog.create({
      data: {
        userCode: user.code,
        module: 'inventory.receipts',
        action: 'bulk_edit',
        before: JSON.stringify(before),
        after: JSON.stringify(after),
        comment: comment ? String(comment).trim() : null,
        receiptId: recId,
      },
    })

    await touchReceipt(tx, recId, user.code, comment || 'editar recepción')

    return await tx.receipt.findUnique({
      where: { id: recId },
      include: { items: { include: { product: true, presentation: true, lot: true } } },
    })
  })

  res.json(result)
})

// ───────── ELIMINAR ÍTEM ─────────
receiptsRouter.delete('/api/receipts/:id/items/:itemId', requireAuth, async (req, res) => {
  const user = req.user
  const recId = Number(req.params.id)
  const itemId = Number(req.params.itemId)
  const { comment } = req.body || {}

  const receipt = await prisma.receipt.findUnique({ where: { id: recId } })
  if (!receipt) return res.status(404).json({ error: 'Recepción no existe' })
  if (!canEditReceipt(user, receipt)) return res.status(403).json({ error: 'No autorizado' })

  const item = await prisma.receiptItem.findUnique({ where: { id: itemId } })
  if (!item || item.receiptId !== recId) return res.status(404).json({ error: 'Ítem no existe' })

  await prisma.$transaction(async (tx) => {
    const lot = await tx.lot.findUnique({ where: { receiptItemId: itemId } })

    await tx.stockMove.create({
      data: {
        productId: item.productId,
        kind: 'RECEIPT_EDIT_ADJUST',
        qty: -item.unitsTotal,
        userCode: user.code,
        note: `Delete item RC ${receipt.code}`,
        receiptItemId: null,
        lotId: lot?.id || null,
      },
    })

    await tx.receiptItem.delete({ where: { id: itemId } })

    await tx.auditLog.create({
      data: {
        userCode: user.code,
        module: 'inventory.receipts',
        action: 'delete_item',
        before: JSON.stringify({ itemId, unitsTotal: item.unitsTotal }),
        after: null,
        comment: comment ? String(comment).trim() : null,
        receiptId: recId,
      },
    })

    await touchReceipt(tx, recId, user.code, comment || 'eliminar ítem')
  })

  res.json({ ok: true })
})

// ───────── ELIMINAR RECEPCIÓN ─────────
receiptsRouter.delete('/api/receipts/:id', requireAuth, async (req, res) => {
  const user = req.user
  const recId = Number(req.params.id)
  let { comment } = req.body || {}
  const isAdmin = isAdminOrSU(user)

  const receipt = await prisma.receipt.findUnique({
    where: { id: recId },
    include: { items: true },
  })
  if (!receipt) return res.status(404).json({ error: 'Recepción no existe' })
  if (!canDeleteReceipt(user, receipt)) return res.status(403).json({ error: 'No autorizado' })

  if (isAdmin) {
    comment = `Eliminado por ${user.role}`
  } else {
    if (!comment || !String(comment).trim()) {
      return res.status(400).json({ error: 'Comentario obligatorio para eliminar la recepción' })
    }
    comment = String(comment).trim()
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          userCode: user.code,
          module: 'inventory.receipts',
          action: 'delete_receipt',
          before: JSON.stringify({ receipt: { id: receipt.id, code: receipt.code }, items: receipt.items }),
          after: null,
          comment,
          receiptId: recId,
        },
      })

      for (const it of receipt.items) {
        let lot = null
        try { lot = await tx.lot.findUnique({ where: { receiptItemId: it.id } }) } catch {}
        if (it.unitsTotal && it.unitsTotal !== 0) {
          await tx.stockMove.create({
            data: {
              productId: it.productId,
              kind: 'RECEIPT_DELETE',
              qty: -it.unitsTotal,
              userCode: user.code,
              note: `Delete RC ${receipt.code}`,
              receiptItemId: null,
              lotId: lot?.id || null,
            },
          })
        }
      }

      await tx.receiptItem.deleteMany({ where: { receiptId: recId } })
      await tx.receipt.delete({ where: { id: recId } })
    })

    res.json({ ok: true })
  } catch (e) {
    console.error('Error eliminando recepción:', e)
    res.status(500).json({ error: 'No se pudo eliminar la recepción: ' + (e?.message || e) })
  }
})

// ───────── LOTES POR PRODUCTO ─────────
receiptsRouter.get('/api/products/:id/lots', requireAuth, async (req, res) => {
  const productId = Number(req.params.id)
  if (!productId) return res.status(400).json({ error: 'productId inválido' })

  const { status, limit } = req.query
  const where = {
    productId,
    ...(status ? { status: String(status).toUpperCase() } : {}),
  }
  const take = Math.min(100, Number(limit || 30))

  const lots = await prisma.lot.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      receiptItem: { include: { receipt: { select: { id: true, code: true, createdAt: true, userCode: true } } } },
    },
  })

  const out = lots.map(l => ({
    id: l.id,
    code: l.code,
    status: l.status,
    qtyTotal: l.qtyTotal,
    qtyUsed: l.qtyUsed,
    available: l.qtyTotal - l.qtyUsed,
    createdAt: l.createdAt,
    receiptCode: l.receiptItem?.receipt?.code || null,
  }))

  res.json(out)
})

export default receiptsRouter

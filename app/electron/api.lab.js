import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
export const labRouter = express.Router()

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

const isAdmin = (u) => u?.role === 'ADMIN'
const isSuper = (u) => u?.role === 'SUPERSU'
const canEditLab = (u) => isAdmin(u) || isSuper(u)

const CONFIG_DIR = path.resolve(process.cwd(), 'config')
const FLAGS_FILE = path.join(CONFIG_DIR, 'feature-flags.json')
const PARAMS_FILE = path.join(CONFIG_DIR, 'params.json')

async function readJson(file, fallback = {}) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8')
}

labRouter.get('/api/lab/feature-flags', requireAuth, async (_req, res) => {
  const data = await readJson(FLAGS_FILE, {})
  res.json({ source: FLAGS_FILE, flags: data })
})

labRouter.put('/api/lab/feature-flags', requireAuth, async (req, res) => {
  if (!canEditLab(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const { flags } = req.body || {}
  if (!flags || typeof flags !== 'object') {
    return res.status(400).json({ error: 'flags debe ser un objeto' })
  }
  await writeJson(FLAGS_FILE, flags)
  await prisma.auditLog.create({
    data: {
      userCode: req.user.code,
      module: 'lab',
      action: 'update_feature_flags',
      before: null,
      after: JSON.stringify(flags),
      comment: req.body?.comment ? String(req.body.comment) : null,
    },
  })
  res.json({ ok: true })
})

labRouter.get('/api/lab/params', requireAuth, async (_req, res) => {
  const params = await readJson(PARAMS_FILE, {})
  const overrides = await prisma.configOverride.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  res.json({ source: PARAMS_FILE, params, overrides })
})

labRouter.put('/api/lab/params', requireAuth, async (req, res) => {
  if (!canEditLab(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const { params } = req.body || {}
  if (!params || typeof params !== 'object') {
    return res.status(400).json({ error: 'params debe ser un objeto' })
  }
  await writeJson(PARAMS_FILE, params)
  await prisma.auditLog.create({
    data: {
      userCode: req.user.code,
      module: 'lab',
      action: 'update_params',
      before: null,
      after: JSON.stringify(params),
      comment: req.body?.comment ? String(req.body.comment) : null,
    },
  })
  res.json({ ok: true })
})

labRouter.post('/api/lab/params/overrides', requireAuth, async (req, res) => {
  if (!canEditLab(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const { key, scope, value, comment, expiresAt } = req.body || {}
  if (!key || value == null) {
    return res.status(400).json({ error: 'key y value son requeridos' })
  }
  const override = await prisma.configOverride.create({
    data: {
      key: String(key),
      scope: scope ? String(scope) : null,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      comment: comment ? String(comment) : null,
      createdBy: req.user.code,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  })
  res.json(override)
})

labRouter.get('/api/lab/alerts', requireAuth, async (req, res) => {
  if (!canEditLab(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const recentSales = await prisma.sale.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
  const openTech = await prisma.techOpen.count({ where: { status: 'OPEN' } })
  const lowStock = await prisma.stockMove.groupBy({
    by: ['productId'],
    _sum: { qty: true },
    having: { qty: { lt: 5 } },
    orderBy: { productId: 'asc' },
    take: 20,
  }).catch(() => [])

  res.json({
    summary: {
      recentSales,
      openTech,
      lowStock: lowStock.length,
    },
  })
})

export default labRouter

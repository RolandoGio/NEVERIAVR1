// app/electron/api.js
// API completa (auth + audit + me + catálogo + recepciones + técnico + promos + ventas + inventario)

import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

import { installCatalogApi } from './api.catalog.js'
import { receiptsRouter } from './api.receipts.js'
import { techRouter } from './api.tech.js'          // Aperturas técnicas (helado/topping)
import { promosRouter } from './api.promos.js'       // Motor de promociones
import { salesRouter } from './api.sales.js'         // Ventas (quote/commit/listados)
import { inventoryRouter } from './api.inventory.js' // Inventario (packs→unidades, summary, packs.yaml, version)
import { labRouter } from './api.lab.js'             // Feature flags, parámetros y alertas
import { reportsRouter } from './api.reports.js'     // Reportes PDF y Telegram

const prisma = new PrismaClient()

export function startApiServer(port = 8787) {
  const app = express()

  // --- Middlewares base ---
  app.use(cors({ origin: true }))
  app.use(express.json())
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-session')
    next()
  })

  // --- Helper ---
  const ttl = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000)

  // --- Login ---
  app.post('/api/login', async (req, res) => {
    const { code, password } = req.body || {}
    if (!code || !password) return res.status(400).json({ error: 'Faltan credenciales' })

    const user = await prisma.user.findUnique({ where: { code } })
    if (!user || !user.isActive) return res.status(401).json({ error: 'Usuario inválido' })

    const ok = await bcrypt.compare(String(password), user.passwordHash)
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' })

    const token = crypto.randomUUID()
    await prisma.session.create({
      data: { id: token, userId: user.id, createdAt: new Date(), expiresAt: ttl(24 * 30) } // 30 días
    })

    res.json({ token, user: { code: user.code, name: user.name, role: user.role } })
  })

  // --- Auth estricto (bloquea si no hay sesión) ---
  async function requireAuth(req, res, next) {
    const token = req.headers['x-session']
    if (!token) return res.status(401).json({ error: 'Sin sesión' })

    const s = await prisma.session.findUnique({ where: { id: String(token) } })
    if (!s || s.expiresAt < new Date()) return res.status(401).json({ error: 'Sesión expirada' })

    const user = await prisma.user.findUnique({ where: { id: s.userId } })
    if (!user || !user.isActive) return res.status(401).json({ error: 'Usuario no encontrado' })

    req.user = user
    next()
  }

  // --- Inyector de sesión (NO bloquea) ---
  app.use(async (req, _res, next) => {
    const token = req.headers['x-session']
    if (token) {
      try {
        const s = await prisma.session.findUnique({ where: { id: String(token) } })
        if (s && s.expiresAt >= new Date()) {
          const u = await prisma.user.findUnique({ where: { id: s.userId } })
          if (u && u.isActive) req.user = u
        }
      } catch { /* noop */ }
    }
    next()
  })

  // --- Endpoints varios protegidos ---
  app.post('/api/audit', requireAuth, async (req, res) => {
    const { module, action, before, after, comment } = req.body || {}
    const log = await prisma.auditLog.create({
      data: {
        userCode: req.user.code,
        module: module || 'misc',
        action: action || 'noop',
        before: before ? JSON.stringify(before) : null,
        after: after ? JSON.stringify(after) : null,
        comment: comment || null
      }
    })
    res.json({ ok: true, id: log.id })
  })

  app.get('/api/me', requireAuth, async (req, res) => {
    const u = req.user
    res.json({ user: { code: u.code, name: u.name, role: u.role } })
  })

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  // --- Catálogo ---
  app.use('/api/catalog', requireAuth, (req, _res, next) => next())
  installCatalogApi(app)

  // --- Recepciones ---
  app.use(receiptsRouter)

  // --- Técnico (aperturas helado/topping) ---
  app.use(techRouter)

  // --- Promociones ---
  app.use(promosRouter)

  // --- Inventario (antes que ventas por si hay rutas solapadas) ---
  app.use(inventoryRouter)

  // --- Panel de laboratorio (flags/params) ---
  app.use(labRouter)

  // --- Reportes + Telegram ---
  app.use(reportsRouter)

  // --- Ventas ---
  app.use(salesRouter)

  // --- 404 JSON ---
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.path })
  })

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log('[API] http://localhost:' + port)
      resolve(server)
    })
  })
}

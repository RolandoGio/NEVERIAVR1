import express from 'express'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { generateDailyReports } from './services/reportBuilder.js'
import { enqueueTelegramDocument, processTelegramQueue } from './services/telegram.js'

const prisma = new PrismaClient()
export const reportsRouter = express.Router()

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

const canAdminReports = (u) => u?.role === 'ADMIN' || u?.role === 'SUPERSU'

reportsRouter.get('/api/reports', requireAuth, async (req, res) => {
  if (!canAdminReports(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const limit = Math.min(50, Number(req.query.limit || 20))
  const jobs = await prisma.reportJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
  res.json(jobs)
})

reportsRouter.post('/api/reports/generate', requireAuth, async (req, res) => {
  if (!canAdminReports(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const date = req.body?.date ? new Date(req.body.date) : new Date()
  const job = await prisma.reportJob.create({
    data: {
      kind: 'daily',
      status: 'processing',
      payload: JSON.stringify({ date: date.toISOString() }),
    },
  })

  try {
    const result = await generateDailyReports({ date })
    await prisma.reportJob.update({
      where: { id: job.id },
      data: {
        status: 'done',
        resultPath: result.reportDir,
        processedAt: new Date(),
      },
    })
    res.json({ jobId: job.id, files: result.files })
  } catch (e) {
    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: 'error', error: String(e?.message || e), processedAt: new Date() },
    })
    res.status(500).json({ error: 'No se pudo generar el reporte', detail: String(e?.message || e) })
  }
})

reportsRouter.post('/api/reports/:id/send-telegram', requireAuth, async (req, res) => {
  if (!canAdminReports(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const job = await prisma.reportJob.findUnique({ where: { id: Number(req.params.id) } })
  if (!job) return res.status(404).json({ error: 'Reporte no encontrado' })
  if (job.status !== 'done' || !job.resultPath) {
    return res.status(400).json({ error: 'El reporte aún no está listo' })
  }
  const { chatId, botToken } = req.body || {}
  if (!chatId || !botToken) {
    return res.status(400).json({ error: 'chatId y botToken son requeridos' })
  }
  const base = job.resultPath
  const files = [
    path.join(base, 'ventas.pdf'),
    path.join(base, 'inventario.pdf'),
    path.join(base, 'bitacora.pdf'),
  ]
  for (const file of files) {
    await enqueueTelegramDocument({ chatId, document: file, caption: path.basename(file) })
  }
  const processed = await processTelegramQueue({ botToken })
  res.json({ queued: files.length, processed })
})

reportsRouter.get('/api/reports/:id', requireAuth, async (req, res) => {
  if (!canAdminReports(req.user)) return res.status(403).json({ error: 'Sin permiso' })
  const job = await prisma.reportJob.findUnique({ where: { id: Number(req.params.id) } })
  if (!job) return res.status(404).json({ error: 'Reporte no encontrado' })
  res.json(job)
})

export default reportsRouter

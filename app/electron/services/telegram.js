import fs from 'fs/promises'
import { Blob } from 'buffer'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function enqueueTelegramDocument({ chatId, document, caption }) {
  return prisma.telegramQueueItem.create({
    data: {
      chatId: String(chatId),
      document: String(document),
      caption: caption ? String(caption) : null,
    },
  })
}

async function sendDocument({ botToken, chatId, document, caption }) {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`
  const fileBuffer = await fs.readFile(document)
  const body = new FormData()
  body.append('chat_id', chatId)
  body.append('caption', caption || '')
  body.append('document', new Blob([fileBuffer]), document.split('/').pop())
  const res = await fetch(url, { method: 'POST', body })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telegram error: ${res.status} ${text}`)
  }
  return await res.json()
}

export async function processTelegramQueue({ botToken }) {
  if (!botToken) throw new Error('botToken requerido')
  const pending = await prisma.telegramQueueItem.findMany({ where: { status: 'pending' }, orderBy: { id: 'asc' }, take: 5 })
  const results = []
  for (const item of pending) {
    try {
      await prisma.telegramQueueItem.update({
        where: { id: item.id },
        data: { status: 'processing', attempts: item.attempts + 1 },
      })
      const res = await sendDocument({ botToken, chatId: item.chatId, document: item.document, caption: item.caption })
      await prisma.telegramQueueItem.update({
        where: { id: item.id },
        data: { status: 'sent', sentAt: new Date(), lastError: null },
      })
      results.push({ id: item.id, ok: true, response: res })
    } catch (e) {
      await prisma.telegramQueueItem.update({
        where: { id: item.id },
        data: { status: 'error', lastError: String(e?.message || e) },
      })
      results.push({ id: item.id, ok: false, error: String(e?.message || e) })
    }
  }
  return results
}

export default { enqueueTelegramDocument, processTelegramQueue }

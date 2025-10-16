#!/usr/bin/env node
import { processTelegramQueue } from '../electron/services/telegram.js'

const botToken = process.env.TELEGRAM_BOT_TOKEN || process.argv[2]

if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN no configurado')
  process.exit(1)
}

try {
  const result = await processTelegramQueue({ botToken })
  console.log('[telegram] processed', result)
} catch (e) {
  console.error('[telegram] error', e)
  process.exitCode = 1
}

#!/usr/bin/env node
import { generateDailyReports } from '../electron/services/reportBuilder.js'

const dateArg = process.argv[2]
const date = dateArg ? new Date(dateArg) : new Date()

try {
  const result = await generateDailyReports({ date })
  console.log('[reports] generated', result)
} catch (e) {
  console.error('[reports] error', e)
  process.exitCode = 1
}

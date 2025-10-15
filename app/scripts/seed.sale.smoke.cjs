// app/scripts/sales.smoke.cjs
import fetch from 'node-fetch'

const BASE = 'http://localhost:8787'

async function main() {
  console.log('→ smoke sales: start')

  // 1) login
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'SU0001', password: '1234' })
  })
  const login = await loginRes.json()
  if (!login.token) throw new Error('login failed')
  const token = login.token
  const H = { 'content-type': 'application/json', 'x-session': token }

  // 2) cart en pesos
  const body = {
    cart: {
      lines: [
        { sku: 'PALETA_CHOCO', name: 'Paleta Choco', qty: 1, unitPrice: 25, tags: ['paleta'] },
        { sku: 'PALETA_LIMON', name: 'Paleta Limón', qty: 1, unitPrice: 25, tags: ['paleta'] }
      ]
    }
  }

  // 3) quote
  const qRes = await fetch(`${BASE}/api/sales/quote`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const q = await qRes.json()
  console.log('QUOTE', q.totals, q.applied)

  // 4) commit
  const cRes = await fetch(`${BASE}/api/sales/commit`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const c = await cRes.json()
  console.log('COMMIT', c)

  console.log('→ smoke sales: end')
}

main().catch(e => { console.error('Smoke error:', e); process.exit(1) })
z
import { useState } from 'react'

const API = 'http://localhost:8787'

export default function InventoryApp({ token, onBack }) {
  const [fromSku, setFromSku] = useState('')
  const [qty, setQty] = useState(1)
  const [resolved, setResolved] = useState(null)
  const [toSku, setToSku] = useState('')
  const [factor, setFactor] = useState(1)
  const [log, setLog] = useState([])
  const [error, setError] = useState('')

  async function resolveRule() {
    setError('')
    try {
      const params = new URLSearchParams({ fromSku })
      if (toSku) params.append('toSku', toSku)
      if (factor) params.append('factor', factor)
      const res = await fetch(`${API}/api/inventory/convert/resolve?${params.toString()}`, {
        headers: { 'x-session': token },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo resolver la regla')
      setResolved(json)
      if (json?.rule?.to) setToSku(json.rule.to)
      if (json?.rule?.factor) setFactor(json.rule.factor)
    } catch (e) {
      setError(e.message)
    }
  }

  async function executeConvert() {
    setError('')
    try {
      const res = await fetch(`${API}/api/inventory/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session': token,
        },
        body: JSON.stringify({ fromSku, toSku, qty: Number(qty), factor: Number(factor) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo convertir')
      setLog((prev) => [json, ...prev].slice(0, 10))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="module">
      <header className="module__header">
        <button onClick={onBack}>← Volver</button>
        <h2>Conversión de inventario</h2>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        <h3>Resolver regla</h3>
        <label>
          SKU origen
          <input value={fromSku} onChange={(e) => setFromSku(e.target.value)} />
        </label>
        <label>
          Cantidad a convertir
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value) || 1)}
          />
        </label>
        <label>
          SKU destino (opcional)
          <input value={toSku} onChange={(e) => setToSku(e.target.value)} />
        </label>
        <label>
          Factor (opcional)
          <input
            type="number"
            min={1}
            value={factor}
            onChange={(e) => setFactor(Number(e.target.value) || 1)}
          />
        </label>
        <button onClick={resolveRule} disabled={!fromSku}>
          Resolver
        </button>
        {resolved && (
          <pre className="result">{JSON.stringify(resolved, null, 2)}</pre>
        )}
      </section>

      <section className="panel">
        <h3>Ejecutar conversión</h3>
        <button onClick={executeConvert} disabled={!fromSku || !toSku}>
          Convertir
        </button>
        {log.map((entry, idx) => (
          <pre key={idx} className="result">
            {JSON.stringify(entry, null, 2)}
          </pre>
        ))}
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'

const API = 'http://localhost:8787'

function pretty(obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return ''
  }
}

export default function LabApp({ token, onBack }) {
  const [flags, setFlags] = useState('{}')
  const [params, setParams] = useState('{}')
  const [overrides, setOverrides] = useState([])
  const [alerts, setAlerts] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function loadAll() {
      try {
        const [flagsRes, paramsRes] = await Promise.all([
          fetch(`${API}/api/lab/feature-flags`, { headers: { 'x-session': token } }),
          fetch(`${API}/api/lab/params`, { headers: { 'x-session': token } }),
        ])
        const flagsJson = await flagsRes.json()
        const paramsJson = await paramsRes.json()
        if (flagsRes.ok) setFlags(pretty(flagsJson.flags))
        if (paramsRes.ok) {
          setParams(pretty(paramsJson.params))
          setOverrides(paramsJson.overrides || [])
        }
      } catch (e) {
        setError(e.message)
      }
    }
    loadAll()
  }, [token])

  async function refreshAlerts() {
    try {
      const res = await fetch(`${API}/api/lab/alerts`, { headers: { 'x-session': token } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo cargar alertas')
      setAlerts(json.summary)
    } catch (e) {
      setError(e.message)
    }
  }

  async function saveFlags() {
    setMessage('')
    setError('')
    try {
      const payload = JSON.parse(flags)
      const res = await fetch(`${API}/api/lab/feature-flags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({ flags: payload }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo guardar flags')
      setMessage('Feature flags actualizados')
    } catch (e) {
      setError(e.message)
    }
  }

  async function saveParams() {
    setMessage('')
    setError('')
    try {
      const payload = JSON.parse(params)
      const res = await fetch(`${API}/api/lab/params`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({ params: payload }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudieron guardar parámetros')
      setMessage('Parámetros guardados')
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="module">
      <header className="module__header">
        <button onClick={onBack}>← Volver</button>
        <h2>Laboratorio · Flags y parámetros</h2>
      </header>

      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <section className="panel">
        <h3>Feature flags</h3>
        <textarea value={flags} onChange={(e) => setFlags(e.target.value)} rows={12} />
        <button onClick={saveFlags}>Guardar flags</button>
      </section>

      <section className="panel">
        <h3>Parámetros globales</h3>
        <textarea value={params} onChange={(e) => setParams(e.target.value)} rows={12} />
        <button onClick={saveParams}>Guardar parámetros</button>
        <h4>Overrides recientes</h4>
        <ul>
          {overrides.map((ov) => (
            <li key={ov.id}>
              <strong>{ov.key}</strong> → {ov.value} ({ov.scope || 'global'})
            </li>
          ))}
          {!overrides.length && <li>Sin overrides registrados.</li>}
        </ul>
      </section>

      <section className="panel">
        <h3>Alertas</h3>
        <button onClick={refreshAlerts}>Actualizar</button>
        {alerts && <pre className="result">{JSON.stringify(alerts, null, 2)}</pre>}
      </section>
    </div>
  )
}

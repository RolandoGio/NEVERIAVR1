import { useEffect, useState } from 'react'

const API = 'http://localhost:8787'

export default function ReportsApp({ token, onBack }) {
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState('')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')

  async function loadJobs() {
    try {
      const res = await fetch(`${API}/api/reports`, { headers: { 'x-session': token } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudieron cargar reportes')
      setJobs(json)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    loadJobs()
  }, [token])

  async function generate() {
    setError('')
    try {
      const res = await fetch(`${API}/api/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error generando reporte')
      await loadJobs()
      alert('Reportes generados')
    } catch (e) {
      setError(e.message)
    }
  }

  async function send(jobId) {
    setError('')
    try {
      const res = await fetch(`${API}/api/reports/${jobId}/send-telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({ chatId, botToken }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo enviar a Telegram')
      alert('Envío procesado. Revisa la cola.')
      await loadJobs()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="module">
      <header className="module__header">
        <button onClick={onBack}>← Volver</button>
        <h2>Reportes PDF</h2>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        <h3>Generar reportes diarios</h3>
        <button onClick={generate}>Generar ahora</button>
      </section>

      <section className="panel">
        <h3>Enviar a Telegram</h3>
        <label>
          Bot token
          <input value={botToken} onChange={(e) => setBotToken(e.target.value)} />
        </label>
        <label>
          Chat ID
          <input value={chatId} onChange={(e) => setChatId(e.target.value)} />
        </label>
      </section>

      <section className="panel">
        <h3>Historial</h3>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Estado</th>
              <th>Procesado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.id}</td>
                <td>{job.status}</td>
                <td>{job.processedAt ? new Date(job.processedAt).toLocaleString() : '—'}</td>
                <td>
                  {job.status === 'done' && (
                    <button onClick={() => send(job.id)} disabled={!botToken || !chatId}>
                      Enviar a Telegram
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!jobs.length && (
              <tr>
                <td colSpan={4}>Sin reportes generados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

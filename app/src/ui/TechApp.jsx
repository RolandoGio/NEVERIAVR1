// app/src/TechApp.jsx
import React, { useEffect, useMemo, useState } from 'react'

const API = 'http://localhost:8787'

// ===== helpers HTTP (mismos headers que el resto de tu UI) =====
function authFetch(url, opts = {}) {
  const token = localStorage.getItem('token') || localStorage.getItem('session') || ''
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-session': token,
      ...(opts.headers || {}),
    },
  })
}

async function parseJsonOrThrow(resp, ctx = 'solicitud') {
  const raw = await resp.text()
  let j = null
  try { j = raw ? JSON.parse(raw) : null } catch (e) {
    const err = new Error(`No se pudo interpretar JSON de ${ctx}. ${e.message}`)
    err.status = resp.status
    throw err
  }
  if (!resp.ok) {
    const err = new Error(j?.error || `Error en ${ctx} (HTTP ${resp.status})`)
    err.status = resp.status
    err.payload = j
    throw err
  }
  return j
}

function Chips({ items = [], onPick }) {
  if (!items?.length) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {items.map((txt, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(txt)}
          title={txt}
          style={{
            padding: '4px 8px',
            borderRadius: 999,
            border: '1px solid #2a3f58',
            background: '#122033',
            color: '#cfe6ff',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {txt}
        </button>
      ))}
    </div>
  )
}

export default function TechApp({ onBack }) {
  const [loading, setLoading] = useState(false)
  const [me, setMe] = useState(null)

  const [products, setProducts] = useState([])
  const iceProducts = useMemo(
    () => products.filter(p => p.controlType === 'tecnico_helado' && p.isActive),
    [products]
  )
  const topProducts = useMemo(
    () => products.filter(p => p.controlType === 'tecnico_topping' && p.isActive),
    [products]
  )

  const [presets, setPresets] = useState({ close: [], reopen: [], remove: [] })

  const [active, setActive] = useState([])          // aperturas abiertas
  const [closed, setClosed] = useState([])          // cerradas recientes
  const [warnings, setWarnings] = useState({})      // { [techOpenId]: 'mensaje' }

  // modales
  const [histOpen, setHistOpen] = useState(false)
  const [histRows, setHistRows] = useState([])
  const [histFor, setHistFor] = useState(null)

  const [actOpen, setActOpen] = useState(false)
  const [actRows, setActRows] = useState([])

  // modal eliminar (solo cajero)
  const [delOpen, setDelOpen] = useState(false)
  const [delFor, setDelFor] = useState(null)
  const [delComment, setDelComment] = useState('')

  // alerta de conflicto al abrir / reabrir
  const [openConflict, setOpenConflict] = useState(null) // {id, openedAt, openedBy, presentationName, counter}

  // formulario abrir
  const [kind, setKind] = useState('ICECREAM') // ICECREAM | TOPPING
  const [selProductId, setSelProductId] = useState('')
  const [selPresentationId, setSelPresentationId] = useState('')
  const [openComment, setOpenComment] = useState('')

  // comentarios por item (cerrar / reabrir)
  const [closeCommentById, setCloseCommentById] = useState({})
  const [reopenCommentById, setReopenCommentById] = useState({})

  const isAdminSU = me?.role === 'SUPERSU' || me?.role === 'ADMIN'
  const isSuperSU = me?.role === 'SUPERSU'
  const isCajero = me?.role === 'CAJERO'
  const canReopen = !!me && (isCajero || isAdminSU)

  const productList = kind === 'ICECREAM' ? iceProducts : topProducts
  const selProduct = useMemo(
    () => productList.find(p => String(p.id) === String(selProductId)),
    [productList, selProductId]
  )

  useEffect(() => {
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshAll() {
    setLoading(true)
    try {
      const rMe = await authFetch(`${API}/api/me`)
      const jMe = await parseJsonOrThrow(rMe, 'GET /api/me')
      setMe(jMe.user)

      const rProd = await authFetch(`${API}/api/catalog/products`)
      const jProd = await parseJsonOrThrow(rProd, 'GET /api/catalog/products')
      setProducts(Array.isArray(jProd) ? jProd : (jProd.products || []))

      try {
        const rp = await authFetch(`${API}/api/tech/_presets`)
        const jp = await parseJsonOrThrow(rp, 'GET /api/tech/_presets')
        setPresets({ close: jp.close || [], reopen: jp.reopen || [], remove: jp.remove || [] })
      } catch { /* opcional */ }

      const rAct = await authFetch(`${API}/api/tech/active`)
      const jAct = await parseJsonOrThrow(rAct, 'GET /api/tech/active')
      setActive(jAct || [])

      const rClosed = await authFetch(`${API}/api/tech?status=CLOSED&limit=20`)
      const jClosed = await parseJsonOrThrow(rClosed, 'GET /api/tech?status=CLOSED')
      setClosed(jClosed || [])

      setOpenConflict(null)
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Cuando cambia producto, setear presentación default
  useEffect(() => {
    if (!selProduct) { setSelPresentationId(''); return }
    const def = selProduct.presentations?.find(p => p.isDefault) || selProduct.presentations?.[0]
    setSelPresentationId(def?.id ? String(def.id) : '')
  }, [selProductId]) // eslint-disable-line

  async function openTech() {
    if (!selProductId || !selPresentationId || !kind) {
      alert('Selecciona producto y presentación')
      return
    }
    setLoading(true)
    try {
      const body = {
        productId: Number(selProductId),
        presentationId: Number(selPresentationId),
        kind,
        comment: openComment || ''
      }
      const r = await authFetch(`${API}/api/tech/open`, { method: 'POST', body: JSON.stringify(body) })
      if (r.status === 409) {
        const j = await r.json().catch(() => ({}))
        setOpenConflict(j?.open || { id: r.headers.get('x-open-conflict') })
        alert(j?.error || 'Ya existe una apertura abierta para este producto/tipo. Debe cerrarse antes.')
        return
      }
      await parseJsonOrThrow(r, 'POST /api/tech/open')
      setOpenComment('')
      setSelProductId('')
      setSelPresentationId('')
      await refreshAll()
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function countDelta(t, delta) {
    // Protección extra de UI
    if (!isAdminSU) {
      alert('Solo ADMIN/SUPERSU pueden ajustar el contador.')
      return
    }
    setLoading(true)
    try {
      const r = await authFetch(`${API}/api/tech/${t.id}/count`, {
        method: 'PATCH',
        body: JSON.stringify({ delta })
      })
      const warning = r.headers.get('x-warning')
      const j = await parseJsonOrThrow(r, 'PATCH /api/tech/:id/count')
      if (warning) {
        setWarnings(prev => ({ ...prev, [t.id]: warning }))
        setTimeout(() => setWarnings(prev => {
          const copy = { ...prev }; delete copy[t.id]; return copy
        }), 5000)
      }
      setActive(prev => prev.map(x => x.id === t.id ? { ...x, counter: j.counter } : x))
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchClosePolicy(id) {
    try {
      const r = await authFetch(`${API}/api/tech/${id}/close-policy`)
      return await parseJsonOrThrow(r, 'GET /api/tech/:id/close-policy')
    } catch (e) {
      // si falla, seguir con defaults
      return { minDays: null, daysOpen: null, early: false }
    }
  }

  async function closeTech(t, { simulateMature = false } = {}) {
    const comment = (closeCommentById[t.id] || '').trim()

    // 1) Aviso de regla de 30 días (si aplica)
    let policyMsg = 'Confirmar cierre.'
    let query = ''
    if (t.kind === 'ICECREAM') {
      const pol = await fetchClosePolicy(t.id)
      const daysTxt = typeof pol.daysOpen === 'number' ? pol.daysOpen.toFixed(1) : '—'
      if (pol.minDays) {
        if (simulateMature) {
          policyMsg =
            `Cerrar (MODO PRUEBA SUPERSU): se tratará como si tuviera ≥ ${pol.minDays} días.\n` +
            `Días reales abiertos: ${daysTxt}.\n` +
            `¿Deseas continuar?`
          query = '?simulateMature=1'
        } else if (pol.early) {
          const faltan = (pol.minDays - pol.daysOpen).toFixed(1)
          policyMsg =
            `ATENCIÓN: Este helado tiene ${daysTxt} días abierto y la política indica mínimo ${pol.minDays} días.\n` +
            `Faltan ${faltan} días para llegar al mínimo.\n\n` +
            `${isCajero ? 'Como CAJERO debes justificar el cierre en el comentario.' : 'Puedes cerrar; se registrará como anticipado.'}\n\n` +
            `¿Deseas continuar con el cierre?`
        } else {
          policyMsg =
            `Este helado ya cumplió el mínimo de ${pol.minDays} días (abierto ${daysTxt} días).\n` +
            `El comentario es opcional.\n\n` +
            `¿Deseas continuar con el cierre?`
        }
      }
    } else if (simulateMature) {
      // No tiene sentido para TOPPING, pero por si hacen click:
      policyMsg = 'Simulación de 30 días sólo aplica a helados. ¿Cerrar igualmente?'
    }

    // si cajero y es anticipado y no comentó: bloquear
    if (isCajero && t.kind === 'ICECREAM' && !simulateMature) {
      const pol = await fetchClosePolicy(t.id)
      if (pol.early && !comment) {
        alert('Cierre anticipado: como CAJERO debes indicar un comentario.')
        return
      }
    }

    // Confirmación 1: regla de 30 días
    if (!confirm(policyMsg)) return

    // Confirmación 2: are you sure
    if (!confirm(`¿Confirmas el cierre de la apertura #${t.id}?`)) return

    setLoading(true)
    try {
      const r = await authFetch(`${API}/api/tech/${t.id}/close${query}`, {
        method: 'PATCH',
        body: JSON.stringify({ comment })
      })
      await parseJsonOrThrow(r, 'PATCH /api/tech/:id/close')
      await refreshAll()
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function reopenTech(t) {
    const comment = (reopenCommentById[t.id] || '').trim()
    if (isCajero && !comment) return alert('Debes indicar motivo para reabrir (cajero).')
    setLoading(true)
    try {
      const r = await authFetch(`${API}/api/tech/${t.id}/reopen`, {
        method: 'PATCH',
        body: JSON.stringify({ comment })
      })
      if (r.status === 409) {
        const j = await r.json().catch(() => ({}))
        setOpenConflict(j?.open || { id: r.headers.get('x-open-conflict') })
        alert(j?.error || 'No se puede reabrir: ya hay una apertura abierta del mismo producto/tipo.')
        return
      }
      await parseJsonOrThrow(r, 'PATCH /api/tech/:id/reopen')
      await refreshAll()
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  function startDelete(t) {
    if (isAdminSU) {
      if (!confirm(`¿Eliminar la apertura #${t.id}? Esta acción no se puede deshacer.`)) return
      removeTech(t, '')
      return
    }
    // Cajero: abrir modal para motivo
    setDelFor(t)
    setDelComment('')
    setDelOpen(true)
  }

  async function removeTech(t, commentFromAdminSU) {
    const comment = (commentFromAdminSU ?? '').trim()
    setLoading(true)
    try {
      const r = await authFetch(`${API}/api/tech/${t.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ comment })
      })
      await parseJsonOrThrow(r, 'DELETE /api/tech/:id')
      setDelOpen(false)
      await refreshAll()
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function openHistory(t) {
    setHistFor(t)
    setHistRows([])
    setHistOpen(true)
    try {
      const r = await authFetch(`${API}/api/tech/${t.id}/logs`)
      const j = await parseJsonOrThrow(r, 'GET /api/tech/:id/logs')
      setHistRows(j.logs || [])
    } catch (e) {
      alert(e.message)
    }
  }

  async function openActions(t) {
    setActRows([])
    setActOpen(true)
    try {
      const r = await authFetch(`${API}/api/tech/${t.id}/actions`)
      const j = await parseJsonOrThrow(r, 'GET /api/tech/:id/actions')
      setActRows(j.actions || [])
    } catch (e) {
      alert(e.message)
    }
  }

  function fmt(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString()
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Aperturas técnicas (helado / toppings)</h2>
      <p style={{ opacity: .9 }}>
        Abre una cubeta/envase, registra <b>bolitas/usos</b> y cierra cuando corresponda. Si un topping supera su tope de usos,
        verás una advertencia; el servidor no bloquea, solo advierte.
      </p>

      {openConflict && (
        <div style={{ margin: '12px 0', padding: 10, borderRadius: 8, background: '#3a250e', border: '1px solid #6b4b1a', color: '#ffe9c7' }}>
          Ya existe una apertura abierta para este producto/tipo: <b>#{openConflict.id}</b>
          {openConflict.presentationName ? ` · ${openConflict.presentationName}` : ''}.
          Abierta por <b>{openConflict.openedBy || '—'}</b> el {fmt(openConflict.openedAt)} · Contador: {openConflict.counter ?? 0}.
          <div style={{ marginTop: 6 }}><small>Cierra esa apertura antes de crear o reabrir otra.</small></div>
        </div>
      )}

      {/* ====== ABRIR ====== */}
      <section style={{ background: '#0f1b2a', padding: 16, borderRadius: 12, marginBottom: 20 }}>
        <h3>Abrir</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label>Tipo</label>
            <select
              value={kind}
              onChange={e => { setKind(e.target.value); setSelProductId(''); setSelPresentationId(''); setOpenConflict(null) }}
              style={{ width: '100%', marginBottom: 8 }}
            >
              <option value="ICECREAM">Helado (bolitas)</option>
              <option value="TOPPING">Topping/Jalea (usos)</option>
            </select>
          </div>

          <div>
            <label>Producto</label>
            <select
              value={selProductId}
              onChange={e => { setSelProductId(e.target.value); setOpenConflict(null) }}
              style={{ width: '100%', marginBottom: 8 }}
            >
              <option value="">— selecciona —</option>
              {productList.map(p => (
                <option key={p.id} value={p.id}>
                  {p.supplierCode} · {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Presentación</label>
            <select
              value={selPresentationId}
              onChange={e => setSelPresentationId(e.target.value)}
              style={{ width: '100%', marginBottom: 8 }}
              disabled={!selProduct}
            >
              {(selProduct?.presentations || []).map(pr => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                  {typeof pr.unitsPerPack === 'number' ? ` · ${pr.unitsPerPack} u/pack` : ''}
                  {typeof pr.bolitasMin === 'number' ? ` · ${pr.bolitasMin}-${pr.bolitasMax} bolitas` : ''}
                  {typeof pr.toppingMaxUses === 'number' ? ` · ${pr.toppingMaxUses} usos` : ''}
                  {pr.isDefault ? ' · default' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Comentario (opcional)</label>
            <input
              style={{ width: '100%', padding: 8 }}
              value={openComment}
              onChange={e => setOpenComment(e.target.value)}
              placeholder={kind === 'ICECREAM' ? 'Apertura de cubeta' : 'Apertura de envase'}
            />
          </div>
        </div>

        <button onClick={openTech} disabled={loading} style={{ marginTop: 10 }}>
          Abrir
        </button>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* ====== ABIERTAS ====== */}
        <section style={{ background: '#0f1b2a', padding: 16, borderRadius: 12 }}>
          <h3>Abiertas</h3>
          {active.length === 0 && <p>No hay aperturas abiertas.</p>}
          {active.map(t => (
            <div key={t.id} style={{ border: '1px solid #223', padding: 12, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>#{t.id} · {t.kind === 'ICECREAM' ? 'Helado' : 'Topping'}</strong>
                <small>{t.status}</small>
              </div>
              <div style={{ fontSize: 13, opacity: .95, marginTop: 6, lineHeight: 1.35 }}>
                <div><b>Producto:</b> {t.product?.supplierCode} · {t.product?.name}</div>
                <div><b>Presentación:</b> {t.presentation?.name || 'default'}</div>
                <div><b>Abr.:</b> {fmt(t.openedAt)} por {t.openedBy}</div>
                <div><b>Contador:</b> {t.counter} {t.kind === 'ICECREAM' ? 'bolitas' : 'usos'}</div>
              </div>

              {warnings[t.id] && (
                <div style={{ background: '#3a250e', border: '1px solid #6b4b1a', color: '#ffe9c7', padding: 8, borderRadius: 8, marginTop: 8 }}>
                  ⚠ {warnings[t.id]}
                </div>
              )}

              {/* Ajuste de contador: solo ADMIN/SUPERSU */}
              {isAdminSU ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <button disabled={loading} onClick={() => countDelta(t, 1)}>+1</button>
                  <button disabled={loading} onClick={() => countDelta(t, 2)}>+2</button>
                  <button disabled={loading} onClick={() => countDelta(t, 5)}>+5</button>
                  <button disabled={loading} onClick={() => countDelta(t, -1)} style={{ background: '#3a0e0e', border: '1px solid #6b1a1a', color: '#ffd6d6' }}>-1</button>

                  <button disabled={loading} onClick={() => openHistory(t)} style={{ background: '#0e2f3a', border: '1px solid #155466' }}>
                    Ver historial
                  </button>
                  <button disabled={loading} onClick={() => openActions(t)} style={{ background: '#26133a', border: '1px solid #4a2a6d' }}>
                    Acciones
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <button disabled={loading} onClick={() => openHistory(t)} style={{ background: '#0e2f3a', border: '1px solid #155466' }}>
                    Ver historial
                  </button>
                  <button disabled={loading} onClick={() => openActions(t)} style={{ background: '#26133a', border: '1px solid #4a2a6d' }}>
                    Acciones
                  </button>
                </div>
              )}

              <div style={{ marginTop: 10 }}>
                <label>Comentario de cierre (si aplica)</label>
                <input
                  style={{ width: '100%', padding: 8 }}
                  value={closeCommentById[t.id] || ''}
                  onChange={e => setCloseCommentById(prev => ({ ...prev, [t.id]: e.target.value }))}
                  placeholder={t.kind === 'ICECREAM' ? 'Obligatorio si es cierre anticipado para CAJERO' : 'Opcional'}
                />
                <Chips items={(presets.close || [])} onPick={txt => setCloseCommentById(prev => ({ ...prev, [t.id]: txt }))} />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  disabled={loading}
                  onClick={() => closeTech(t)}
                  style={{ background: '#15340f', border: '1px solid #2a6d1a', color: '#d8ffd1' }}
                  title="Cerrar (doble confirmación)"
                >
                  Cerrar
                </button>

                {isSuperSU && (
                  <button
                    disabled={loading}
                    onClick={() => closeTech(t, { simulateMature: true })}
                    style={{ background: '#0f2a34', border: '1px solid #1c5b6b', color: '#cfe6ff' }}
                    title="Simular 30 días (solo pruebas SUPERSU)"
                  >
                    Simular 30 días
                  </button>
                )}

                {(isAdminSU || (isCajero && t.counter === 0)) && (
                  <button
                    disabled={loading}
                    onClick={() => startDelete(t)}
                    style={{ background: '#3a0e0e', border: '1px solid #6b1a1a', color: '#ffd6d6' }}
                  >
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>

        {/* ====== CERRADAS RECIENTES ====== */}
        <section style={{ background: '#0f1b2a', padding: 16, borderRadius: 12 }}>
          <h3>Cerradas recientes</h3>
          {closed.length === 0 && <p>Sin registros recientes.</p>}
          {closed.map(t => (
            <div key={t.id} style={{ border: '1px solid #223', padding: 12, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>#{t.id} · {t.kind === 'ICECREAM' ? 'Helado' : 'Topping'}</strong>
                <small>{t.status}</small>
              </div>
              <div style={{ fontSize: 13, opacity: .95, marginTop: 6, lineHeight: 1.35 }}>
                <div><b>Producto:</b> {t.product?.supplierCode} · {t.product?.name}</div>
                <div><b>Presentación:</b> {t.presentation?.name || 'default'}</div>
                <div><b>Abr.:</b> {fmt(t.openedAt)} por {t.openedBy}</div>
                <div><b>Cierre:</b> {fmt(t.closedAt)} por {t.closedBy}</div>
                <div><b>Counter final:</b> {t.counter}</div>
                {t.commentClose ? <div><b>Comentario cierre:</b> {t.commentClose}</div> : null}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button disabled={loading} onClick={() => openActions(t)} style={{ background: '#26133a', border: '1px solid #4a2a6d' }}>
                  Acciones
                </button>
                {canReopen && (
                  <>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <label>Motivo de reapertura {isCajero ? '(obligatorio)' : '(opcional)'}</label>
                      <input
                        style={{ width: '100%', padding: 8 }}
                        value={reopenCommentById[t.id] || ''}
                        onChange={e => setReopenCommentById(prev => ({ ...prev, [t.id]: e.target.value }))}
                        placeholder={isCajero ? 'Debes indicar el motivo (cajero)' : 'Si lo dejas vacío, el sistema añade automático'}
                      />
                      <Chips items={(presets.reopen || [])} onPick={txt => setReopenCommentById(prev => ({ ...prev, [t.id]: txt }))} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                      <button disabled={loading} onClick={() => reopenTech(t)}>
                        Reabrir
                      </button>
                      {isAdminSU && (
                        <button
                          disabled={loading}
                          onClick={() => startDelete(t)}
                          style={{ background: '#3a0e0e', border: '1px solid #6b1a1a', color: '#ffd6d6' }}
                          title="Eliminar (solo Admin/SU)"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>

      <div style={{ marginTop: 20 }}>
        <button onClick={onBack}>← Volver</button>
      </div>

      {loading && <p style={{ opacity: .8 }}>Cargando…</p>}

      {/* Modal HISTORIAL DE CONTADOR */}
      {histOpen && (
        <div style={styles.backdrop} onClick={() => setHistOpen(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>Historial apertura #{histFor?.id}</h4>
            <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 8 }}>
              {histRows.length === 0 && <p style={{ opacity: .8 }}>Sin registros.</p>}
              {histRows.map(l => (
                <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid #223' }}>
                  <div style={{ fontSize: 13, opacity: .9 }}>
                    <b>Δ {l.delta >= 0 ? '+' : ''}{l.delta}</b> · {new Date(l.createdAt).toLocaleString()} · por {l.userCode}
                  </div>
                  {l.comment ? <div style={{ fontSize: 13, opacity: .9 }}><i>“{l.comment}”</i></div> : null}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setHistOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal HISTORIAL DE ACCIONES */}
      {actOpen && (
        <div style={styles.backdrop} onClick={() => setActOpen(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>Historial de acciones</h4>
            <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 8 }}>
              {actRows.length === 0 && <p style={{ opacity: .8 }}>Sin registros.</p>}
              {actRows.map(a => (
                <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid #223' }}>
                  <div style={{ fontSize: 13 }}>
                    <b>{a.action.toUpperCase()}</b> · {new Date(a.createdAt).toLocaleString()} · por {a.userCode}
                  </div>
                  {a.comment && <div style={{ fontSize: 13, opacity: .9 }}><i>“{a.comment}”</i></div>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setActOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ELIMINAR (solo cajero) */}
      {delOpen && (
        <div style={styles.backdrop} onClick={() => setDelOpen(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>Eliminar apertura #{delFor?.id}</h4>
            <p style={{ marginTop: 4 }}>Indica el motivo de eliminación. (Obligatorio para cajero)</p>
            <input
              style={{ width: '100%', padding: 8 }}
              value={delComment}
              onChange={e => setDelComment(e.target.value)}
              placeholder="Apertura duplicada, producto equivocado, etc."
            />
            <Chips items={(presets.remove || [])} onPick={txt => setDelComment(txt)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setDelOpen(false)}>Cancelar</button>
              <button
                onClick={() => {
                  if (!delComment.trim()) {
                    alert('El motivo es obligatorio.')
                    return
                  }
                  removeTech(delFor, delComment)
                }}
                style={{ background: '#3a0e0e', border: '1px solid #6b1a1a', color: '#ffd6d6' }}
              >
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
  },
  modal: {
    background: '#0f1b2a', color: '#e5eefc', border: '1px solid #223',
    borderRadius: 12, padding: 16, width: 'min(720px, 92vw)'
  }
}
